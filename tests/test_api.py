import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

from database import SessionLocal
from models import Pedido


def corpo_evento(**alteracoes):
    dados = {
        "origem": "Shopee",
        "pedido_id": "BR-1001",
        "status": "PAGO",
        "valor": 249.9,
    }
    dados.update(alteracoes)
    return dados


def enviar_bruto(
    cliente,
    integracao,
    loja,
    corpo: bytes,
    evento_id: str | None = None,
    timestamp: int | None = None,
):
    momento = str(int(timestamp if timestamp is not None else time.time()))
    assinatura = hmac.new(
        integracao["segredo"].encode("utf-8"),
        momento.encode("ascii") + b"." + corpo,
        hashlib.sha256,
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-Pulso-Loja": loja["slug"],
        "X-Pulso-Marketplace": integracao["marketplace"],
        "X-Pulso-Timestamp": momento,
        "X-Pulso-Assinatura": f"sha256={assinatura}",
    }
    if evento_id:
        headers["X-Pulso-Evento"] = evento_id
    return cliente.post("/webhooks/pedidos", content=corpo, headers=headers)


def enviar(
    cliente,
    integracao,
    loja,
    evento_id: str | None = None,
    timestamp: int | None = None,
    **alteracoes,
):
    corpo = json.dumps(corpo_evento(**alteracoes)).encode("utf-8")
    return enviar_bruto(cliente, integracao, loja, corpo, evento_id, timestamp)


def test_health_e_publico(cliente):
    resposta = cliente.get("/health")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["status"] == "ok"
    assert corpo["banco"] == "ok"
    assert corpo["versao"] == "1.3.0"
    assert corpo["retencao_dias"] == 0


def test_login_rejeita_credenciais_invalidas(cliente):
    resposta = cliente.post(
        "/api/auth/login",
        json={"email": "admin@pulso.local", "senha": "errada"},
    )

    assert resposta.status_code == 401


def test_login_retorna_sessao_e_loja(autenticado):
    resposta = autenticado.get("/api/auth/me")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["usuario"]["email"] == "admin@pulso.local"
    assert corpo["loja"]["nome"] == "Loja Teste"
    assert len(corpo["lojas"]) == 1
    assert "pulso_sessao" in autenticado.cookies


def test_logout_encerra_sessao(autenticado):
    assert autenticado.post("/api/auth/logout").status_code == 200
    assert autenticado.get("/api/auth/me").status_code == 401


def test_endpoints_privados_exigem_sessao(cliente):
    for caminho in (
        "/api/pedidos",
        "/api/webhooks",
        "/api/notificacoes",
        "/api/lojas",
        "/api/auth/me",
        "/api/stream",
    ):
        assert cliente.get(caminho).status_code == 401, caminho


def test_webhook_cria_pedido(autenticado, integracao, loja):
    resposta = enviar(autenticado, integracao, loja)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["criado"] is True
    assert corpo["duplicado"] is False
    assert corpo["pedido"]["marketplace_id"] == "BR-1001"
    assert corpo["pedido"]["status_atual"] == "PAGO"
    assert corpo["pedido"]["valor_total"] == 249.9
    assert corpo["pedido"]["data_atualizacao"].endswith(("Z", "+00:00"))


def test_webhook_atualiza_pedido_existente(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja)
    resposta = enviar(autenticado, integracao, loja, status="ENVIADO", valor=259.9)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["criado"] is False
    assert corpo["pedido"]["status_atual"] == "ENVIADO"
    assert corpo["pedido"]["valor_total"] == 259.9

    pedidos = autenticado.get("/api/pedidos").json()
    assert pedidos["total"] == 1
    assert len(pedidos["itens"]) == 1


def test_webhook_normaliza_espacos(autenticado, integracao, loja):
    resposta = enviar(
        autenticado,
        integracao,
        loja,
        pedido_id="  BR-2002  ",
        status=" pago ",
    )

    assert resposta.status_code == 200
    assert resposta.json()["pedido"]["marketplace_id"] == "BR-2002"
    assert resposta.json()["pedido"]["status_atual"] == "pago"


def test_webhook_sem_assinatura_e_rejeitado(autenticado):
    resposta = autenticado.post("/webhooks/pedidos", json=corpo_evento())

    assert resposta.status_code == 401


def test_webhook_com_assinatura_invalida_e_rejeitado(autenticado, integracao, loja):
    corpo = json.dumps(corpo_evento()).encode("utf-8")
    resposta = autenticado.post(
        "/webhooks/pedidos",
        content=corpo,
        headers={
            "Content-Type": "application/json",
            "X-Pulso-Loja": loja["slug"],
            "X-Pulso-Marketplace": integracao["marketplace"],
            "X-Pulso-Timestamp": str(int(time.time())),
            "X-Pulso-Assinatura": "sha256=0000",
        },
    )

    assert resposta.status_code == 401


def test_webhook_com_timestamp_expirado_e_rejeitado(autenticado, integracao, loja):
    resposta = enviar(
        autenticado,
        integracao,
        loja,
        timestamp=int(time.time()) - 3600,
    )

    assert resposta.status_code == 401


def test_webhook_rejeita_origem_divergente(autenticado, integracao, loja):
    resposta = enviar(autenticado, integracao, loja, origem="shopify")

    assert resposta.status_code == 400


def test_webhook_rejeita_valor_negativo(autenticado, integracao, loja):
    assert enviar(autenticado, integracao, loja, valor=-1).status_code == 422


def test_webhook_rejeita_campos_em_branco(autenticado, integracao, loja):
    assert enviar(autenticado, integracao, loja, pedido_id="   ").status_code == 422


def test_webhook_rejeita_valor_nao_finito(autenticado, integracao, loja):
    corpo = b'{"origem":"Shopee","pedido_id":"BR-1","status":"PAGO","valor":NaN}'
    resposta = enviar_bruto(autenticado, integracao, loja, corpo)

    assert resposta.status_code == 422
    assert resposta.headers["content-type"].startswith("application/json")


def test_webhook_e_idempotente_por_evento(autenticado, integracao, loja):
    primeira = enviar(autenticado, integracao, loja, evento_id="evt-1")
    segunda = enviar(autenticado, integracao, loja, evento_id="evt-1")

    assert primeira.status_code == 200
    assert primeira.json()["duplicado"] is False
    assert segunda.status_code == 200
    assert segunda.json()["duplicado"] is True
    assert len(autenticado.get("/api/webhooks").json()) == 1


def test_pedidos_mais_recente_primeiro(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="A")
    enviar(autenticado, integracao, loja, pedido_id="B")
    enviar(autenticado, integracao, loja, pedido_id="A", status="ENVIADO")

    itens = autenticado.get("/api/pedidos").json()["itens"]
    assert [pedido["marketplace_id"] for pedido in itens] == ["A", "B"]


def test_filtra_por_status_e_busca(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="ML-123", status="PAGO")
    enviar(autenticado, integracao, loja, pedido_id="SHOP-999", status="CANCELADO")

    pagos = autenticado.get("/api/pedidos", params={"status": "PAGO"}).json()["itens"]
    assert [pedido["marketplace_id"] for pedido in pagos] == ["ML-123"]

    busca = autenticado.get("/api/pedidos", params={"busca": "shop"}).json()["itens"]
    assert [pedido["marketplace_id"] for pedido in busca] == ["SHOP-999"]


def test_pagina_com_limite_e_offset(autenticado, integracao, loja):
    for indice in range(3):
        enviar(autenticado, integracao, loja, pedido_id=f"P-{indice}")

    primeira = autenticado.get("/api/pedidos", params={"por_pagina": 2}).json()
    segunda = autenticado.get("/api/pedidos", params={"por_pagina": 2, "pagina": 2}).json()

    assert len(primeira["itens"]) == 2
    assert primeira["paginas"] == 2
    assert primeira["total"] == 3
    assert len(segunda["itens"]) == 1
    assert autenticado.get("/api/pedidos", params={"por_pagina": 0}).status_code == 422
    assert autenticado.get("/api/pedidos", params={"pagina": 0}).status_code == 422


def test_logs_registram_evento_e_ficam_na_loja(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, evento_id="evt-log")

    logs = autenticado.get("/api/webhooks").json()
    assert len(logs) == 1
    assert logs[0]["origem"] == "Shopee"
    assert logs[0]["evento_id"] == "evt-log"
    assert "BR-1001" in logs[0]["payload_raw"]
    assert logs[0]["recebido_em"].endswith(("Z", "+00:00"))


def test_isolamento_entre_lojas(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja)

    nova = autenticado.post("/api/lojas", json={"nome": "Loja Centro"}).json()
    assert autenticado.post("/api/auth/loja", json={"loja_id": nova["id"]}).status_code == 200
    assert autenticado.get("/api/pedidos").json()["itens"] == []

    resposta = enviar_bruto(
        autenticado,
        integracao,
        {"slug": nova["slug"]},
        json.dumps(corpo_evento()).encode("utf-8"),
    )
    assert resposta.status_code == 403

    autenticado.post("/api/auth/loja", json={"loja_id": loja["id"]})
    assert len(autenticado.get("/api/pedidos").json()["itens"]) == 1


def test_criacao_de_lojas_gera_slugs_unicos(autenticado):
    primeira = autenticado.post("/api/lojas", json={"nome": "Loja Centro"})
    segunda = autenticado.post("/api/lojas", json={"nome": "Loja Centro"})

    assert primeira.status_code == 201
    assert primeira.json()["slug"] == "loja-centro"
    assert segunda.json()["slug"] == "loja-centro-2"


def test_configuracoes_de_notificacao(autenticado, loja):
    configuracao = autenticado.get(f"/api/lojas/{loja['id']}/configuracoes").json()
    assert configuracao["atraso_horas"] == 24
    assert configuracao["valor_alto"] == 1000

    atualizada = autenticado.patch(
        f"/api/lojas/{loja['id']}/configuracoes",
        json={"atraso_horas": 6, "valor_alto": 500, "notificar_atraso": False},
    )
    assert atualizada.status_code == 200
    assert atualizada.json()["atraso_horas"] == 6
    assert atualizada.json()["notificar_atraso"] is False

    assert (
        autenticado.patch(
            f"/api/lojas/{loja['id']}/configuracoes",
            json={"atraso_horas": 0},
        ).status_code
        == 422
    )
    assert autenticado.get("/api/lojas/999/configuracoes").status_code == 403


def test_integracoes_criam_rotacionam_e_removem(autenticado, integracao, loja):
    duplicada = autenticado.post(
        f"/api/lojas/{loja['id']}/integracoes",
        json={"marketplace": "Shopee"},
    )
    assert duplicada.status_code == 409

    antigo = integracao["segredo"]
    rotacionada = autenticado.post(f"/api/integracoes/{integracao['id']}/rotacionar")
    assert rotacionada.status_code == 200
    novo = rotacionada.json()["segredo"]
    assert novo != antigo

    antiga = enviar_bruto(
        autenticado,
        {"marketplace": "Shopee", "segredo": antigo},
        loja,
        json.dumps(corpo_evento()).encode("utf-8"),
    )
    assert antiga.status_code == 401

    atual = enviar_bruto(
        autenticado,
        {"marketplace": "Shopee", "segredo": novo},
        loja,
        json.dumps(corpo_evento()).encode("utf-8"),
    )
    assert atual.status_code == 200

    assert autenticado.delete(f"/api/integracoes/{integracao['id']}").status_code == 204
    assert autenticado.get(f"/api/lojas/{loja['id']}/integracoes").json() == []


def test_notificacoes_de_cancelamento_e_valor_alto(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="C-1", status="CANCELADO", valor=1500)
    enviar(autenticado, integracao, loja, pedido_id="C-1", status="CANCELADO", valor=1500)

    notificacoes = autenticado.get("/api/notificacoes").json()
    tipos = [notificacao["tipo"] for notificacao in notificacoes]

    assert tipos.count("cancelado") == 1
    assert tipos.count("valor_alto") == 1
    assert all(notificacao["lida_em"] is None for notificacao in notificacoes)


def test_notificacao_de_atraso_com_deduplicacao(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="LATE-1", status="PAGO")

    with SessionLocal() as db:
        pedido = db.query(Pedido).filter(Pedido.marketplace_id == "LATE-1").one()
        pedido.data_atualizacao = datetime.now(timezone.utc) - timedelta(hours=48)
        db.commit()

    primeira = autenticado.get("/api/notificacoes").json()
    assert any(notificacao["tipo"] == "atraso" for notificacao in primeira)

    segunda = autenticado.get("/api/notificacoes").json()
    atrasos = [notificacao for notificacao in segunda if notificacao["tipo"] == "atraso"]
    assert len(atrasos) == 1


def test_marcar_notificacoes_como_lidas(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="C-2", status="CANCELADO")
    notificacoes = autenticado.get("/api/notificacoes").json()
    assert len(notificacoes) == 1

    alvo = notificacoes[0]
    lida = autenticado.post(f"/api/notificacoes/{alvo['id']}/ler")
    assert lida.status_code == 200
    assert lida.json()["lida_em"] is not None

    assert (
        autenticado.get("/api/notificacoes", params={"apenas_nao_lidas": True}).json()
        == []
    )

    enviar(autenticado, integracao, loja, pedido_id="C-3", status="CANCELADO")
    resposta = autenticado.post("/api/notificacoes/ler-todas")
    assert resposta.status_code == 200
    assert resposta.json()["atualizadas"] == 1


def test_simulacao_autenticada_cria_integracao_e_pedido(autenticado, loja):
    resposta = autenticado.post(
        "/api/simular-webhook",
        json={
            "origem": "Mercado Livre",
            "pedido_id": "ML-TESTE",
            "status": "PAGO",
            "valor": 99.9,
        },
    )

    assert resposta.status_code == 200
    assert resposta.json()["criado"] is True

    integracoes = autenticado.get(f"/api/lojas/{loja['id']}/integracoes").json()
    assert [integracao["marketplace"] for integracao in integracoes] == ["Mercado Livre"]


def test_simulacao_exige_sessao(cliente):
    resposta = cliente.post(
        "/api/simular-webhook",
        json={"origem": "shopify", "pedido_id": "X", "status": "PAGO", "valor": 10},
    )

    assert resposta.status_code == 401


def test_stream_sse_entrega_evento_inicial(autenticado):
    with autenticado.stream("GET", "/api/stream") as resposta:
        assert resposta.status_code == 200
        assert resposta.headers["content-type"].startswith("text/event-stream")

        linhas = []
        for linha in resposta.iter_lines():
            linhas.append(linha)
            if "event: pronto" in linha:
                break

        assert any("event: pronto" in linha for linha in linhas)
