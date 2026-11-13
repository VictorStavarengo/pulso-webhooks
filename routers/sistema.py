from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import config
import events
import metricas
import schemas
import security
from database import get_db
from manutencao import expurgar_antigos

router = APIRouter()


@router.post(
    "/api/manutencao/expurgar",
    response_model=schemas.ExpurgoResposta,
    tags=["sistema"],
    summary="Executa o expurgo de logs antigos (admin)",
)
def executar_expurgo_now(
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.ExpurgoResposta:
    security.exigir_admin(sessao)
    logs, envios = expurgar_antigos(db)
    return schemas.ExpurgoResposta(
        logs_removidos=logs,
        envios_removidos=envios,
        retencao_dias=config.retencao_dias(),
    )


@router.get(
    "/api/stream",
    tags=["sistema"],
    summary="Stream SSE de atualizações da loja ativa",
)
async def stream_atualizacoes(
    request: Request,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
) -> StreamingResponse:
    loja_id = sessao.loja.id

    async def gerador():
        fonte = await events.abrir_fonte(loja_id)
        metricas.SSE_CONEXOES.inc()
        try:
            yield "retry: 3000\n\n"
            yield 'event: pronto\ndata: {"ok": true}\n\n'
            while True:
                if await request.is_disconnected():
                    break
                tipo = await fonte.receber(20)
                if tipo is None:
                    yield ": keep-alive\n\n"
                    continue
                yield f'event: {tipo}\ndata: {{"loja": {loja_id}}}\n\n'
        finally:
            await fonte.fechar()
            metricas.SSE_CONEXOES.dec()

    return StreamingResponse(
        gerador(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/metrics", include_in_schema=False)
def metricas_prometheus() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@router.get(
    "/health",
    response_model=schemas.HealthOut,
    tags=["sistema"],
    summary="Verifica a saúde da API e do banco",
)
def health(db: Session = Depends(get_db)) -> schemas.HealthOut:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Banco de dados indisponível",
        ) from error

    return schemas.HealthOut(
        status="ok",
        banco="ok",
        versao=config.APP_VERSION,
        retencao_dias=config.retencao_dias(),
    )
