from database import SessionLocal
from models import EnvioAlerta, Notificacao
from test_api import enviar

import alertas


def _configurar_canais(autenticado, loja, **canais):
    corpo = {
        "notificar_email": True,
        "alerta_email": "ops@loja.com",
        "notificar_telegram": True,
        "alerta_telegram": "@pulso_alertas",
        "notificar_whatsapp": True,
        "alerta_whatsapp": "+55 11 99999-0000",
    }
    corpo.update(canais)
    resposta = autenticado.patch(f"/api/lojas/{loja['id']}/configuracoes", json=corpo)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def _capturar_envios(monkeypatch):
    chamadas: list[tuple] = []

    def fake(canal):
        def enviar(*args):
            chamadas.append((canal, *args))

        return enviar

    for canal in ("email", "telegram", "whatsapp"):
        monkeypatch.setitem(alertas._ENVIADORES, canal, fake(canal))
    return chamadas


def test_teste_de_alerta_usa_todos_os_canais(autenticado, loja, monkeypatch):
    configurada = _configurar_canais(autenticado, loja)
    assert configurada["notificar_email"] is True
    assert configurada["alerta_whatsapp"] == "5511999990000"
    chamadas = _capturar_envios(monkeypatch)

    resposta = autenticado.post(f"/api/lojas/{loja['id']}/alertas/teste")

    assert resposta.status_code == 200, resposta.text
    resultados = resposta.json()
    assert {item["canal"] for item in resultados} == {"email", "telegram", "whatsapp"}
    assert all(item["status"] == "enviado" for item in resultados)
    assert {item["destino"] for item in resultados} == {
        "ops@loja.com",
        "@pulso_alertas",
        "5511999990000",
    }
    assert [canal for canal, *_ in chamadas] == ["email", "telegram", "whatsapp"]


def test_canal_sem_credencial_fica_ignorado(autenticado, loja):
    _configurar_canais(
        autenticado,
        loja,
        notificar_telegram=False,
        notificar_whatsapp=False,
    )

    resultados = autenticado.post(f"/api/lojas/{loja['id']}/alertas/teste").json()

    assert len(resultados) == 1
    assert resultados[0]["canal"] == "email"
    assert resultados[0]["status"] == "ignorado"
    assert "SMTP" in resultados[0]["erro"]


def test_falha_de_envio_vira_registro_de_erro(autenticado, loja, monkeypatch):
    _configurar_canais(
        autenticado,
        loja,
        notificar_telegram=False,
        notificar_whatsapp=False,
    )

    def falhar(*_args):
        raise RuntimeError("servidor SMTP recusou")

    monkeypatch.setitem(alertas._ENVIADORES, "email", falhar)

    resultados = autenticado.post(f"/api/lojas/{loja['id']}/alertas/teste").json()

    assert resultados[0]["status"] == "erro"
    assert "recusou" in resultados[0]["erro"]


def test_sem_canais_nao_envia_nada(autenticado, loja):
    resposta = autenticado.post(f"/api/lojas/{loja['id']}/alertas/teste")
    assert resposta.status_code == 200
    assert resposta.json() == []


def test_despacho_registra_auditoria_por_canal(
    autenticado, integracao, loja, monkeypatch
):
    _configurar_canais(autenticado, loja)
    chamadas = _capturar_envios(monkeypatch)
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "0")

    enviar(autenticado, integracao, loja, pedido_id="ALERTA-1", status="CANCELADO")

    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "1")

    with SessionLocal() as db:
        notificacao = (
            db.query(Notificacao)
            .filter(Notificacao.tipo == "cancelado")
            .one()
        )
        alertas.despachar_notificacoes([notificacao.id])

        registros = db.query(EnvioAlerta).all()
        assert {item.canal for item in registros} == {"email", "telegram", "whatsapp"}
        assert all(item.status == "enviado" for item in registros)
        assert all(item.notificacao_id == notificacao.id for item in registros)
        assert all(item.erro is None for item in registros)

    assert len(chamadas) == 3
    assert "ALERTA-1" in chamadas[0][3]


def test_alertas_desativados_nao_despacham(
    autenticado, integracao, loja, monkeypatch
):
    _configurar_canais(autenticado, loja)
    chamadas = _capturar_envios(monkeypatch)
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "0")

    enviar(autenticado, integracao, loja, pedido_id="ALERTA-2", status="CANCELADO")

    with SessionLocal() as db:
        notificacao = (
            db.query(Notificacao)
            .filter(Notificacao.tipo == "cancelado")
            .one()
        )
        alertas.despachar_notificacoes([notificacao.id])
        assert db.query(EnvioAlerta).count() == 0

    assert chamadas == []


def _notificacao_cancelada(db) -> Notificacao:
    return db.query(Notificacao).filter(Notificacao.tipo == "cancelado").one()


def test_falha_agenda_retentativa_e_reentrega(
    autenticado, integracao, loja, monkeypatch
):
    _configurar_canais(
        autenticado, loja, notificar_telegram=False, notificar_whatsapp=False
    )
    monkeypatch.setenv("PULSO_ALERTA_BACKOFF", "5,10,20")
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "0")

    enviar(autenticado, integracao, loja, pedido_id="RETRY-1", status="CANCELADO")
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "1")

    def falhar(*_args):
        raise RuntimeError("timeout do SMTP")

    monkeypatch.setitem(alertas._ENVIADORES, "email", falhar)

    with SessionLocal() as db:
        notificacao = _notificacao_cancelada(db)
        alertas.despachar_notificacoes([notificacao.id])

        envio = db.query(EnvioAlerta).one()
        assert envio.status == "pendente"
        assert envio.tentativas == 1
        assert envio.proxima_tentativa_em is not None
        assert "timeout" in envio.erro
        proxima = envio.proxima_tentativa_em

    entregues: list[tuple] = []
    monkeypatch.setitem(
        alertas._ENVIADORES, "email", lambda *args: entregues.append(args)
    )

    assert alertas.processar_retentativas(agora=proxima) == 1

    with SessionLocal() as db:
        envio = db.query(EnvioAlerta).one()
        assert envio.status == "enviado"
        assert envio.tentativas == 2
        assert envio.proxima_tentativa_em is None
        assert envio.erro is None

    assert len(entregues) == 1
    assert "RETRY-1" in entregues[0][2]


def test_falha_persistente_vira_dead_letter(
    autenticado, integracao, loja, monkeypatch
):
    _configurar_canais(
        autenticado, loja, notificar_telegram=False, notificar_whatsapp=False
    )
    monkeypatch.setenv("PULSO_ALERTA_MAX_TENTATIVAS", "2")
    monkeypatch.setenv("PULSO_ALERTA_BACKOFF", "5")
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "0")

    enviar(autenticado, integracao, loja, pedido_id="RETRY-2", status="CANCELADO")
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "1")

    def falhar(*_args):
        raise RuntimeError("servidor indisponível")

    monkeypatch.setitem(alertas._ENVIADORES, "email", falhar)

    with SessionLocal() as db:
        alertas.despachar_notificacoes([_notificacao_cancelada(db).id])
        envio = db.query(EnvioAlerta).one()
        assert envio.status == "pendente"
        proxima = envio.proxima_tentativa_em

    assert alertas.processar_retentativas(agora=proxima) == 1

    with SessionLocal() as db:
        envio = db.query(EnvioAlerta).one()
        assert envio.status == "descartado"
        assert envio.tentativas == 2
        assert envio.proxima_tentativa_em is None
        assert "indisponível" in envio.erro

    assert alertas.processar_retentativas() == 0


def test_api_lista_fila_e_dead_letter(
    autenticado, integracao, loja, monkeypatch
):
    _configurar_canais(
        autenticado, loja, notificar_telegram=False, notificar_whatsapp=False
    )
    monkeypatch.setenv("PULSO_ALERTA_MAX_TENTATIVAS", "1")
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "0")

    enviar(autenticado, integracao, loja, pedido_id="RETRY-3", status="CANCELADO")
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "1")

    def falhar(*_args):
        raise RuntimeError("falha definitiva")

    monkeypatch.setitem(alertas._ENVIADORES, "email", falhar)

    with SessionLocal() as db:
        alertas.despachar_notificacoes([_notificacao_cancelada(db).id])

    resposta = autenticado.get(f"/api/lojas/{loja['id']}/alertas/envios")
    assert resposta.status_code == 200, resposta.text
    registros = resposta.json()
    assert len(registros) == 1
    assert registros[0]["canal"] == "email"
    assert registros[0]["status"] == "descartado"
    assert registros[0]["tentativas"] == 1
    assert registros[0]["proxima_tentativa_em"] is None
    assert registros[0]["notificacao_id"] > 0

    vazio = autenticado.get(
        f"/api/lojas/{loja['id']}/alertas/envios?status=pendente"
    )
    assert vazio.status_code == 200
    assert vazio.json() == []
