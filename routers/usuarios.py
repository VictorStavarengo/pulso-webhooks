from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

import equipe
import models
import schemas
import security
from database import get_db

router = APIRouter()


@router.get(
    "/api/usuarios",
    response_model=list[schemas.UsuarioAdminOut],
    tags=["equipe"],
)
def listar_usuarios(
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> list[schemas.UsuarioAdminOut]:
    security.exigir_admin(sessao)
    permitidas = {loja.id for loja in security.lojas_do_usuario(db, sessao.usuario.id)}
    usuarios = db.query(models.Usuario).order_by(models.Usuario.nome).all()
    return [
        equipe.usuario_admin_out(db, usuario)
        for usuario in usuarios
        if usuario.id == sessao.usuario.id
        or permitidas.intersection(equipe.loja_ids_do_usuario(db, usuario.id))
    ]


@router.post(
    "/api/usuarios",
    response_model=schemas.UsuarioAdminOut,
    status_code=status.HTTP_201_CREATED,
    tags=["equipe"],
)
def criar_usuario(
    dados: schemas.UsuarioEntrada,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.UsuarioAdminOut:
    security.exigir_admin(sessao)
    existente = (
        db.query(models.Usuario)
        .filter(func.lower(models.Usuario.email) == dados.email)
        .one_or_none()
    )
    if existente is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe um usuário com este e-mail",
        )

    lojas = equipe.resolver_lojas(db, sessao, dados.loja_ids or [sessao.loja.id])
    usuario = models.Usuario(
        nome=dados.nome,
        email=dados.email,
        senha_hash=security.gerar_hash_senha(dados.senha),
        papel=dados.papel,
        ativo=True,
    )
    db.add(usuario)
    db.flush()
    for loja_id in lojas:
        db.add(models.UsuarioLoja(usuario_id=usuario.id, loja_id=loja_id))
    db.commit()
    db.refresh(usuario)
    return equipe.usuario_admin_out(db, usuario)


@router.patch(
    "/api/usuarios/{usuario_id}",
    response_model=schemas.UsuarioAdminOut,
    tags=["equipe"],
)
def atualizar_usuario(
    usuario_id: int,
    dados: schemas.UsuarioAtualizacao,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.UsuarioAdminOut:
    security.exigir_admin(sessao)
    usuario = db.get(models.Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado"
        )

    if usuario.id == sessao.usuario.id:
        if dados.papel is not None and dados.papel != "admin":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Você não pode remover seu próprio acesso de administrador",
            )
        if dados.ativo is False:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Você não pode desativar a própria conta",
            )

    era_admin_ativo = (usuario.papel or "admin") == "admin" and usuario.ativo
    perde_admin = era_admin_ativo and (
        (dados.papel is not None and dados.papel != "admin") or dados.ativo is False
    )
    if perde_admin and equipe.contar_admins_ativos(db, excluir_id=usuario.id) == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="É preciso manter ao menos um administrador ativo",
        )

    if dados.nome is not None:
        usuario.nome = dados.nome
    if dados.papel is not None:
        usuario.papel = dados.papel
    if dados.ativo is not None:
        usuario.ativo = dados.ativo
    if dados.senha:
        usuario.senha_hash = security.gerar_hash_senha(dados.senha)

    if dados.loja_ids is not None:
        lojas = equipe.resolver_lojas(db, sessao, dados.loja_ids)
        db.query(models.UsuarioLoja).filter(
            models.UsuarioLoja.usuario_id == usuario.id
        ).delete(synchronize_session=False)
        for loja_id in lojas:
            db.add(models.UsuarioLoja(usuario_id=usuario.id, loja_id=loja_id))

    db.commit()
    db.refresh(usuario)
    return equipe.usuario_admin_out(db, usuario)
