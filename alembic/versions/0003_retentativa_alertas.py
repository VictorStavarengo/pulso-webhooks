"""Retentativas com backoff e dead-letter nos envios de alerta.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-13

Idempotente: bancos novos já nascem com as colunas via metadata; bancos
existentes recebem apenas o que falta.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

import models

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


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
    models.Base.metadata.create_all(bind=bind)

    _adicionar(
        bind,
        "envios_alerta",
        "tentativas",
        sa.Column("tentativas", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    _adicionar(
        bind,
        "envios_alerta",
        "proxima_tentativa_em",
        sa.Column("proxima_tentativa_em", sa.DateTime(), nullable=True),
    )

    for comando in (
        "CREATE INDEX IF NOT EXISTS ix_envios_alerta_proxima_tentativa_em "
        "ON envios_alerta (proxima_tentativa_em)",
        "CREATE INDEX IF NOT EXISTS ix_envios_alerta_status ON envios_alerta (status)",
    ):
        try:
            with bind.begin_nested():
                bind.execute(sa.text(comando))
        except sa.exc.SQLAlchemyError:
            pass


def downgrade() -> None:
    bind = op.get_bind()
    if "envios_alerta" not in inspect(bind).get_table_names():
        return

    existentes = _colunas(bind, "envios_alerta")
    with op.batch_alter_table("envios_alerta") as batch:
        for coluna in ("tentativas", "proxima_tentativa_em"):
            if coluna in existentes:
                batch.drop_column(coluna)
