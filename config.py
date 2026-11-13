import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _carregar_env() -> None:
    arquivo = BASE_DIR / ".env"
    if not arquivo.exists():
        return
    try:
        linhas = arquivo.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for linha in linhas:
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        chave = chave.strip()
        if not chave:
            continue
        valor = valor.strip().strip('"').strip("'")
        os.environ.setdefault(chave, valor)


_carregar_env()

APP_NAME = "Pulso · API de Webhooks"
APP_VERSION = "1.3.0"

DEFAULT_DATABASE_URL = f"sqlite:///{(BASE_DIR / 'ecommerce.db').as_posix()}"

DEV_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
]


def database_url() -> str:
    url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL).strip()
    # Provedores costumam entregar a URL sem o driver psycopg.
    for prefixo in ("postgres://", "postgresql://"):
        if url.startswith(prefixo):
            return "postgresql+psycopg://" + url[len(prefixo):]
    return url


def allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS")
    if not raw:
        return list(DEV_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or list(DEV_ORIGINS)


def _arquivo_segredo_sessao() -> Path:
    # Em container o segredo precisa morar no volume, senão cada deploy
    # derruba as sessões de todos os usuários.
    caminho = os.getenv("PULSO_SESSAO_ARQUIVO", "").strip()
    if caminho:
        return Path(caminho)
    return BASE_DIR / ".pulso-sessao"


def session_secret() -> str:
    fornecido = os.getenv("SESSION_SECRET")
    if fornecido:
        return fornecido

    arquivo = _arquivo_segredo_sessao()
    try:
        if arquivo.exists():
            valor = arquivo.read_text(encoding="utf-8").strip()
            if valor:
                return valor
        valor = secrets.token_hex(32)
        arquivo.write_text(valor, encoding="utf-8")
        return valor
    except OSError:
        # Sem persistência, as sessões caem quando o processo reinicia.
        return secrets.token_hex(32)


def cookie_secure() -> bool:
    return os.getenv("PULSO_COOKIE_SECURE", "0").lower() in {"1", "true", "sim", "yes"}


def admin_email() -> str:
    return os.getenv("PULSO_ADMIN_EMAIL", "admin@pulso.local").strip().lower()


def admin_senha() -> str:
    return os.getenv("PULSO_ADMIN_SENHA", "pulso123")


def loja_padrao() -> str:
    return os.getenv("PULSO_LOJA_PADRAO", "Minha Loja").strip() or "Minha Loja"


def webhook_tolerancia_segundos() -> int:
    try:
        return max(30, int(os.getenv("PULSO_WEBHOOK_TOLERANCIA", "300")))
    except ValueError:
        return 300


def backup_ativo() -> bool:
    return os.getenv("PULSO_BACKUP", "1").lower() not in {"0", "false", "nao", "não"}


def _booleano(nome: str, padrao: str = "1") -> bool:
    return os.getenv(nome, padrao).strip().lower() not in {"0", "false", "nao", "não", "off"}


def _inteiro(nome: str, padrao: int, minimo: int = 0) -> int:
    try:
        return max(minimo, int(os.getenv(nome, str(padrao))))
    except ValueError:
        return padrao


def redis_url() -> str | None:
    valor = os.getenv("REDIS_URL", "").strip()
    return valor or None


def retencao_dias() -> int:
    return _inteiro("PULSO_RETENCAO_DIAS", 90)


def retencao_intervalo_horas() -> int:
    return _inteiro("PULSO_RETENCAO_INTERVALO_HORAS", 24, minimo=1)


def alertas_externas_ativas() -> bool:
    return _booleano("PULSO_ALERTAS_EXTERNAS", "1")


def alerta_timeout_segundos() -> int:
    return _inteiro("PULSO_ALERTA_TIMEOUT", 8, minimo=1)


def alerta_max_tentativas() -> int:
    return _inteiro("PULSO_ALERTA_MAX_TENTATIVAS", 4, minimo=1)


def alerta_backoff_segundos() -> list[int]:
    bruto = os.getenv("PULSO_ALERTA_BACKOFF", "60,300,900")
    valores: list[int] = []
    for parte in bruto.split(","):
        try:
            valor = int(parte.strip())
        except ValueError:
            continue
        if valor > 0:
            valores.append(valor)
    return valores or [60, 300, 900]


def alerta_retentativa_intervalo() -> int:
    return _inteiro("PULSO_ALERTA_RETENTATIVA_INTERVALO", 30, minimo=5)


def smtp_host() -> str | None:
    valor = os.getenv("PULSO_SMTP_HOST", "").strip()
    return valor or None


def smtp_porta() -> int:
    return _inteiro("PULSO_SMTP_PORTA", 587, minimo=1)


def smtp_usuario() -> str | None:
    valor = os.getenv("PULSO_SMTP_USUARIO", "").strip()
    return valor or None


def smtp_senha() -> str | None:
    valor = os.getenv("PULSO_SMTP_SENHA", "")
    return valor or None


def smtp_seguranca() -> str:
    valor = os.getenv("PULSO_SMTP_SEGURANCA", "starttls").strip().lower()
    return valor if valor in {"starttls", "ssl", "nenhuma"} else "starttls"


def alerta_remetente() -> str | None:
    valor = os.getenv("PULSO_ALERTA_REMETENTE", "").strip() or smtp_usuario()
    return valor or None


def telegram_bot_token() -> str | None:
    valor = os.getenv("PULSO_TELEGRAM_BOT_TOKEN", "").strip()
    return valor or None


def whatsapp_token() -> str | None:
    valor = os.getenv("PULSO_WHATSAPP_TOKEN", "").strip()
    return valor or None


def whatsapp_phone_id() -> str | None:
    valor = os.getenv("PULSO_WHATSAPP_PHONE_ID", "").strip()
    return valor or None


def whatsapp_template() -> str:
    return os.getenv("PULSO_WHATSAPP_TEMPLATE", "pulso_alerta").strip() or "pulso_alerta"


def whatsapp_idioma() -> str:
    return os.getenv("PULSO_WHATSAPP_IDIOMA", "pt_BR").strip() or "pt_BR"


def csrf_ativo() -> bool:
    return _booleano("PULSO_CSRF", "1")


def rate_limit_ativo() -> bool:
    return _booleano("PULSO_RATE_LIMIT", "1")


def rate_limit_login() -> int:
    return _inteiro("PULSO_RATE_LIMIT_LOGIN", 10, minimo=1)


def rate_limit_webhook() -> int:
    return _inteiro("PULSO_RATE_LIMIT_WEBHOOK", 300, minimo=1)


def rate_limit_janela_segundos() -> int:
    return _inteiro("PULSO_RATE_LIMIT_JANELA", 60, minimo=1)


def log_json() -> bool:
    return _booleano("PULSO_LOG_JSON", "0")


def sentry_dsn() -> str | None:
    valor = os.getenv("SENTRY_DSN", "").strip()
    return valor or None


def sentry_ambiente() -> str:
    return os.getenv("PULSO_AMBIENTE", os.getenv("SENTRY_ENVIRONMENT", "producao"))


def confiar_proxy() -> bool:
    return _booleano("PULSO_TRUST_PROXY", "0")


def painel_url() -> str | None:
    valor = os.getenv("PULSO_PAINEL_URL", "").strip()
    return valor.rstrip("/") or None


def servir_frontend() -> bool:
    # Ligado na imagem Docker: a API também entrega o painel compilado,
    # o que mantém cookie e CSRF na mesma origem.
    return _booleano("PULSO_SERVIR_FRONTEND", "0")
