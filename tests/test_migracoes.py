import models
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from database import SessionLocal, engine
from migracoes_alembic import _config_alembic, aplicar_migracoes
from migrations import preparar_banco, semear_demo


def test_alembic_cria_historico_e_chega_na_cabeca(cliente):
    aplicar_migracoes()

    inspetor = inspect(engine)
    assert "alembic_version" in inspetor.get_table_names()

    with engine.connect() as conexao:
        versao = conexao.execute(text("SELECT version_num FROM alembic_version")).scalar()

    cabeca = ScriptDirectory.from_config(_config_alembic()).get_current_head()
    assert versao == cabeca


def test_esquema_novo_tem_colunas_e_tabelas(cliente):
    inspetor = inspect(engine)
    tabelas = set(inspetor.get_table_names())
    assert {"envios_alerta", "usuarios", "lojas", "pedidos"} <= tabelas

    def colunas(tabela: str) -> set[str]:
        return {coluna["name"] for coluna in inspetor.get_columns(tabela)}

    assert {"papel", "totp_secret", "totp_ativo"} <= colunas("usuarios")
    assert "cliente_nome" in colunas("pedidos")
    assert {
        "notificar_email",
        "alerta_email",
        "notificar_telegram",
        "alerta_telegram",
        "notificar_whatsapp",
        "alerta_whatsapp",
    } <= colunas("lojas")


def test_preparar_banco_e_idempotente(cliente):
    preparar_banco()
    preparar_banco()

    with engine.connect() as conexao:
        assert conexao.execute(text("SELECT count(*) FROM lojas")).scalar() == 1
        assert conexao.execute(text("SELECT count(*) FROM usuarios")).scalar() == 1


def test_semear_demo_e_idempotente(cliente):
    semear_demo()
    semear_demo()

    with SessionLocal() as db:
        assert db.query(models.Pedido).count() == 12
        assert db.query(models.WebhookLog).count() == 12
        assert db.query(models.Notificacao).filter_by(tipo="valor_alto").count() == 4
        assert db.query(models.Notificacao).filter_by(tipo="cancelado").count() == 1
        assert db.query(models.Integracao).count() == 3
        assert {
            envio.status for envio in db.query(models.EnvioAlerta).all()
        } == {"enviado", "pendente", "descartado"}
