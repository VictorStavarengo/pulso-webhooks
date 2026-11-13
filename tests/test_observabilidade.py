def test_metrics_exposto(cliente):
    cliente.get("/health")

    resposta = cliente.get("/metrics")

    assert resposta.status_code == 200
    assert resposta.headers["content-type"].startswith("text/plain")
    texto = resposta.text
    assert "pulso_requisicoes_total" in texto
    assert "pulso_webhooks_recebidos_total" in texto
    assert "pulso_sse_conexoes" in texto


def test_request_id_e_devolvido(cliente):
    resposta = cliente.get("/health", headers={"X-Request-ID": "abc123"})
    assert resposta.headers["X-Request-ID"] == "abc123"

    gerado = cliente.get("/health")
    assert len(gerado.headers["X-Request-ID"]) >= 8


def test_metricas_de_webhook_contam_resultado(autenticado, integracao, loja):
    from test_api import enviar

    enviar(autenticado, integracao, loja, evento_id="metric-1")
    enviar(autenticado, integracao, loja, evento_id="metric-1")

    texto = autenticado.get("/metrics").text

    assert 'pulso_webhooks_recebidos_total{resultado="criado"}' in texto
    assert 'pulso_webhooks_recebidos_total{resultado="duplicado"}' in texto
