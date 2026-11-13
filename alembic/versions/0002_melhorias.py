"""Multi-loja, papéis, 2FA, canais de alerta e histórico do pedido.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12

Migração idempotente: pode rodar sobre bancos criados em versões anteriores
(que foram carimbados na revisão 0001) sem perder dados.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

import models

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

VERDADEIRO = sa.text("1")
FALSO = sa.text("0")


def _colunas(bind, tabela: str) -> set[str]:
    inspetor = inspect(bind)
    if tabela not in inspetor.get_table_names():
        return set()
    return {coluna["name"] for coluna in inspetor.get_columns(tabela)}


def _adicionar(bind, tabela: str, nome: str, coluna: sa.Column) -> None:
    if nome not in _colunas(bind, tabela):
        op.add_column(tabela, coluna)


def upgrade() -> None:
    bind = op.get_bind()

    # Garante tabelas que possam faltar em bancos muito antigos.
    models.Base.metadata.create_all(bind=bind)

    _adicionar(
        bind,
        "usuarios",
        "papel",
        sa.Column("papel", sa.String(20), nullable=False, server_default="admin"),
    )
    _adicionar(bind, "usuarios", "totp_secret", sa.Column("totp_secret", sa.String(64), nullable=True))
    _adicionar(
        bind,
        "usuarios",
        "totp_ativo",
        sa.Column("totp_ativo", sa.Boolean(), nullable=False, server_default=FALSO),
    )

    for tabela in ("pedidos", "webhook_logs"):
        _adicionar(bind, tabela, "loja_id", sa.Column("loja_id", sa.Integer(), nullable=True))
    _adicionar(bind, "webhook_logs", "pedido_id", sa.Column("pedido_id", sa.Integer(), nullable=True))
    _adicionar(bind, "webhook_logs", "evento_id", sa.Column("evento_id", sa.String(120), nullable=True))
    _adicionar(bind, "pedidos", "cliente_nome", sa.Column("cliente_nome", sa.String(160), nullable=True))

    _adicionar(
        bind,
        "lojas",
        "notificar_email",
        sa.Column("notificar_email", sa.Boolean(), nullable=False, server_default=FALSO),
    )
    _adicionar(bind, "lojas", "alerta_email", sa.Column("alerta_email", sa.String(200), nullable=True))
    _adicionar(
        bind,
        "lojas",
        "notificar_telegram",
        sa.Column("notificar_telegram", sa.Boolean(), nullable=False, server_default=FALSO),
    )
    _adicionar(
        bind,
        "lojas",
        "alerta_telegram",
        sa.Column("alerta_telegram", sa.String(80), nullable=True),
    )
    _adicionar(
        bind,
        "lojas",
        "notificar_whatsapp",
        sa.Column("notificar_whatsapp", sa.Boolean(), nullable=False, server_default=FALSO),
    )
    _adicionar(
        bind,
        "lojas",
        "alerta_whatsapp",
        sa.Column("alerta_whatsapp", sa.String(30), nullable=True),
    )

    bind.execute(text("UPDATE usuarios SET papel = 'admin' WHERE papel IS NULL OR papel = ''"))
    # Booleano precisa ser ligado pelo dialeto; "= 0" quebra no Postgres.
    usuarios = sa.table("usuarios", sa.column("totp_ativo", sa.Boolean))
    bind.execute(
        usuarios.update()
        .where(usuarios.c.totp_ativo.is_(None))
        .values(totp_ativo=False)
    )

    indices = [
        "CREATE INDEX IF NOT EXISTS ix_pedidos_loja_id ON pedidos (loja_id)",
        "CREATE INDEX IF NOT EXISTS ix_webhook_logs_loja_id ON webhook_logs (loja_id)",
        "CREATE INDEX IF NOT EXISTS ix_webhook_logs_pedido_id ON webhook_logs (pedido_id)",
        "CREATE INDEX IF NOT EXISTS ix_envios_alerta_notificacao_id ON envios_alerta (notificacao_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_loja_marketplace "
        "ON pedidos (loja_id, marketplace_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_logs_loja_evento "
        "ON webhook_logs (loja_id, evento_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_notificacoes_loja_chave "
        "ON notificacoes (loja_id, chave_unica)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_loja_marketplace "
        "ON integracoes (loja_id, marketplace)",
    ]
    for comando in indices:
        try:
            with bind.begin_nested():
                bind.execute(text(comando))
        except sa.exc.SQLAlchemyError:
            # Índice já coberto por uma restrição UNIQUE com o mesmo nome.
            pass


def downgrade() -> None:
    bind = op.get_bind()
    inspetor = inspect(bind)
    if "envios_alerta" in inspetor.get_table_names():
        op.drop_table("envios_alerta")

    for tabela, colunas in {
        "usuarios": ("papel", "totp_secret", "totp_ativo"),
        "pedidos": ("loja_id", "cliente_nome"),
        "webhook_logs": ("loja_id", "pedido_id", "evento_id"),
        "lojas": (
            "notificar_email",
            "alerta_email",
            "notificar_telegram",
            "alerta_telegram",
            "notificar_whatsapp",
            "alerta_whatsapp",
        ),
    }.items():
        existentes = _colunas(bind, tabela)
        with op.batch_alter_table(tabela) as batch:
            for coluna in colunas:
                if coluna in existentes:
                    batch.drop_column(coluna)
