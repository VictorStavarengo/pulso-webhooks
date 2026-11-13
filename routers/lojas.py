import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

import alertas
import models
import schemas
import security
from database import get_db
from migrations import slug_unico

router = APIRouter()


@router.get("/api/lojas", response_model=list[schemas.LojaOut], tags=["lojas"])
def listar_lojas(
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[models.Loja]:
    return security.lojas_do_usuario(db, sessao.usuario.id)


@router.post(
    "/api/lojas",
    response_model=schemas.LojaOut,
    status_code=status.HTTP_201_CREATED,
    tags=["lojas"],
)
def criar_loja(
    dados: schemas.LojaEntrada,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Loja:
    security.exigir_admin(sessao)
    loja = models.Loja(nome=dados.nome, slug=slug_unico(db, dados.nome))
    db.add(loja)
    db.flush()
    db.add(models.UsuarioLoja(usuario_id=sessao.usuario.id, loja_id=loja.id))
    db.commit()
    db.refresh(loja)
    return loja


@router.get(
    "/api/lojas/{loja_id}/configuracoes",
    response_model=schemas.LojaOut,
    tags=["lojas"],
)
def obter_configuracoes(
    loja_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Loja:
    return security.exigir_loja(db, sessao.usuario.id, loja_id)


@router.patch(
    "/api/lojas/{loja_id}/configuracoes",
    response_model=schemas.LojaOut,
    tags=["lojas"],
)
def atualizar_configuracoes(
    loja_id: int,
    dados: schemas.ConfiguracaoLojaEntrada,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Loja:
    security.exigir_admin(sessao)
    loja = security.exigir_loja(db, sessao.usuario.id, loja_id)
    alteracoes = dados.model_dump(exclude_unset=True)
    campos_nulaveis = {"alerta_email", "alerta_telegram", "alerta_whatsapp"}
    for campo, valor in alteracoes.items():
        if valor is None and campo not in campos_nulaveis:
            continue
        setattr(loja, campo, valor)
    db.commit()
    db.refresh(loja)
    return loja


@router.post(
    "/api/lojas/{loja_id}/alertas/teste",
    response_model=list[schemas.EnvioAlertaOut],
    tags=["lojas"],
    summary="Envia um alerta de teste pelos canais configurados",
)
def testar_alertas(
    loja_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[schemas.EnvioAlertaOut]:
    security.exigir_admin(sessao)
    loja = security.exigir_loja(db, sessao.usuario.id, loja_id)
    resultados = alertas.enviar_teste(loja)
    return [
        schemas.EnvioAlertaOut(
            canal=item.canal,
            destino=item.destino,
            status=item.status,
            erro=item.erro,
        )
        for item in resultados
    ]


@router.get(
    "/api/lojas/{loja_id}/alertas/envios",
    response_model=list[schemas.EnvioAlertaHistoricoOut],
    tags=["lojas"],
    summary="Fila de entrega, retentativas e dead-letter dos alertas",
)
def listar_envios_de_alerta(
    loja_id: int,
    status_filtro: str | None = Query(None, alias="status"),
    limite: int = Query(50, ge=1, le=200),
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[models.EnvioAlerta]:
    security.exigir_admin(sessao)
    security.exigir_loja(db, sessao.usuario.id, loja_id)

    consulta = (
        db.query(models.EnvioAlerta)
        .join(
            models.Notificacao,
            models.EnvioAlerta.notificacao_id == models.Notificacao.id,
        )
        .filter(models.Notificacao.loja_id == loja_id)
    )
    if status_filtro:
        consulta = consulta.filter(models.EnvioAlerta.status == status_filtro)
    return (
        consulta.order_by(
            models.EnvioAlerta.criado_em.desc(), models.EnvioAlerta.id.desc()
        )
        .limit(limite)
        .all()
    )


def _integracao_do_usuario(
    db: Session, usuario_id: int, integracao_id: int
) -> models.Integracao:
    integracao = db.get(models.Integracao, integracao_id)
    if integracao is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integração não encontrada"
        )
    security.exigir_loja(db, usuario_id, integracao.loja_id)
    return integracao


@router.get(
    "/api/lojas/{loja_id}/integracoes",
    response_model=list[schemas.IntegracaoOut],
    tags=["integrações"],
)
def listar_integracoes(
    loja_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[models.Integracao]:
    security.exigir_admin(sessao)
    security.exigir_loja(db, sessao.usuario.id, loja_id)
    return (
        db.query(models.Integracao)
        .filter(models.Integracao.loja_id == loja_id)
        .order_by(models.Integracao.marketplace)
        .all()
    )


@router.post(
    "/api/lojas/{loja_id}/integracoes",
    response_model=schemas.IntegracaoOut,
    status_code=status.HTTP_201_CREATED,
    tags=["integrações"],
)
def criar_integracao(
    loja_id: int,
    dados: schemas.IntegracaoEntrada,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Integracao:
    security.exigir_admin(sessao)
    security.exigir_loja(db, sessao.usuario.id, loja_id)
    existente = (
        db.query(models.Integracao)
        .filter(
            models.Integracao.loja_id == loja_id,
            func.lower(models.Integracao.marketplace) == dados.marketplace.lower(),
        )
        .one_or_none()
    )
    if existente is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe uma integração para este marketplace nesta loja",
        )

    integracao = models.Integracao(
        loja_id=loja_id,
        marketplace=dados.marketplace,
        segredo=secrets.token_hex(24),
    )
    db.add(integracao)
    db.commit()
    db.refresh(integracao)
    return integracao


@router.post(
    "/api/integracoes/{integracao_id}/rotacionar",
    response_model=schemas.IntegracaoOut,
    tags=["integrações"],
)
def rotacionar_segredo(
    integracao_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Integracao:
    security.exigir_admin(sessao)
    integracao = _integracao_do_usuario(db, sessao.usuario.id, integracao_id)
    integracao.segredo = secrets.token_hex(24)
    db.commit()
    db.refresh(integracao)
    return integracao


@router.delete(
    "/api/integracoes/{integracao_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["integrações"],
)
def remover_integracao(
    integracao_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> Response:
    security.exigir_admin(sessao)
    integracao = _integracao_do_usuario(db, sessao.usuario.id, integracao_id)
    db.delete(integracao)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
