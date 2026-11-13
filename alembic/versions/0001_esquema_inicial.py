"""Esquema inicial do Pulso.

Revision ID: 0001
Revises:
Create Date: 2026-11-12
"""

import models
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Baseline idempotente: cria apenas o que falta. Bancos antigos são
    # carimbados neste ponto e evoluem pela revisão 0002.
    bind = op.get_bind()
    models.Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    models.Base.metadata.drop_all(bind=bind)
