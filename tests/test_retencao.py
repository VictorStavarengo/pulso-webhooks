from datetime import datetime, timedelta, timezone

import models
from database import SessionLocal
from test_api import enviar


def _preparar_registros_antigos(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="RET-1", status="CANCELADO")

    with SessionLocal() as db:
        notificacao = db.query(models.Notificacao).one()
        antigo = datetime.now(timezone.utc) - timedelta(days=40)
        recente = datetime.now(timezone.utc) - timedelta(days=1)

        log = db.query(models.WebhookLog).one()
        log.recebido_em = antigo

        db.add(
            models.EnvioAlerta(
                notificacao_id=notificacao.id,
                canal="email",
                destino="ops@loja.com",
                status="enviado",
                criado_em=antigo,
            )
        )
        db.add(
            models.EnvioAlerta(
                notificacao_id=notificacao.id,
                canal="telegram",
                destino="@canal",
                status="enviado",
                criado_em=recente,
            )
        )
        db.commit()
        return notificacao.id


def test_expurgo_remove_logs_e_envios_antigos(autenticado, integracao, loja, monkeypatch):
    notificacao_id = _preparar_registros_antigos(autenticado, integracao, loja)
    monkeypatch.setenv("PULSO_RETENCAO_DIAS", "30")

    resposta = autenticado.post("/api/manutencao/expurgar")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo == {"logs_removidos": 1, "envios_removidos": 1, "retencao_dias": 30}

    with SessionLocal() as db:
        assert db.query(models.WebhookLog).count() == 0
        envios = db.query(models.EnvioAlerta).all()
        assert [item.canal for item in envios] == ["telegram"]
        assert db.get(models.Notificacao, notificacao_id) is not None


def test_retencao_zero_desativa_expurgo(autenticado, integracao, loja, monkeypatch):
    _preparar_registros_antigos(autenticado, integracao, loja)
    monkeypatch.setenv("PULSO_RETENCAO_DIAS", "0")

    resposta = autenticado.post("/api/manutencao/expurgar")

    assert resposta.status_code == 200
    assert resposta.json()["logs_removidos"] == 0
    assert resposta.json()["envios_removidos"] == 0

    with SessionLocal() as db:
        assert db.query(models.WebhookLog).count() == 1
        assert db.query(models.EnvioAlerta).count() == 2


def test_health_mostra_retencao_configurada(autenticado, monkeypatch):
    monkeypatch.setenv("PULSO_RETENCAO_DIAS", "15")

    corpo = autenticado.get("/health").json()

    assert corpo["retencao_dias"] == 15
