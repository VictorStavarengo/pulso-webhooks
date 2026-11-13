import hashlib
import hmac
import logging
import re
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import alertas
import config
import events
import metricas
import models
import ratelimit
import schemas

STATUS_FINAIS = re.compile(r"entreg|conclu|cancel|reembols|devolu", re.IGNORECASE)
STATUS_CANCELADO = re.compile(r"cancel|recusad|fraude|falh|estornad", re.IGNORECASE)

logger = logging.getLogger("pulso.api")


def aplicar_limite(chave: str, limite: int) -> None:
    permitido, retry = ratelimit.permitir(chave, limite)
    if not permitido:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas. Aguarde alguns segundos e tente novamente.",
            headers={"Retry-After": str(retry)},
        )


def assinatura_esperada(segredo: str, timestamp: str, corpo: bytes) -> str:
    mensagem = timestamp.encode("ascii", errors="ignore") + b"." + corpo
    return hmac.new(segredo.encode("utf-8"), mensagem, hashlib.sha256).hexdigest()


def verificar_assinatura(
    db: Session,
    corpo: bytes,
    loja_slug: str | None,
    marketplace: str | None,
    timestamp: str | None,
    assinatura: str | None,
) -> tuple[models.Loja, models.Integracao]:
    if not loja_slug or not marketplace or not timestamp or not assinatura:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Assinatura do webhook ausente. Envie X-Pulso-Loja, X-Pulso-Marketplace, "
                "X-Pulso-Timestamp e X-Pulso-Assinatura."
            ),
        )

    try:
        enviado_em = int(timestamp)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Pulso-Timestamp inválido",
        ) from error

    if abs(time.time() - enviado_em) > config.webhook_tolerancia_segundos():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Pulso-Timestamp expirado",
        )

    loja = db.query(models.Loja).filter(models.Loja.slug == loja_slug.strip()).one_or_none()
    if loja is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loja não encontrada")

    integracao = (
        db.query(models.Integracao)
        .filter(
            models.Integracao.loja_id == loja.id,
            func.lower(models.Integracao.marketplace) == marketplace.strip().lower(),
        )
        .one_or_none()
    )
    if integracao is None or not integracao.ativo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Integração inativa ou inexistente para esta loja",
        )

    esperado = assinatura_esperada(integracao.segredo, timestamp, corpo)
    recebido = assinatura.strip().lower().removeprefix("sha256=")
    if not hmac.compare_digest(esperado, recebido):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Assinatura inválida",
        )

    return loja, integracao


def registrar_notificacao(
    db: Session,
    loja: models.Loja,
    pedido: models.Pedido,
    tipo: str,
    titulo: str,
    mensagem: str,
    chave: str,
) -> models.Notificacao | None:
    existente = (
        db.query(models.Notificacao.id)
        .filter(
            models.Notificacao.loja_id == loja.id,
            models.Notificacao.chave_unica == chave,
        )
        .first()
    )
    if existente is not None:
        return None

    notificacao = models.Notificacao(
        loja_id=loja.id,
        pedido_id=pedido.id,
        tipo=tipo,
        titulo=titulo,
        mensagem=mensagem,
        chave_unica=chave,
    )
    db.add(notificacao)
    db.flush()
    metricas.NOTIFICACOES.labels(tipo).inc()
    return notificacao


def notificar_evento(
    db: Session, loja: models.Loja, pedido: models.Pedido, novo_status: str
) -> list[models.Notificacao]:
    criadas: list[models.Notificacao] = []
    hoje = datetime.now(timezone.utc).date().isoformat()

    if loja.notificar_cancelado and STATUS_CANCELADO.search(novo_status):
        notificacao = registrar_notificacao(
            db,
            loja,
            pedido,
            "cancelado",
            "Pedido cancelado",
            f"{pedido.marketplace_id} foi cancelado (status {novo_status}).",
            f"cancelado:{pedido.id}:{hoje}",
        )
        if notificacao is not None:
            criadas.append(notificacao)

    if loja.notificar_valor_alto and loja.valor_alto > 0 and pedido.valor_total >= loja.valor_alto:
        notificacao = registrar_notificacao(
            db,
            loja,
            pedido,
            "valor_alto",
            "Pedido de valor alto",
            f"{pedido.marketplace_id} entrou com R$ {pedido.valor_total:,.2f}.",
            f"valor_alto:{pedido.id}:{hoje}",
        )
        if notificacao is not None:
            criadas.append(notificacao)

    return criadas


def gerar_notificacoes_atraso(db: Session, loja: models.Loja) -> list[models.Notificacao]:
    if not loja.notificar_atraso:
        return []

    agora = datetime.now(timezone.utc)
    limite = agora - timedelta(hours=loja.atraso_horas)
    pedidos = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.loja_id == loja.id,
            models.Pedido.data_atualizacao <= limite,
        )
        .order_by(models.Pedido.data_atualizacao.asc())
        .limit(200)
        .all()
    )

    criadas: list[models.Notificacao] = []
    hoje = agora.date().isoformat()

    for pedido in pedidos:
        if STATUS_FINAIS.search(pedido.status_atual):
            continue
        horas = max(1, int((agora - pedido.data_atualizacao).total_seconds() // 3600))
        notificacao = registrar_notificacao(
            db,
            loja,
            pedido,
            "atraso",
            "Pedido atrasado",
            (
                f"{pedido.marketplace_id} está há {horas} h sem atualização "
                f"(status {pedido.status_atual})."
            ),
            f"atraso:{pedido.id}:{hoje}",
        )
        if notificacao is not None:
            criadas.append(notificacao)

    if criadas:
        db.commit()
    return criadas


def processar_evento(
    db: Session,
    loja: models.Loja,
    origem: str,
    payload: schemas.WebhookPayload,
    corpo: str,
    evento_id: str | None,
    publicar_eventos: bool = True,
) -> schemas.WebhookResposta:
    agora = datetime.now(timezone.utc)
    evento = (evento_id or payload.evento_id or "").strip() or None

    if evento:
        log_existente = (
            db.query(models.WebhookLog)
            .filter(
                models.WebhookLog.loja_id == loja.id,
                models.WebhookLog.evento_id == evento,
            )
            .one_or_none()
        )
        if log_existente is not None:
            pedido = (
                db.get(models.Pedido, log_existente.pedido_id)
                if log_existente.pedido_id
                else None
            )
            metricas.WEBHOOKS.labels("duplicado").inc()
            return schemas.WebhookResposta(
                mensagem="Evento já processado anteriormente",
                criado=False,
                duplicado=True,
                pedido=(
                    schemas.PedidoOut.model_validate(pedido) if pedido is not None else None
                ),
            )

    pedido = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.loja_id == loja.id,
            models.Pedido.marketplace_id == payload.pedido_id,
        )
        .one_or_none()
    )
    criado = pedido is None

    if pedido is None:
        pedido = models.Pedido(
            loja_id=loja.id,
            marketplace_id=payload.pedido_id,
            status_atual=payload.status,
            valor_total=payload.valor,
            cliente_nome=payload.cliente_nome,
            data_atualizacao=agora,
        )
        db.add(pedido)
    else:
        pedido.status_atual = payload.status
        pedido.valor_total = payload.valor
        if payload.cliente_nome:
            pedido.cliente_nome = payload.cliente_nome
        pedido.data_atualizacao = agora

    db.flush()

    db.add(
        models.WebhookLog(
            loja_id=loja.id,
            pedido_id=pedido.id,
            evento_id=evento,
            origem=origem,
            payload_raw=corpo,
            recebido_em=agora,
            processado=True,
        )
    )
    notificacoes = notificar_evento(db, loja, pedido, payload.status)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log_existente = (
            db.query(models.WebhookLog)
            .filter(
                models.WebhookLog.loja_id == loja.id,
                models.WebhookLog.evento_id == evento,
            )
            .one_or_none()
        )
        metricas.WEBHOOKS.labels("duplicado").inc()
        if evento and log_existente is not None:
            return schemas.WebhookResposta(
                mensagem="Evento já processado anteriormente",
                criado=False,
                duplicado=True,
                pedido=None,
            )
        raise

    db.refresh(pedido)
    ids_notificacoes = [item.id for item in notificacoes]

    if publicar_eventos:
        events.publicar(loja.id, "pedidos")
        if ids_notificacoes:
            events.publicar(loja.id, "notificacoes")

    alertas.agendar_envio(ids_notificacoes)

    metricas.WEBHOOKS.labels("criado" if criado else "atualizado").inc()
    logger.info(
        "webhook loja=%s origem=%s pedido=%s status=%s criado=%s",
        loja.slug,
        origem,
        payload.pedido_id,
        payload.status,
        criado,
    )
    return schemas.WebhookResposta(
        mensagem="Webhook recebido e processado com sucesso",
        criado=criado,
        duplicado=False,
        pedido=schemas.PedidoOut.model_validate(pedido),
    )
