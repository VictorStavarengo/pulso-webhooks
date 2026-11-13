import pyotp
import pytest

import ratelimit
import security
from conftest import EMAIL, SENHA, novo_cliente
from test_api import enviar


def _codigo(segredo: str) -> str:
    return pyotp.TOTP(segredo).now()


def test_csrf_bloqueia_mutacao_sem_token(autenticado):
    autenticado.event_hooks["request"].clear()

    resposta = autenticado.post("/api/lojas", json={"nome": "Loja CSRF"})
    assert resposta.status_code == 403
    assert "CSRF" in resposta.json()["detail"]

    autenticado.headers["X-Pulso-Csrf"] = autenticado.cookies.get(security.COOKIE_CSRF)
    assert autenticado.post("/api/lojas", json={"nome": "Loja CSRF"}).status_code == 201


def test_csrf_nao_bloqueia_leitura_nem_login(cliente):
    assert cliente.get("/health").status_code == 200
    assert cliente.get("/api/auth/me").status_code == 401
    assert cliente.get("/api/pedidos").status_code == 401


def test_rate_limit_de_login(monkeypatch, cliente):
    monkeypatch.setenv("PULSO_RATE_LIMIT_LOGIN", "2")
    ratelimit.limpar()

    assert cliente.post(
        "/api/auth/login", json={"email": EMAIL, "senha": "errada"}
    ).status_code == 401
    assert cliente.post(
        "/api/auth/login", json={"email": EMAIL, "senha": "errada"}
    ).status_code == 401

    bloqueado = cliente.post("/api/auth/login", json={"email": EMAIL, "senha": SENHA})
    assert bloqueado.status_code == 429
    assert bloqueado.headers["Retry-After"]


def test_fluxo_completo_de_2fa(autenticado):
    inicio = autenticado.post("/api/auth/2fa/iniciar")
    assert inicio.status_code == 200
    dados = inicio.json()
    assert dados["segredo"]
    assert dados["otpauth_url"].startswith("otpauth://totp/")
    assert "<svg" in dados["qr_svg"]

    invalido = autenticado.post("/api/auth/2fa/ativar", json={"codigo": "000000"})
    assert invalido.status_code == 400

    ativado = autenticado.post(
        "/api/auth/2fa/ativar", json={"codigo": _codigo(dados["segredo"])}
    )
    assert ativado.status_code == 200
    assert ativado.json()["totp_ativo"] is True
    assert autenticado.post("/api/auth/2fa/iniciar").status_code == 409

    autenticado.post("/api/auth/logout")

    desafio = autenticado.post("/api/auth/login", json={"email": EMAIL, "senha": SENHA})
    assert desafio.status_code == 200
    assert desafio.json()["requer_2fa"] is True
    assert "pulso_sessao" not in autenticado.cookies
    assert autenticado.get("/api/auth/me").status_code == 401

    errado = autenticado.post("/api/auth/2fa", json={"codigo": "123456"})
    assert errado.status_code == 401

    sessao = autenticado.post(
        "/api/auth/2fa", json={"codigo": _codigo(dados["segredo"])}
    )
    assert sessao.status_code == 200
    assert sessao.json()["usuario"]["totp_ativo"] is True
    assert autenticado.get("/api/auth/me").status_code == 200

    desativado = autenticado.post("/api/auth/2fa/desativar", json={"senha": SENHA})
    assert desativado.status_code == 200
    assert desativado.json()["totp_ativo"] is False
    assert autenticado.post(
        "/api/auth/2fa/desativar", json={"senha": "errada"}
    ).status_code == 401


def test_papeis_operador_nao_administra(autenticado, loja):
    criacao = autenticado.post(
        "/api/usuarios",
        json={
            "nome": "Operador Um",
            "email": "operador@pulso.local",
            "senha": "senha12345",
            "papel": "operador",
            "loja_ids": [loja["id"]],
        },
    )
    assert criacao.status_code == 201, criacao.text
    assert criacao.json()["papel"] == "operador"

    usuarios = autenticado.get("/api/usuarios").json()
    assert any(item["email"] == "operador@pulso.local" for item in usuarios)

    with novo_cliente() as operador:
        login = operador.post(
            "/api/auth/login",
            json={"email": "operador@pulso.local", "senha": "senha12345"},
        )
        assert login.status_code == 200
        assert login.json()["usuario"]["papel"] == "operador"

        assert operador.get("/api/pedidos").status_code == 200
        assert operador.get("/api/notificacoes").status_code == 200
        assert operador.post("/api/lojas", json={"nome": "Nova"}).status_code == 403
        assert operador.patch(
            f"/api/lojas/{loja['id']}/configuracoes", json={"atraso_horas": 5}
        ).status_code == 403
        assert operador.get(f"/api/lojas/{loja['id']}/integracoes").status_code == 403
        assert operador.post(
            "/api/simular-webhook",
            json={"origem": "Shopee", "pedido_id": "X", "status": "PAGO", "valor": 1},
        ).status_code == 403
        assert operador.get("/api/usuarios").status_code == 403
        assert operador.post("/api/manutencao/expurgar").status_code == 403


def test_ultimo_admin_nao_pode_ser_rebaixado(autenticado):
    sessao = autenticado.get("/api/auth/me").json()
    usuario_id = sessao["usuario"]["id"]

    rebaixar = autenticado.patch(
        f"/api/usuarios/{usuario_id}", json={"papel": "operador"}
    )
    assert rebaixar.status_code == 409
    assert autenticado.patch(
        f"/api/usuarios/{usuario_id}", json={"ativo": False}
    ).status_code == 409


def test_equipe_valida_lojas_e_email_unico(autenticado, loja):
    duplicado = autenticado.post(
        "/api/usuarios",
        json={
            "nome": "Outro Admin",
            "email": EMAIL,
            "senha": "senha12345",
            "papel": "admin",
        },
    )
    assert duplicado.status_code == 409

    loja_estranha = autenticado.post(
        "/api/usuarios",
        json={
            "nome": "Sem Loja",
            "email": "semloja@pulso.local",
            "senha": "senha12345",
            "loja_ids": [9999],
        },
    )
    assert loja_estranha.status_code == 403

    sem_lista = autenticado.post(
        "/api/usuarios",
        json={
            "nome": "Sem Lista",
            "email": "semlista@pulso.local",
            "senha": "senha12345",
            "loja_ids": [],
        },
    )
    assert sem_lista.status_code == 201
    assert sem_lista.json()["loja_ids"] == [loja["id"]]


def test_operador_ve_apenas_dados_da_loja_vinculada(autenticado, integracao, loja):
    enviar(autenticado, integracao, loja, pedido_id="OP-1")
    outra = autenticado.post("/api/lojas", json={"nome": "Loja Vizinha"}).json()
    autenticado.post("/api/auth/loja", json={"loja_id": outra["id"]})
    assert autenticado.get("/api/pedidos").json()["total"] == 0
    autenticado.post("/api/auth/loja", json={"loja_id": loja["id"]})
    assert autenticado.get("/api/pedidos").json()["total"] == 1
