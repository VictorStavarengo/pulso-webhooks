from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

import config
import models
import ratelimit
import schemas
import security
import servicos
import totp
from database import get_db

router = APIRouter(tags=["sessão"])


def montar_sessao(db: Session, usuario: models.Usuario, loja: models.Loja) -> schemas.SessaoOut:
    lojas = security.lojas_do_usuario(db, usuario.id)
    return schemas.SessaoOut(
        usuario=schemas.UsuarioOut.model_validate(usuario),
        lojas=[schemas.LojaOut.model_validate(item) for item in lojas],
        loja=schemas.LojaOut.model_validate(loja),
    )


@router.post(
    "/api/auth/login",
    response_model=schemas.SessaoOut | schemas.Desafio2FAOut,
)
def login(
    dados: schemas.LoginEntrada,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> schemas.SessaoOut | schemas.Desafio2FAOut:
    servicos.aplicar_limite(
        f"login:{ratelimit.obter_ip(request)}:{dados.email}",
        config.rate_limit_login(),
    )
    usuario = security.autenticar(db, dados.email, dados.senha)
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou senha inválidos",
        )

    lojas = security.lojas_do_usuario(db, usuario.id)
    if not lojas:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário sem loja vinculada",
        )

    if usuario.totp_ativo:
        security.definir_cookie_2fa(response, usuario.id)
        security.definir_cookie_csrf(response)
        return schemas.Desafio2FAOut()

    loja = lojas[0]
    security.definir_cookie_sessao(response, usuario.id, loja.id)
    security.definir_cookie_csrf(response)
    return montar_sessao(db, usuario, loja)


@router.post(
    "/api/auth/2fa",
    response_model=schemas.SessaoOut,
    summary="Conclui o login com o código do autenticador",
)
def login_com_2fa(
    dados: schemas.Codigo2FAEntrada,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> schemas.SessaoOut:
    servicos.aplicar_limite(
        f"2fa:{ratelimit.obter_ip(request)}",
        config.rate_limit_login(),
    )
    pendente = security.ler_valor_2fa(request.cookies.get(security.COOKIE_2FA))
    if pendente is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Desafio de verificação expirado. Entre novamente.",
        )

    usuario = db.get(models.Usuario, pendente["sub"])
    if usuario is None or not usuario.ativo or not usuario.totp_ativo:
        security.limpar_cookie_2fa(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário inválido")

    if not totp.verificar_codigo(usuario.totp_secret, dados.codigo):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Código de verificação inválido",
        )

    lojas = security.lojas_do_usuario(db, usuario.id)
    if not lojas:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário sem loja vinculada",
        )

    security.limpar_cookie_2fa(response)
    security.definir_cookie_sessao(response, usuario.id, lojas[0].id)
    security.definir_cookie_csrf(response)
    return montar_sessao(db, usuario, lojas[0])


@router.post("/api/auth/2fa/iniciar", response_model=schemas.TotpInicioOut)
def iniciar_2fa(
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.TotpInicioOut:
    if sessao.usuario.totp_ativo:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A verificação em duas etapas já está ativa",
        )
    segredo = totp.gerar_segredo()
    sessao.usuario.totp_secret = segredo
    db.commit()
    url = totp.url_otpauth(sessao.usuario.email, segredo)
    return schemas.TotpInicioOut(segredo=segredo, otpauth_url=url, qr_svg=totp.qr_svg(url))


@router.post("/api/auth/2fa/ativar", response_model=schemas.UsuarioOut)
def ativar_2fa(
    dados: schemas.TotpAtivacaoEntrada,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Usuario:
    if sessao.usuario.totp_ativo:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="2FA já está ativo")
    if not totp.verificar_codigo(sessao.usuario.totp_secret, dados.codigo):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código inválido. Confira o relógio do dispositivo e tente novamente.",
        )
    sessao.usuario.totp_ativo = True
    db.commit()
    db.refresh(sessao.usuario)
    return sessao.usuario


@router.post("/api/auth/2fa/desativar", response_model=schemas.UsuarioOut)
def desativar_2fa(
    dados: schemas.TotpDesativacaoEntrada,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> models.Usuario:
    if not security.verificar_senha(dados.senha, sessao.usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Senha incorreta")
    sessao.usuario.totp_secret = None
    sessao.usuario.totp_ativo = False
    db.commit()
    db.refresh(sessao.usuario)
    return sessao.usuario


@router.post("/api/auth/logout")
def logout(response: Response) -> dict[str, str]:
    security.limpar_cookie_sessao(response)
    security.limpar_cookie_2fa(response)
    security.limpar_cookie_csrf(response)
    return {"mensagem": "Sessão encerrada"}


@router.get("/api/auth/me", response_model=schemas.SessaoOut)
def sessao_atual(
    request: Request,
    response: Response,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.SessaoOut:
    security.garantir_cookie_csrf(request, response)
    return montar_sessao(db, sessao.usuario, sessao.loja)


@router.post("/api/auth/loja", response_model=schemas.SessaoOut)
def trocar_loja(
    dados: schemas.TrocarLojaEntrada,
    response: Response,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.SessaoOut:
    loja = security.exigir_loja(db, sessao.usuario.id, dados.loja_id)
    security.definir_cookie_sessao(response, sessao.usuario.id, loja.id)
    security.definir_cookie_csrf(response)
    return montar_sessao(db, sessao.usuario, loja)
