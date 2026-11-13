import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

import config
import models
from database import get_db

COOKIE_SESSAO = "pulso_sessao"
COOKIE_CSRF = "pulso_csrf"
COOKIE_2FA = "pulso_2fa"
DURACAO_SESSAO = 7 * 24 * 3600
DURACAO_2FA = 5 * 60

SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32


def gerar_hash_senha(senha: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        senha.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verificar_senha(senha: str, armazenado: str) -> bool:
    try:
        algoritmo, n, r, p, salt_hex, digest_hex = armazenado.split("$")
        if algoritmo != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        esperado = bytes.fromhex(digest_hex)
        digest = hashlib.scrypt(
            senha.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(esperado),
        )
        return hmac.compare_digest(digest, esperado)
    except (ValueError, TypeError):
        return False


def _b64codificar(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).decode("ascii").rstrip("=")


def _b64decodificar(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def _assinatura(corpo: str) -> str:
    chave = config.session_secret().encode("utf-8")
    return _b64codificar(hmac.new(chave, corpo.encode("ascii"), hashlib.sha256).digest())


def criar_valor_sessao(usuario_id: int, loja_id: int) -> str:
    payload = {
        "sub": usuario_id,
        "loja": loja_id,
        "exp": int(time.time()) + DURACAO_SESSAO,
    }
    corpo = _b64codificar(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{corpo}.{_assinatura(corpo)}"


def ler_valor_sessao(valor: str | None) -> dict | None:
    if not valor:
        return None
    try:
        corpo, assinatura = valor.split(".")
    except ValueError:
        return None

    if not hmac.compare_digest(assinatura, _assinatura(corpo)):
        return None

    try:
        payload = json.loads(_b64decodificar(corpo))
    except (ValueError, TypeError):
        return None

    if not isinstance(payload, dict):
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    if not isinstance(payload.get("sub"), int) or not isinstance(payload.get("loja"), int):
        return None
    return payload


def criar_valor_2fa(usuario_id: int) -> str:
    payload = {
        "sub": usuario_id,
        "p2fa": True,
        "exp": int(time.time()) + DURACAO_2FA,
    }
    corpo = _b64codificar(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{corpo}.{_assinatura(corpo)}"


def ler_valor_2fa(valor: str | None) -> dict | None:
    if not valor:
        return None
    try:
        corpo, assinatura = valor.split(".")
    except ValueError:
        return None
    if not hmac.compare_digest(assinatura, _assinatura(corpo)):
        return None
    try:
        payload = json.loads(_b64decodificar(corpo))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("p2fa") is not True:
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    if not isinstance(payload.get("sub"), int):
        return None
    return payload


def definir_cookie_sessao(response: Response, usuario_id: int, loja_id: int) -> None:
    response.set_cookie(
        COOKIE_SESSAO,
        criar_valor_sessao(usuario_id, loja_id),
        max_age=DURACAO_SESSAO,
        httponly=True,
        samesite="lax",
        secure=config.cookie_secure(),
        path="/",
    )


def limpar_cookie_sessao(response: Response) -> None:
    response.delete_cookie(COOKIE_SESSAO, path="/")


def definir_cookie_csrf(response: Response) -> None:
    response.set_cookie(
        COOKIE_CSRF,
        secrets.token_urlsafe(24),
        max_age=DURACAO_SESSAO,
        httponly=False,
        samesite="lax",
        secure=config.cookie_secure(),
        path="/",
    )


def garantir_cookie_csrf(request: Request, response: Response) -> None:
    if not request.cookies.get(COOKIE_CSRF):
        definir_cookie_csrf(response)


def limpar_cookie_csrf(response: Response) -> None:
    response.delete_cookie(COOKIE_CSRF, path="/")


def definir_cookie_2fa(response: Response, usuario_id: int) -> None:
    response.set_cookie(
        COOKIE_2FA,
        criar_valor_2fa(usuario_id),
        max_age=DURACAO_2FA,
        httponly=True,
        samesite="lax",
        secure=config.cookie_secure(),
        path="/",
    )


def limpar_cookie_2fa(response: Response) -> None:
    response.delete_cookie(COOKIE_2FA, path="/")


def lojas_do_usuario(db: Session, usuario_id: int) -> list[models.Loja]:
    return (
        db.query(models.Loja)
        .join(models.UsuarioLoja, models.UsuarioLoja.loja_id == models.Loja.id)
        .filter(models.UsuarioLoja.usuario_id == usuario_id)
        .order_by(models.Loja.nome)
        .all()
    )


def usuario_tem_loja(db: Session, usuario_id: int, loja_id: int) -> bool:
    return (
        db.query(models.UsuarioLoja)
        .filter(
            models.UsuarioLoja.usuario_id == usuario_id,
            models.UsuarioLoja.loja_id == loja_id,
        )
        .first()
        is not None
    )


def exigir_loja(db: Session, usuario_id: int, loja_id: int) -> models.Loja:
    if not usuario_tem_loja(db, usuario_id, loja_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Loja não disponível")
    loja = db.get(models.Loja, loja_id)
    if loja is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loja não encontrada")
    return loja


@dataclass
class SessaoAtiva:
    usuario: models.Usuario
    loja: models.Loja


def obter_sessao(request: Request, db: Session = Depends(get_db)) -> SessaoAtiva:
    dados = ler_valor_sessao(request.cookies.get(COOKIE_SESSAO))
    if dados is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão expirada ou ausente",
            headers={"WWW-Authenticate": "Cookie"},
        )

    usuario = db.get(models.Usuario, dados["sub"])
    if usuario is None or not usuario.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário inválido")

    if not usuario_tem_loja(db, usuario.id, dados["loja"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Loja não vinculada")

    loja = db.get(models.Loja, dados["loja"])
    if loja is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Loja não encontrada")

    return SessaoAtiva(usuario=usuario, loja=loja)


def autenticar(db: Session, email: str, senha: str) -> models.Usuario | None:
    usuario = (
        db.query(models.Usuario)
        .filter(models.Usuario.email == email.strip().lower())
        .one_or_none()
    )
    if usuario is None or not usuario.ativo:
        return None
    if not verificar_senha(senha, usuario.senha_hash):
        return None
    return usuario


def e_admin(usuario: models.Usuario) -> bool:
    return (usuario.papel or "admin") == "admin"


def exigir_admin(sessao: "SessaoAtiva") -> None:
    if not e_admin(sessao.usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ação restrita a administradores",
        )
