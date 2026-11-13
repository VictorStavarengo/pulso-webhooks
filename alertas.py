import asyncio
import json
import logging
import smtplib
import ssl
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage

import config
import metricas
import models
from database import SessionLocal

logger = logging.getLogger("pulso.alertas")

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pulso-alertas")
_lock_retentativas = threading.Lock()

PENDENTE = "pendente"
DESCARTADO = "descartado"


class CanalIndisponivel(Exception):
    """Canal habilitado, mas sem credenciais ou destino configurado."""


@dataclass(frozen=True)
class ResultadoEnvio:
    canal: str
    destino: str
    status: str
    erro: str | None = None


def _texto_alerta(loja: models.Loja, titulo: str, mensagem: str) -> str:
    partes = [mensagem, "", f"Loja: {loja.nome}"]
    if config.painel_url():
        partes.append(f"Painel: {config.painel_url()}")
    return "\n".join(partes)


def _enviar_email(destino: str, assunto: str, texto: str) -> None:
    host = config.smtp_host()
    remetente = config.alerta_remetente()
    if not host or not remetente:
        raise CanalIndisponivel("SMTP não configurado (PULSO_SMTP_HOST / PULSO_ALERTA_REMETENTE)")
    if not destino:
        raise CanalIndisponivel("loja sem e-mail de alerta")

    mensagem = EmailMessage()
    mensagem["Subject"] = assunto[:160]
    mensagem["From"] = remetente
    mensagem["To"] = destino
    mensagem.set_content(texto)

    timeout = config.alerta_timeout_segundos()
    seguranca = config.smtp_seguranca()
    if seguranca == "ssl":
        smtp: smtplib.SMTP = smtplib.SMTP_SSL(
            host,
            config.smtp_porta(),
            timeout=timeout,
            context=ssl.create_default_context(),
        )
    else:
        smtp = smtplib.SMTP(host, config.smtp_porta(), timeout=timeout)

    with smtp:
        smtp.ehlo()
        if seguranca == "starttls":
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        usuario = config.smtp_usuario()
        if usuario and config.smtp_senha():
            smtp.login(usuario, config.smtp_senha())
        smtp.send_message(mensagem)


def _post_json(url: str, dados: dict, token: str | None = None) -> dict:
    corpo = json.dumps(dados).encode("utf-8")
    cabecalhos = {"Content-Type": "application/json"}
    if token:
        cabecalhos["Authorization"] = f"Bearer {token}"
    requisicao = urllib.request.Request(url, data=corpo, headers=cabecalhos, method="POST")
    try:
        with urllib.request.urlopen(
            requisicao, timeout=config.alerta_timeout_segundos()
        ) as resposta:
            return json.loads(resposta.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as erro:
        detalhe = erro.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {erro.code}: {detalhe}") from erro


def _enviar_telegram(destino: str, texto: str) -> None:
    token = config.telegram_bot_token()
    if not token:
        raise CanalIndisponivel("Telegram não configurado (PULSO_TELEGRAM_BOT_TOKEN)")
    if not destino:
        raise CanalIndisponivel("loja sem chat ID do Telegram")

    resposta = _post_json(
        f"https://api.telegram.org/bot{token}/sendMessage",
        {"chat_id": destino, "text": texto[:3900], "disable_web_page_preview": True},
    )
    if not resposta.get("ok"):
        raise RuntimeError(str(resposta.get("description") or "envio recusado pelo Telegram"))


def _enviar_whatsapp(destino: str, texto: str) -> None:
    token = config.whatsapp_token()
    phone_id = config.whatsapp_phone_id()
    if not token or not phone_id:
        raise CanalIndisponivel(
            "WhatsApp não configurado (PULSO_WHATSAPP_TOKEN / PULSO_WHATSAPP_PHONE_ID)"
        )
    if not destino:
        raise CanalIndisponivel("loja sem número de WhatsApp")

    resposta = _post_json(
        f"https://graph.facebook.com/v20.0/{phone_id}/messages",
        {
            "messaging_product": "whatsapp",
            "to": destino,
            "type": "template",
            "template": {
                "name": config.whatsapp_template(),
                "language": {"code": config.whatsapp_idioma()},
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "text", "text": texto[:1000]}],
                    }
                ],
            },
        },
        token=token,
    )
    if "error" in resposta:
        raise RuntimeError(str(resposta["error"].get("message") or "envio recusado pelo WhatsApp"))


_ENVIADORES = {
    "email": _enviar_email,
    "telegram": _enviar_telegram,
    "whatsapp": _enviar_whatsapp,
}


def canais_da_loja(loja: models.Loja) -> list[tuple[str, str]]:
    canais: list[tuple[str, str]] = []
    if loja.notificar_email:
        canais.append(("email", loja.alerta_email or ""))
    if loja.notificar_telegram:
        canais.append(("telegram", loja.alerta_telegram or ""))
    if loja.notificar_whatsapp:
        canais.append(("whatsapp", loja.alerta_whatsapp or ""))
    return canais


def _enviar_para_canais(
    loja: models.Loja, titulo: str, mensagem: str
) -> list[ResultadoEnvio]:
    assunto = f"[Pulso] {titulo} · {loja.nome}"
    texto = _texto_alerta(loja, titulo, mensagem)
    resultados: list[ResultadoEnvio] = []

    for canal, destino in canais_da_loja(loja):
        enviador = _ENVIADORES[canal]
        try:
            enviador(destino, assunto, texto) if canal == "email" else enviador(destino, texto)
            resultados.append(ResultadoEnvio(canal, destino or "—", "enviado"))
        except CanalIndisponivel as erro:
            resultados.append(ResultadoEnvio(canal, destino or "—", "ignorado", str(erro)))
        except Exception as erro:  # noqa: BLE001 - falha de rede/SMTP vira registro de auditoria
            logger.warning("falha ao enviar alerta canal=%s loja=%s: %s", canal, loja.slug, erro)
            resultados.append(ResultadoEnvio(canal, destino or "—", "erro", str(erro)[:500]))
    return resultados


def _backoff_segundos(tentativas_feitas: int) -> int:
    atrasos = config.alerta_backoff_segundos()
    indice = min(max(tentativas_feitas - 1, 0), len(atrasos) - 1)
    return atrasos[indice]


def _enviar_canal(
    loja: models.Loja, canal: str, destino: str, titulo: str, mensagem: str
) -> None:
    texto = _texto_alerta(loja, titulo, mensagem)
    if canal == "email":
        _ENVIADORES["email"](destino, f"[Pulso] {titulo} · {loja.nome}", texto)
    else:
        _ENVIADORES[canal](destino, texto)


def _registrar_resultado(
    db, notificacao_id: int, resultado: ResultadoEnvio
) -> models.EnvioAlerta:
    status = resultado.status
    proxima: datetime | None = None
    if status == "erro":
        if config.alerta_max_tentativas() <= 1:
            status = DESCARTADO
        else:
            status = PENDENTE
            proxima = models.agora_utc() + timedelta(seconds=_backoff_segundos(1))

    envio = models.EnvioAlerta(
        notificacao_id=notificacao_id,
        canal=resultado.canal,
        destino=resultado.destino,
        status=status,
        erro=resultado.erro,
        tentativas=1,
        proxima_tentativa_em=proxima,
    )
    db.add(envio)
    return envio


def enviar_teste(loja: models.Loja) -> list[ResultadoEnvio]:
    return _enviar_para_canais(
        loja,
        "Teste de alerta",
        "Este é um envio de teste do Pulso. Se você recebeu, o canal está funcionando.",
    )


def despachar_notificacoes(notificacao_ids: list[int]) -> None:
    if not notificacao_ids or not config.alertas_externas_ativas():
        return

    try:
        with SessionLocal() as db:
            for notificacao_id in notificacao_ids:
                notificacao = db.get(models.Notificacao, notificacao_id)
                if notificacao is None:
                    continue
                loja = db.get(models.Loja, notificacao.loja_id)
                if loja is None:
                    continue

                for resultado in _enviar_para_canais(
                    loja, notificacao.titulo, notificacao.mensagem
                ):
                    envio = _registrar_resultado(db, notificacao.id, resultado)
                    metricas.ENVIOS.labels(envio.canal, envio.status).inc()
                    if envio.status == DESCARTADO:
                        logger.warning(
                            "alerta descartado canal=%s loja=%s: %s",
                            envio.canal,
                            loja.slug,
                            envio.erro,
                        )
            db.commit()
    except Exception:  # noqa: BLE001 - envio externo nunca deve derrubar o webhook
        logger.exception("falha ao despachar alertas externos")


def agendar_envio(notificacao_ids: list[int]) -> None:
    if not notificacao_ids or not config.alertas_externas_ativas():
        return
    try:
        _executor.submit(despachar_notificacoes, list(notificacao_ids))
    except RuntimeError:
        logger.warning("executor de alertas indisponível; envio ignorado")


def processar_retentativas(
    agora: datetime | None = None, limite: int = 50
) -> int:
    """Reenvia alertas pendentes; falhas esgotadas viram dead-letter (descartado)."""
    if not config.alertas_externas_ativas():
        return 0
    if not _lock_retentativas.acquire(blocking=False):
        return 0

    try:
        momento = agora or models.agora_utc()
        with SessionLocal() as db:
            pendentes = (
                db.query(models.EnvioAlerta)
                .filter(
                    models.EnvioAlerta.status == PENDENTE,
                    models.EnvioAlerta.proxima_tentativa_em.is_not(None),
                    models.EnvioAlerta.proxima_tentativa_em <= momento,
                )
                .order_by(models.EnvioAlerta.proxima_tentativa_em)
                .limit(limite)
                .all()
            )

            for envio in pendentes:
                notificacao = db.get(models.Notificacao, envio.notificacao_id)
                loja = (
                    db.get(models.Loja, notificacao.loja_id)
                    if notificacao is not None
                    else None
                )
                if notificacao is None or loja is None:
                    envio.status = DESCARTADO
                    envio.erro = "notificação ou loja removida antes da retentativa"
                    envio.proxima_tentativa_em = None
                    metricas.RETENTATIVAS.labels(envio.canal, DESCARTADO).inc()
                    continue

                envio.tentativas = (envio.tentativas or 0) + 1
                try:
                    _enviar_canal(
                        loja,
                        envio.canal,
                        envio.destino,
                        notificacao.titulo,
                        notificacao.mensagem,
                    )
                except CanalIndisponivel as erro:
                    envio.status = "ignorado"
                    envio.erro = str(erro)[:500]
                    envio.proxima_tentativa_em = None
                    metricas.RETENTATIVAS.labels(envio.canal, "ignorado").inc()
                except Exception as erro:  # noqa: BLE001 - falha de rede vira retentativa
                    envio.erro = str(erro)[:500]
                    if envio.tentativas >= config.alerta_max_tentativas():
                        envio.status = DESCARTADO
                        envio.proxima_tentativa_em = None
                        metricas.RETENTATIVAS.labels(envio.canal, DESCARTADO).inc()
                        logger.warning(
                            "alerta descartado canal=%s loja=%s tentativas=%s: %s",
                            envio.canal,
                            loja.slug,
                            envio.tentativas,
                            erro,
                        )
                    else:
                        envio.proxima_tentativa_em = momento + timedelta(
                            seconds=_backoff_segundos(envio.tentativas)
                        )
                        metricas.RETENTATIVAS.labels(envio.canal, "reagendado").inc()
                else:
                    envio.status = "enviado"
                    envio.erro = None
                    envio.proxima_tentativa_em = None
                    metricas.RETENTATIVAS.labels(envio.canal, "enviado").inc()

                metricas.ENVIOS.labels(envio.canal, envio.status).inc()

            db.commit()
            return len(pendentes)
    finally:
        _lock_retentativas.release()


async def laco_retentativas() -> None:
    if not config.alertas_externas_ativas():
        return

    await asyncio.sleep(5)
    while True:
        try:
            await asyncio.to_thread(processar_retentativas)
        except Exception:  # noqa: BLE001 - job periódico não pode morrer
            logger.exception("falha no ciclo de retentativas de alertas")
        await asyncio.sleep(config.alerta_retentativa_intervalo())
