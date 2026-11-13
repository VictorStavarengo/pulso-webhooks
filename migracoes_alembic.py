import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

import config
from database import engine

logger = logging.getLogger("pulso.migracoes")

RAIZ = Path(__file__).resolve().parent
REVISAO_BASELINE = "0001"


def _config_alembic() -> Config:
    cfg = Config(str(RAIZ / "alembic.ini"))
    cfg.set_main_option("script_location", str(RAIZ / "alembic"))
    cfg.set_main_option("sqlalchemy.url", config.database_url().replace("%", "%%"))
    return cfg


def aplicar_migracoes() -> None:
    cfg = _config_alembic()
    tabelas = set(inspect(engine).get_table_names())

    if "alembic_version" not in tabelas and tabelas & {"pedidos", "lojas", "usuarios"}:
        logger.info("Banco existente sem histórico do Alembic; carimbando revisão %s", REVISAO_BASELINE)
        command.stamp(cfg, REVISAO_BASELINE)

    command.upgrade(cfg, "head")
