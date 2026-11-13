import json
import logging
import re
import secrets
import sqlite3
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, inspect, text

import config
import models
from database import SessionLocal, engine
from migracoes_alembic import aplicar_migracoes
from security import gerar_hash_senha

logger = logging.getLogger("pulso.migracoes")


def _slug(texto: str) -> str:
    normalizado = unicodedata.normalize("NFKD", texto)
    ascii_texto = normalizado.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_texto).strip("-")
    return slug or "loja"


def slug_unico(db, nome: str) -> str:
    base = _slug(nome)
    slug = base
    indice = 2
    while db.query(models.Loja).filter(models.Loja.slug == slug).first() is not None:
        slug = f"{base}-{indice}"
        indice += 1
    return slug


def _backup_sqlite() -> None:
    if not config.backup_ativo():
        return

    url = engine.url
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return

    origem = Path(url.database)
    if not origem.exists():
        return

    carimbo = datetime.now().strftime("%Y%m%d-%H%M%S")
    destino = origem.with_name(f"{origem.name}.bak-{carimbo}")
    contador = 2
    while destino.exists():
        destino = origem.with_name(f"{origem.name}.bak-{carimbo}-{contador}")
        contador += 1

    try:
        with closing(sqlite3.connect(url.database)) as con_origem, closing(
            sqlite3.connect(destino)
        ) as con_destino:
            con_origem.backup(con_destino)
        logger.info("Backup do banco criado em %s", destino.name)
    except (sqlite3.Error, OSError) as erro:
        logger.warning("Não foi possível criar o backup do banco: %s", erro)


def migrar_esquema() -> bool:
    inspetor = inspect(engine)
    tabelas = set(inspetor.get_table_names())
    if "pedidos" not in tabelas or "webhook_logs" not in tabelas:
        return False

    colunas_pedidos = {coluna["name"] for coluna in inspetor.get_columns("pedidos")}
    colunas_logs = {coluna["name"] for coluna in inspetor.get_columns("webhook_logs")}

    comandos: list[str] = []
    if "loja_id" not in colunas_pedidos:
        comandos.append("ALTER TABLE pedidos ADD COLUMN loja_id INTEGER")
    if "loja_id" not in colunas_logs:
        comandos.append("ALTER TABLE webhook_logs ADD COLUMN loja_id INTEGER")
    if "pedido_id" not in colunas_logs:
        comandos.append("ALTER TABLE webhook_logs ADD COLUMN pedido_id INTEGER")
    if "evento_id" not in colunas_logs:
        comandos.append("ALTER TABLE webhook_logs ADD COLUMN evento_id VARCHAR(120)")

    if not comandos:
        return False

    _backup_sqlite()
    with engine.begin() as conexao:
        for comando in comandos:
            conexao.execute(text(comando))
    logger.info("Esquema atualizado para multi-loja (%d colunas novas).", len(comandos))
    return True


def _tem_unico(inspetor, tabela: str, colunas: list[str]) -> bool:
    for restricao in inspetor.get_unique_constraints(tabela):
        if list(restricao.get("column_names") or []) == colunas:
            return True
    for indice in inspetor.get_indexes(tabela):
        if indice.get("unique") and list(indice.get("column_names") or []) == colunas:
            return True
    return False


def migrar_indices() -> None:
    inspetor = inspect(engine)

    with engine.begin() as conexao:
        conexao.execute(text("CREATE INDEX IF NOT EXISTS ix_pedidos_loja_id ON pedidos (loja_id)"))
        conexao.execute(
            text("CREATE INDEX IF NOT EXISTS ix_webhook_logs_loja_id ON webhook_logs (loja_id)")
        )

        if not _tem_unico(inspetor, "pedidos", ["loja_id", "marketplace_id"]):
            conexao.execute(text("DROP INDEX IF EXISTS ix_pedidos_marketplace_id"))
            conexao.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_loja_marketplace "
                    "ON pedidos (loja_id, marketplace_id)"
                )
            )

        if not _tem_unico(inspetor, "webhook_logs", ["loja_id", "evento_id"]):
            conexao.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_logs_loja_evento "
                    "ON webhook_logs (loja_id, evento_id)"
                )
            )


def garantir_dados_padrao() -> None:
    with SessionLocal() as db:
        loja = db.query(models.Loja).order_by(models.Loja.id).first()
        if loja is None:
            loja = models.Loja(nome=config.loja_padrao(), slug=slug_unico(db, config.loja_padrao()))
            db.add(loja)
            db.flush()

        email_admin = config.admin_email()
        usuario = (
            db.query(models.Usuario)
            .filter(func.lower(models.Usuario.email) == email_admin)
            .one_or_none()
        )
        criado_usuario = usuario is None
        if usuario is None:
            usuario = models.Usuario(
                nome="Administrador",
                email=email_admin,
                senha_hash=gerar_hash_senha(config.admin_senha()),
                papel="admin",
            )
            db.add(usuario)
            db.flush()
        elif not usuario.papel:
            usuario.papel = "admin"

        if db.get(models.UsuarioLoja, (usuario.id, loja.id)) is None:
            db.add(models.UsuarioLoja(usuario_id=usuario.id, loja_id=loja.id))

        if "loja_id" in {coluna["name"] for coluna in inspect(engine).get_columns("pedidos")}:
            # SQL puro para não disparar o onupdate de data_atualizacao.
            db.execute(
                text("UPDATE pedidos SET loja_id = :loja_id WHERE loja_id IS NULL"),
                {"loja_id": loja.id},
            )

        if "loja_id" in {coluna["name"] for coluna in inspect(engine).get_columns("webhook_logs")}:
            db.execute(
                text("UPDATE webhook_logs SET loja_id = :loja_id WHERE loja_id IS NULL"),
                {"loja_id": loja.id},
            )

        origens = [
            linha[0]
            for linha in db.query(models.WebhookLog.origem).distinct().all()
            if linha[0]
        ]
        for origem in origens:
            existente = (
                db.query(models.Integracao)
                .filter(
                    models.Integracao.loja_id == loja.id,
                    func.lower(models.Integracao.marketplace) == origem.lower(),
                )
                .first()
            )
            if existente is None:
                db.add(
                    models.Integracao(
                        loja_id=loja.id,
                        marketplace=origem,
                        segredo=secrets.token_hex(24),
                    )
                )

        db.commit()

        if criado_usuario:
            logger.warning(
                "Usuário inicial criado: %s. Defina a senha com PULSO_ADMIN_SENHA "
                "antes do primeiro start em produção.",
                usuario.email,
            )


_DEMO_PEDIDOS = (
    ("shopify", "SHP-10421", "PAGO", 1849.90, "Marina Lopes", 2),
    ("shopify", "SHP-10420", "ENVIADO", 349.90, "Rafael Nunes", 6),
    ("mercadolivre", "ML-88213", "ENTREGUE", 2749.00, "Camila Reis", 26),
    ("mercadolivre", "ML-88197", "PENDENTE_PAGAMENTO", 129.90, "Bruno Sá", 8),
    ("woocommerce", "WC-5521", "PREPARANDO_ENVIO", 489.50, "Helena Duarte", 14),
    ("woocommerce", "WC-5518", "CANCELADO", 219.00, "Igor Matos", 30),
    ("shopify", "SHP-10411", "ENTREGUE", 4290.00, "Lívia Prado", 52),
    ("mercadolivre", "ML-88170", "PAGO", 89.90, "Tiago Mendes", 20),
    ("woocommerce", "WC-5502", "ENTREGUE", 159.00, "Sofia Alves", 76),
    ("shopify", "SHP-10398", "ENVIADO", 1120.00, "André Lima", 44),
    ("mercadolivre", "ML-88133", "PAGO", 59.90, "Paula Vieira", 3),
    ("woocommerce", "WC-5487", "ENTREGUE", 780.00, "Caio Ferreira", 98),
)


def semear_demo() -> None:
    """Cria dados de vitrine quando PULSO_DEMO_SEED=1 e a loja ainda está vazia."""
    from alertas import DESCARTADO, PENDENTE

    import servicos

    with SessionLocal() as db:
        loja = db.query(models.Loja).order_by(models.Loja.id).first()
        if loja is None or db.query(models.Pedido.id).first() is not None:
            return

        agora = datetime.now(timezone.utc)
        integracoes: dict[str, models.Integracao] = {}
        for origem in {item[0] for item in _DEMO_PEDIDOS}:
            integracao = (
                db.query(models.Integracao)
                .filter(
                    models.Integracao.loja_id == loja.id,
                    func.lower(models.Integracao.marketplace) == origem,
                )
                .one_or_none()
            )
            if integracao is None:
                integracao = models.Integracao(
                    loja_id=loja.id,
                    marketplace=origem,
                    segredo=secrets.token_hex(24),
                )
                db.add(integracao)
                db.flush()
            integracoes[origem] = integracao

        notificacoes: list[models.Notificacao] = []
        for origem, identificador, status_pedido, valor, cliente, horas in _DEMO_PEDIDOS:
            momento = agora - timedelta(hours=horas)
            pedido = models.Pedido(
                loja_id=loja.id,
                marketplace_id=identificador,
                status_atual=status_pedido,
                valor_total=valor,
                cliente_nome=cliente,
                data_atualizacao=momento,
            )
            db.add(pedido)
            db.flush()

            evento = f"demo-{identificador.lower()}"
            payload = {
                "marketplace": origem,
                "pedido_id": identificador,
                "status": status_pedido,
                "valor": valor,
                "cliente_nome": cliente,
                "evento_id": evento,
            }
            db.add(
                models.WebhookLog(
                    loja_id=loja.id,
                    pedido_id=pedido.id,
                    evento_id=evento,
                    origem=origem,
                    payload_raw=json.dumps(payload, ensure_ascii=False),
                    recebido_em=momento,
                    processado=True,
                )
            )
            notificacoes.extend(servicos.notificar_evento(db, loja, pedido, status_pedido))

        altos = [item for item in notificacoes if item.tipo == "valor_alto"]
        if len(altos) >= 3:
            db.add(
                models.EnvioAlerta(
                    notificacao_id=altos[0].id,
                    canal="telegram",
                    destino="@pulso_demo",
                    status="enviado",
                    tentativas=1,
                    criado_em=agora - timedelta(minutes=40),
                )
            )
            db.add(
                models.EnvioAlerta(
                    notificacao_id=altos[1].id,
                    canal="email",
                    destino="alertas@pulso.local",
                    status=PENDENTE,
                    erro="Timeout ao conectar no SMTP",
                    tentativas=2,
                    proxima_tentativa_em=agora + timedelta(minutes=5),
                    criado_em=agora - timedelta(minutes=20),
                )
            )
            db.add(
                models.EnvioAlerta(
                    notificacao_id=altos[2].id,
                    canal="whatsapp",
                    destino="+5511999990000",
                    status=DESCARTADO,
                    erro="Template não aprovado na Meta Cloud API",
                    tentativas=4,
                    criado_em=agora - timedelta(hours=2),
                )
            )

        db.commit()
        logger.info("dados de demonstração semeados: %d pedidos", len(_DEMO_PEDIDOS))


def preparar_banco() -> None:
    alterou = migrar_esquema()
    aplicar_migracoes()
    if alterou:
        migrar_indices()
    garantir_dados_padrao()
    if config.demo_seed():
        semear_demo()
