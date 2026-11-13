import threading
import time
from collections import defaultdict, deque

import config

_lock = threading.Lock()
_janelas: dict[str, deque[float]] = defaultdict(deque)
_redis_cliente = None


def _redis():
    global _redis_cliente
    if _redis_cliente is None:
        import redis  # import opcional: só existe quando REDIS_URL é usado

        _redis_cliente = redis.Redis.from_url(config.redis_url(), decode_responses=True)
    return _redis_cliente


def _permitir_memoria(chave: str, limite: int, janela: int) -> tuple[bool, int]:
    agora = time.monotonic()
    with _lock:
        fila = _janelas[chave]
        while fila and agora - fila[0] >= janela:
            fila.popleft()
        if len(fila) >= limite:
            retry = max(1, int(janela - (agora - fila[0])) + 1)
            return False, retry
        fila.append(agora)
        if len(_janelas) > 5000:
            for nome in [n for n, f in _janelas.items() if not f]:
                _janelas.pop(nome, None)
        return True, 0


def _permitir_redis(chave: str, limite: int, janela: int) -> tuple[bool, int]:
    cliente = _redis()
    chave_redis = f"pulso:rl:{chave}"
    contador = cliente.incr(chave_redis)
    if contador == 1:
        cliente.expire(chave_redis, janela)
    if contador > limite:
        ttl = cliente.ttl(chave_redis)
        return False, max(1, int(ttl or janela))
    return True, 0


def permitir(chave: str, limite: int | None = None, janela: int | None = None) -> tuple[bool, int]:
    if not config.rate_limit_ativo():
        return True, 0

    limite = limite or config.rate_limit_login()
    janela = janela or config.rate_limit_janela_segundos()

    if config.redis_url():
        try:
            return _permitir_redis(chave, limite, janela)
        except Exception:  # noqa: BLE001 - Redis fora do ar não deve bloquear a API
            pass
    return _permitir_memoria(chave, limite, janela)


def obter_ip(request) -> str:
    if config.confiar_proxy():
        encaminhado = request.headers.get("X-Forwarded-For")
        if encaminhado:
            return encaminhado.split(",")[0].strip()
        real = request.headers.get("X-Real-IP")
        if real:
            return real.strip()
    return request.client.host if request.client else "desconhecido"


def limpar() -> None:
    with _lock:
        _janelas.clear()
