import asyncio
import hmac
import logging
import math
import time
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import alertas
import config
import metricas
import observabilidade
import security
from manutencao import laco_retencao
from migrations import preparar_banco
from routers import ROUTERS

logger = logging.getLogger("pulso.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    observabilidade.configurar_logs()
    observabilidade.iniciar_sentry()
    preparar_banco()
    tarefa_retencao = asyncio.create_task(laco_retencao())
    tarefa_retentativas = asyncio.create_task(alertas.laco_retentativas())
    try:
        yield
    finally:
        tarefa_retencao.cancel()
        tarefa_retentativas.cancel()
        with suppress(asyncio.CancelledError):
            await tarefa_retencao
            await tarefa_retentativas


app = FastAPI(
    title=config.APP_NAME,
    version=config.APP_VERSION,
    description=(
        "Recebe eventos assinados de marketplaces, mantém os pedidos consolidados "
        "por loja e expõe notificações e streaming em tempo real."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _csrf_necessario(request: Request) -> bool:
    if not config.csrf_ativo():
        return False
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return False
    if not request.url.path.startswith("/api/"):
        return False
    if not request.cookies.get(security.COOKIE_SESSAO):
        # Sem sessão não há o que proteger; a autenticação responde 401.
        return False
    return request.url.path != "/api/auth/login"


def _csrf_valido(request: Request) -> bool:
    if not _csrf_necessario(request):
        return True
    cookie = request.cookies.get(security.COOKIE_CSRF)
    enviado = request.headers.get("X-Pulso-Csrf")
    if not cookie or not enviado:
        return False
    return hmac.compare_digest(cookie, enviado)


@app.middleware("http")
async def monitorar_requisicoes(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    inicio = time.perf_counter()

    if not _csrf_valido(request):
        resposta: Response = JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Token CSRF ausente ou inválido. Recarregue o painel."},
        )
    else:
        resposta = await call_next(request)

    duracao_ms = round((time.perf_counter() - inicio) * 1000, 1)
    resposta.headers["X-Request-ID"] = request_id
    metricas.REQUISICOES.labels(request.method, str(resposta.status_code)).inc()
    logger.info(
        "http metodo=%s rota=%s status=%s duracao_ms=%s",
        request.method,
        request.url.path,
        resposta.status_code,
        duracao_ms,
        extra={"request_id": request_id},
    )
    return resposta


def _json_serializavel(value):
    # NaN/Infinity não são JSON válido e quebrariam a resposta de erro.
    if isinstance(value, float) and not math.isfinite(value):
        return repr(value)
    if isinstance(value, dict):
        return {chave: _json_serializavel(item) for chave, item in value.items()}
    if isinstance(value, list):
        return [_json_serializavel(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def erro_de_validacao(_request: Request, exc: RequestValidationError):
    detalhes = _json_serializavel(jsonable_encoder(exc.errors()))
    return JSONResponse(status_code=422, content={"detail": detalhes})


for _router in ROUTERS:
    app.include_router(_router)


_DIST = config.BASE_DIR / "frontend" / "dist"
_PREFIXOS_DA_API = {"api", "webhooks", "health", "metrics"}

if config.servir_frontend() and (_DIST / "index.html").is_file():
    if (_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{caminho:path}", include_in_schema=False)
    async def painel_compilado(caminho: str):
        if caminho.split("/", 1)[0] in _PREFIXOS_DA_API:
            return JSONResponse({"detail": "Not Found"}, status_code=status.HTTP_404_NOT_FOUND)

        arquivo = (_DIST / caminho).resolve()
        if caminho and arquivo.is_file() and arquivo.is_relative_to(_DIST.resolve()):
            return FileResponse(arquivo)
        return FileResponse(_DIST / "index.html")
