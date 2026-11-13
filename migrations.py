import logging
import re
import secrets
import sqlite3
import unicodedata
from contextlib import closing
from datetime import datetime
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


def preparar_banco() -> None:
    alterou = migrar_esquema()
    aplicar_migracoes()
    if alterou:
        migrar_indices()
    garantir_dados_padrao()
