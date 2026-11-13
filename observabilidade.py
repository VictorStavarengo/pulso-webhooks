import json
import logging
import sys

import config


class FormatadorJSON(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        dados = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "nivel": record.levelname,
            "logger": record.name,
            "mensagem": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            dados["request_id"] = request_id
        if record.exc_info:
            dados["excecao"] = self.formatException(record.exc_info)
        return json.dumps(dados, ensure_ascii=False)


def configurar_logs() -> None:
    if not config.log_json():
        return
    formatador = FormatadorJSON()
    raiz = logging.getLogger()
    if not raiz.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(formatador)
        raiz.addHandler(handler)
    else:
        for handler in raiz.handlers:
            handler.setFormatter(formatador)
    raiz.setLevel(logging.INFO)


def iniciar_sentry() -> None:
    dsn = config.sentry_dsn()
    if not dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=config.sentry_ambiente(),
            release=config.APP_VERSION,
            traces_sample_rate=0.0,
            send_default_pii=False,
        )
    except Exception:  # noqa: BLE001 - observabilidade não impede o boot
        logging.getLogger("pulso.observabilidade").exception("falha ao iniciar o Sentry")
