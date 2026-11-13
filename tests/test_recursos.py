from datetime import datetime, timedelta, timezone

from database import SessionLocal
from models import Pedido
from test_api import enviar


def _pedido_id(autenticado, marketplace_id: str) -> int:
    itens = autenticado.get("/api/pedidos", params={"busca": marketplace_id}).json()["itens"]
    return itens[0]["id"]


def test_resumo_agrega_todos_os_pedidos_da_loja(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="R-1", status="PAGO", valor=100)
    enviar(autenticado, integracao, loja, pedido_id="R-2", status="ENVIADO", valor=200)
    enviar(autenticado, integracao, loja, pedido_id="R-3", status="CANCELADO", valor=300)

    corpo = autenticado.get("/api/pedidos", params={"por_pagina": 1}).json()
    resumo = corpo["resumo"]

    assert corpo["total"] == 3
    assert resumo["total"] == 3
    assert resumo["receita"] == 600
    assert resumo["ticket_medio"] == 200
    assert resumo["em_andamento"] == 2
    assert resumo["por_status"] == {"PAGO": 1, "ENVIADO": 1, "CANCELADO": 1}
    assert resumo["mais_antigo"] is not None


def test_filtro_por_periodo(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="ANTIGO")
    enviar(autenticado, integracao, loja, pedido_id="NOVO", valor=50)

    with SessionLocal() as db:
        pedido = db.query(Pedido).filter(Pedido.marketplace_id == "ANTIGO").one()
        pedido.data_atualizacao = datetime.now(timezone.utc) - timedelta(days=10)
        db.commit()

    hoje = datetime.now(timezone.utc).date().isoformat()
    de_ontem = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    recentes = autenticado.get(
        "/api/pedidos", params={"de": de_ontem, "ate": hoje}
    ).json()

    assert [item["marketplace_id"] for item in recentes["itens"]] == ["NOVO"]
    assert recentes["total"] == 1

    antigos = autenticado.get(
        "/api/pedidos",
        params={"de": (datetime.now(timezone.utc) - timedelta(days=20)).date().isoformat(), "ate": de_ontem},
    ).json()
    assert [item["marketplace_id"] for item in antigos["itens"]] == ["ANTIGO"]

    assert autenticado.get("/api/pedidos", params={"de": "2026-13-01"}).status_code == 422


def test_ordenacao_por_valor(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="V-1", valor=10)
    enviar(autenticado, integracao, loja, pedido_id="V-2", valor=30)
    enviar(autenticado, integracao, loja, pedido_id="V-3", valor=20)

    desc = autenticado.get("/api/pedidos", params={"ordenar": "valor_desc"}).json()["itens"]
    asc = autenticado.get("/api/pedidos", params={"ordenar": "valor_asc"}).json()["itens"]

    assert [item["marketplace_id"] for item in desc] == ["V-2", "V-3", "V-1"]
    assert [item["marketplace_id"] for item in asc] == ["V-1", "V-3", "V-2"]
    assert autenticado.get("/api/pedidos", params={"ordenar": "invalido"}).status_code == 422


def test_busca_tambem_encontra_cliente_e_id(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="CLI-1", cliente_nome="Ana Souza")
    enviar(autenticado, integracao, loja, pedido_id="CLI-2", cliente_nome="Bruno Lima")

    por_nome = autenticado.get("/api/pedidos", params={"busca": "bruno"}).json()["itens"]
    assert [item["marketplace_id"] for item in por_nome] == ["CLI-2"]

    alvo = _pedido_id(autenticado, "CLI-1")
    por_id = autenticado.get("/api/pedidos", params={"busca": str(alvo)}).json()["itens"]
    assert [item["id"] for item in por_id] == [alvo]


def test_detalhe_do_pedido_traz_historico(autenticado, integracao, loja):
    enviar(
        autenticado,
        integracao,
        loja,
        pedido_id="DET-1",
        evento_id="det-1",
        status="PAGO",
        cliente_nome="Carla",
    )
    enviar(
        autenticado,
        integracao,
        loja,
        pedido_id="DET-1",
        evento_id="det-2",
        status="ENVIADO",
        valor=320,
    )

    pedido_id = _pedido_id(autenticado, "DET-1")
    resposta = autenticado.get(f"/api/pedidos/{pedido_id}")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["pedido"]["marketplace_id"] == "DET-1"
    assert corpo["pedido"]["status_atual"] == "ENVIADO"
    assert corpo["pedido"]["cliente_nome"] == "Carla"
    assert [evento["evento_id"] for evento in corpo["eventos"]] == ["det-1", "det-2"]
    assert [evento["status"] for evento in corpo["eventos"]] == ["PAGO", "ENVIADO"]
    assert corpo["eventos"][1]["valor"] == 320
    assert all(evento["origem"] == "Shopee" for evento in corpo["eventos"])

    assert autenticado.get("/api/pedidos/99999").status_code == 404


def test_detalhe_respeita_isolamento_entre_lojas(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="DET-ISO")
    pedido_id = _pedido_id(autenticado, "DET-ISO")

    nova = autenticado.post("/api/lojas", json={"nome": "Loja Detalhe"}).json()
    assert autenticado.post("/api/auth/loja", json={"loja_id": nova["id"]}).status_code == 200

    assert autenticado.get(f"/api/pedidos/{pedido_id}").status_code == 404


def test_exportacao_csv_usa_filtros(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="CSV-1", status="PAGO", valor=10.5)
    enviar(autenticado, integracao, loja, pedido_id="CSV-2", status="CANCELADO", valor=99)

    resposta = autenticado.get("/api/pedidos/exportacao.csv", params={"status": "PAGO"})

    assert resposta.status_code == 200
    assert resposta.headers["content-type"].startswith("text/csv")
    assert "attachment" in resposta.headers["content-disposition"]
    texto = resposta.content.decode("utf-8")
    assert texto.startswith("\ufeff")
    assert "ID;Pedido;Status;Valor;Cliente;Atualizado em" in texto
    assert "CSV-1" in texto
    assert "10,50" in texto
    assert "CSV-2" not in texto
