import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

import config
import models
from database import SessionLocal

logger = logging.getLogger("pulso.retencao")

INTERVALO_INICIAL_SEGUNDOS = 120


def expurgar_antigos(db: Session, dias: int | None = None) -> tuple[int, int]:
    retencao = config.retencao_dias() if dias is None else dias
    if retencao <= 0:
        return 0, 0

    corte = datetime.now(timezone.utc) - timedelta(days=retencao)
    envios = (
        db.query(models.EnvioAlerta)
        .filter(models.EnvioAlerta.criado_em < corte)
        .delete(synchronize_session=False)
    )
    logs = (
        db.query(models.WebhookLog)
        .filter(models.WebhookLog.recebido_em < corte)
        .delete(synchronize_session=False)
    )
    db.commit()
    if logs or envios:
        logger.info("expurgo retencao=%sd logs=%s envios=%s", retencao, logs, envios)
    return logs, envios


def executar_expurgo() -> tuple[int, int]:
    with SessionLocal() as db:
        return expurgar_antigos(db)


async def laco_retencao() -> None:
    if config.retencao_dias() <= 0:
        return

    await asyncio.sleep(INTERVALO_INICIAL_SEGUNDOS)
    while True:
        try:
            await asyncio.to_thread(executar_expurgo)
        except Exception:  # noqa: BLE001 - job periódico não pode morrer
            logger.exception("falha no expurgo periódico")
        await asyncio.sleep(config.retencao_intervalo_horas() * 3600)
