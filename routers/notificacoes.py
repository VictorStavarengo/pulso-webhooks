from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

import alertas
import models
import schemas
import security
import servicos
from database import get_db

router = APIRouter()


@router.get(
    "/api/notificacoes",
    response_model=list[schemas.NotificacaoOut],
    tags=["notificações"],
)
def listar_notificacoes(
    apenas_nao_lidas: bool = Query(default=False),
    limite: int = Query(default=50, ge=1, le=200),
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[models.Notificacao]:
    criadas = servicos.gerar_notificacoes_atraso(db, sessao.loja)
    if criadas:
        alertas.agendar_envio([item.id for item in criadas])

    consulta = db.query(models.Notificacao).filter(
        models.Notificacao.loja_id == sessao.loja.id
    )
    if apenas_nao_lidas:
        consulta = consulta.filter(models.Notificacao.lida_em.is_(None))

    return (
        consulta.order_by(
            models.Notificacao.criada_em.desc(),
            models.Notificacao.id.desc(),
        )
        .limit(limite)
        .all()
    )


@router.post(
    "/api/notificacoes/{notificacao_id}/ler",
    response_model=schemas.NotificacaoOut,
    tags=["notificações"],
)
def marcar_notificacao_lida(
    notificacao_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Notificacao:
    notificacao = db.get(models.Notificacao, notificacao_id)
    if notificacao is None or notificacao.loja_id != sessao.loja.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notificação não encontrada"
        )
    if notificacao.lida_em is None:
        notificacao.lida_em = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notificacao)
    return notificacao


@router.post(
    "/api/notificacoes/ler-todas",
    response_model=schemas.LerTodasResposta,
    tags=["notificações"],
)
def marcar_todas_notificacoes(
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.LerTodasResposta:
    atualizadas = (
        db.query(models.Notificacao)
        .filter(
            models.Notificacao.loja_id == sessao.loja.id,
            models.Notificacao.lida_em.is_(None),
        )
        .update(
            {"lida_em": datetime.now(timezone.utc)},
            synchronize_session=False,
        )
    )
    db.commit()
    return schemas.LerTodasResposta(atualizadas=atualizadas)
