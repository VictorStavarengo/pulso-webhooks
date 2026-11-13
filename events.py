import asyncio
import logging
from collections import defaultdict

import config

logger = logging.getLogger("pulso.eventos")

CANAL = "pulso:loja:{loja_id}"


class Inscricao:
    __slots__ = ("fila", "loop")

    def __init__(self) -> None:
        self.fila: asyncio.Queue[str] = asyncio.Queue(maxsize=32)
        self.loop = asyncio.get_running_loop()


class Hub:
    """Pub/sub em memória. Funciona com um único worker do uvicorn."""

    def __init__(self) -> None:
        self._por_loja: dict[int, set[Inscricao]] = defaultdict(set)

    def inscrever(self, loja_id: int) -> Inscricao:
        inscricao = Inscricao()
        self._por_loja[loja_id].add(inscricao)
        return inscricao

    def remover(self, loja_id: int, inscricao: Inscricao) -> None:
        inscricoes = self._por_loja.get(loja_id)
        if not inscricoes:
            return
        inscricoes.discard(inscricao)
        if not inscricoes:
            self._por_loja.pop(loja_id, None)

    @staticmethod
    def _enfileirar(inscricao: Inscricao, tipo: str) -> None:
        try:
            inscricao.fila.put_nowait(tipo)
        except asyncio.QueueFull:
            pass

    def publicar(self, loja_id: int, tipo: str) -> None:
        for inscricao in list(self._por_loja.get(loja_id, ())):
            try:
                inscricao.loop.call_soon_threadsafe(self._enfileirar, inscricao, tipo)
            except RuntimeError:
                self.remover(loja_id, inscricao)


hub = Hub()


class _PublicadorRedis:
    def __init__(self, url: str) -> None:
        import redis

        self._cliente = redis.Redis.from_url(url, decode_responses=True)

    def publicar(self, loja_id: int, tipo: str) -> None:
        self._cliente.publish(CANAL.format(loja_id=loja_id), tipo)


def _criar_publicador():
    url = config.redis_url()
    if not url:
        return None
    try:
        return _PublicadorRedis(url)
    except Exception:  # noqa: BLE001 - Redis opcional: mantém o modo em memória
        logger.warning("REDIS_URL configurado, mas o cliente redis não está disponível")
        return None


_publicador = _criar_publicador()


def publicar(loja_id: int, tipo: str) -> None:
    hub.publicar(loja_id, tipo)
    if _publicador is None:
        return
    try:
        _publicador.publicar(loja_id, tipo)
    except Exception:  # noqa: BLE001 - não perde o evento local se o Redis cair
        logger.warning("falha ao publicar no Redis; evento entregue apenas neste processo")


class FonteMemoria:
    def __init__(self, loja_id: int) -> None:
        self._loja_id = loja_id
        self._inscricao = hub.inscrever(loja_id)

    async def receber(self, timeout: float) -> str | None:
        try:
            return await asyncio.wait_for(self._inscricao.fila.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def fechar(self) -> None:
        hub.remover(self._loja_id, self._inscricao)


class FonteRedis:
    def __init__(self, url: str, loja_id: int) -> None:
        self._loja_id = loja_id
        self._url = url
        self._cliente = None
        self._pubsub = None

    async def abrir(self) -> None:
        from redis import asyncio as redis_asyncio

        self._cliente = redis_asyncio.from_url(self._url, decode_responses=True)
        self._pubsub = self._cliente.pubsub()
        await self._pubsub.subscribe(CANAL.format(loja_id=self._loja_id))
        await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)

    async def receber(self, timeout: float) -> str | None:
        if self._pubsub is None:
            return None
        mensagem = await self._pubsub.get_message(
            ignore_subscribe_messages=True,
            timeout=timeout,
        )
        if not mensagem:
            return None
        dados = mensagem.get("data")
        return str(dados) if dados is not None else None

    async def fechar(self) -> None:
        if self._pubsub is not None:
            try:
                await self._pubsub.unsubscribe()
                await self._pubsub.aclose()
            except Exception:  # noqa: BLE001 - encerramento best-effort
                pass
            self._pubsub = None
        if self._cliente is not None:
            try:
                await self._cliente.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._cliente = None


async def abrir_fonte(loja_id: int):
    url = config.redis_url()
    if url:
        fonte = FonteRedis(url, loja_id)
        try:
            await fonte.abrir()
            return fonte
        except Exception:  # noqa: BLE001 - fallback para memória
            logger.warning("não foi possível assinar o Redis; usando modo local")
            await fonte.fechar()
    return FonteMemoria(loja_id)


__all__ = ["hub", "publicar", "abrir_fonte"]
