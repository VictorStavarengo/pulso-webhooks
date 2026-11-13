from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
import security


def loja_ids_do_usuario(db: Session, usuario_id: int) -> list[int]:
    return [
        linha[0]
        for linha in db.query(models.UsuarioLoja.loja_id)
        .filter(models.UsuarioLoja.usuario_id == usuario_id)
        .order_by(models.UsuarioLoja.loja_id)
        .all()
    ]


def usuario_admin_out(db: Session, usuario: models.Usuario) -> schemas.UsuarioAdminOut:
    return schemas.UsuarioAdminOut(
        id=usuario.id,
        nome=usuario.nome,
        email=usuario.email,
        papel=usuario.papel or "operador",
        ativo=usuario.ativo,
        totp_ativo=usuario.totp_ativo,
        criado_em=usuario.criado_em,
        loja_ids=loja_ids_do_usuario(db, usuario.id),
    )


def resolver_lojas(db: Session, sessao: security.SessaoAtiva, loja_ids: list[int]) -> list[int]:
    ids = list(dict.fromkeys(loja_ids))
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selecione ao menos uma loja para o usuário",
        )
    permitidas = {loja.id for loja in security.lojas_do_usuario(db, sessao.usuario.id)}
    if any(loja_id not in permitidas for loja_id in ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você só pode conceder acesso às lojas que administra",
        )
    return ids


def contar_admins_ativos(db: Session, excluir_id: int | None = None) -> int:
    consulta = db.query(func.count(models.Usuario.id)).filter(
        models.Usuario.papel == "admin",
        models.Usuario.ativo.is_(True),
    )
    if excluir_id is not None:
        consulta = consulta.filter(models.Usuario.id != excluir_id)
    return int(consulta.scalar() or 0)
