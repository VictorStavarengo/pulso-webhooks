import os
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.gettempdir()) / "pulso_api_test.db"
for sufixo in ("", "-wal", "-shm"):
    Path(f"{TEST_DB}{sufixo}").unlink(missing_ok=True)

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["SESSION_SECRET"] = "segredo-de-teste-pulso"
os.environ["PULSO_ADMIN_EMAIL"] = "admin@pulso.local"
os.environ["PULSO_ADMIN_SENHA"] = "pulso123"
os.environ["PULSO_LOJA_PADRAO"] = "Loja Teste"
os.environ["PULSO_BACKUP"] = "0"
os.environ["PULSO_RETENCAO_DIAS"] = "0"
os.environ["PULSO_ALERTAS_EXTERNAS"] = "0"
os.environ["PULSO_RATE_LIMIT_LOGIN"] = "10000"
os.environ["PULSO_RATE_LIMIT_WEBHOOK"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import config  # noqa: E402
import models  # noqa: E402
import ratelimit  # noqa: E402
import security  # noqa: E402
from database import engine  # noqa: E402
from main import app  # noqa: E402

EMAIL = "admin@pulso.local"
SENHA = "pulso123"


@pytest.fixture(scope="session", autouse=True)
def remover_banco_de_teste():
    yield
    engine.dispose()
    for sufixo in ("", "-wal", "-shm"):
        try:
            Path(f"{TEST_DB}{sufixo}").unlink(missing_ok=True)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def banco_limpo():
    ratelimit.limpar()
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)
    yield
    ratelimit.limpar()


def novo_cliente() -> TestClient:
    cliente = TestClient(app)

    def sincronizar(request):
        valor = cliente.cookies.get(security.COOKIE_CSRF)
        if valor:
            request.headers["X-Pulso-Csrf"] = valor

    cliente.event_hooks["request"].append(sincronizar)
    return cliente


@pytest.fixture
def cliente():
    with novo_cliente() as test_client:
        yield test_client


@pytest.fixture
def autenticado(cliente):
    resposta = cliente.post("/api/auth/login", json={"email": EMAIL, "senha": SENHA})
    assert resposta.status_code == 200, resposta.text
    assert "requer_2fa" not in resposta.json(), resposta.text
    assert cliente.cookies.get(security.COOKIE_CSRF)
    return cliente


@pytest.fixture
def loja(autenticado):
    return autenticado.get("/api/auth/me").json()["loja"]


@pytest.fixture
def integracao(autenticado, loja):
    resposta = autenticado.post(
        f"/api/lojas/{loja['id']}/integracoes",
        json={"marketplace": "Shopee"},
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


@pytest.fixture
def habilitar_alertas(monkeypatch):
    monkeypatch.setenv("PULSO_ALERTAS_EXTERNAS", "1")
    monkeypatch.delenv("PULSO_SMTP_HOST", raising=False)
    monkeypatch.delenv("PULSO_TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("PULSO_WHATSAPP_TOKEN", raising=False)
    assert config.alertas_externas_ativas() is True
