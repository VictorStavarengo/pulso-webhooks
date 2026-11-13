import json
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session

import config
import metricas
import models
import ratelimit
import schemas
import security
import servicos
from database import get_db

router = APIRouter()


@router.post(
    "/webhooks/pedidos",
    response_model=schemas.WebhookResposta,
    tags=["webhooks"],
    summary="Recebe um evento de pedido assinado",
)
async def receber_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_pulso_loja: str | None = Header(default=None, alias="X-Pulso-Loja"),
    x_pulso_marketplace: str | None = Header(default=None, alias="X-Pulso-Marketplace"),
    x_pulso_timestamp: str | None = Header(default=None, alias="X-Pulso-Timestamp"),
    x_pulso_assinatura: str | None = Header(default=None, alias="X-Pulso-Assinatura"),
    x_pulso_evento: str | None = Header(default=None, alias="X-Pulso-Evento"),
) -> schemas.WebhookResposta:
    servicos.aplicar_limite(
        f"webhook:{ratelimit.obter_ip(request)}:{x_pulso_loja or '-'}",
        config.rate_limit_webhook(),
    )
    corpo = await request.body()

    loja, integracao = servicos.verificar_assinatura(
        db,
        corpo,
        x_pulso_loja,
        x_pulso_marketplace,
        x_pulso_timestamp,
        x_pulso_assinatura,
    )

    try:
        payload = schemas.WebhookPayload.model_validate_json(corpo)
    except ValidationError as error:
        raise RequestValidationError(json.loads(error.json())) from error

    if payload.origem.strip().lower() != integracao.marketplace.strip().lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A origem do payload não corresponde ao marketplace assinado",
        )

    texto = corpo.decode("utf-8", errors="replace")
    with metricas.PROCESSAMENTO.time():
        return servicos.processar_evento(
            db,
            loja,
            integracao.marketplace,
            payload,
            texto,
            x_pulso_evento,
        )


@router.post(
    "/api/simular-webhook",
    response_model=schemas.WebhookResposta,
    tags=["webhooks"],
    summary="Simula um evento na loja ativa (sessão autenticada)",
)
async def simular_webhook(
    payload: schemas.WebhookPayload,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.WebhookResposta:
    security.exigir_admin(sessao)
    loja = sessao.loja
    integracao = (
        db.query(models.Integracao)
        .filter(
            models.Integracao.loja_id == loja.id,
            func.lower(models.Integracao.marketplace) == payload.origem.strip().lower(),
        )
        .one_or_none()
    )

    if integracao is None:
        integracao = models.Integracao(
            loja_id=loja.id,
            marketplace=payload.origem.strip(),
            segredo=secrets.token_hex(24),
        )
        db.add(integracao)
        db.flush()

    with metricas.PROCESSAMENTO.time():
        return servicos.processar_evento(
            db,
            loja,
            integracao.marketplace,
            payload,
            payload.model_dump_json(),
            payload.evento_id,
        )


@router.get(
    "/api/webhooks",
    response_model=list[schemas.WebhookLogOut],
    tags=["webhooks"],
    summary="Lista os eventos recebidos pela loja ativa",
)
def listar_webhooks(
    limite: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[models.WebhookLog]:
    return (
        db.query(models.WebhookLog)
        .filter(models.WebhookLog.loja_id == sessao.loja.id)
        .order_by(models.WebhookLog.id.desc())
        .offset(offset)
        .limit(limite)
        .all()
    )
