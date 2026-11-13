import csv
import io
import json
import math
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
import schemas
import security
import servicos
from database import get_db

router = APIRouter()


def _filtrar_pedidos(
    consulta,
    status_filtro: str | None,
    busca: str | None,
    de: date | None,
    ate: date | None,
):
    if status_filtro:
        consulta = consulta.filter(models.Pedido.status_atual == status_filtro)

    termo = (busca or "").strip()
    if termo:
        filtro = or_(
            models.Pedido.marketplace_id.ilike(f"%{termo}%"),
            models.Pedido.cliente_nome.ilike(f"%{termo}%"),
        )
        if termo.isdigit():
            filtro = or_(filtro, models.Pedido.id == int(termo))
        consulta = consulta.filter(filtro)

    if de is not None:
        consulta = consulta.filter(
            models.Pedido.data_atualizacao
            >= datetime.combine(de, datetime.min.time(), tzinfo=timezone.utc)
        )
    if ate is not None:
        consulta = consulta.filter(
            models.Pedido.data_atualizacao
            <= datetime.combine(ate, datetime.max.time(), tzinfo=timezone.utc)
        )
    return consulta


def _ordenar_pedidos(consulta, ordenar: str):
    if ordenar == "antigos":
        return consulta.order_by(models.Pedido.data_atualizacao.asc(), models.Pedido.id.asc())
    if ordenar == "valor_desc":
        return consulta.order_by(models.Pedido.valor_total.desc(), models.Pedido.id.desc())
    if ordenar == "valor_asc":
        return consulta.order_by(models.Pedido.valor_total.asc(), models.Pedido.id.asc())
    return consulta.order_by(models.Pedido.data_atualizacao.desc(), models.Pedido.id.desc())


def _resumo_pedidos(db: Session, loja_id: int) -> schemas.PedidoResumoOut:
    grupos = (
        db.query(
            models.Pedido.status_atual,
            func.count(models.Pedido.id),
            func.coalesce(func.sum(models.Pedido.valor_total), 0.0),
        )
        .filter(models.Pedido.loja_id == loja_id)
        .group_by(models.Pedido.status_atual)
        .all()
    )
    mais_antigo = (
        db.query(func.min(models.Pedido.data_atualizacao))
        .filter(models.Pedido.loja_id == loja_id)
        .scalar()
    )

    total = sum(int(linha[1]) for linha in grupos)
    receita = sum(float(linha[2] or 0) for linha in grupos)
    em_andamento = sum(
        int(linha[1])
        for linha in grupos
        if not servicos.STATUS_FINAIS.search(linha[0] or "")
    )
    por_status = {linha[0]: int(linha[1]) for linha in grupos}

    return schemas.PedidoResumoOut(
        total=total,
        receita=round(receita, 2),
        ticket_medio=round(receita / total, 2) if total else 0.0,
        em_andamento=em_andamento,
        mais_antigo=mais_antigo,
        por_status=por_status,
    )


@router.get(
    "/api/pedidos",
    response_model=schemas.PedidosPaginaOut,
    tags=["pedidos"],
    summary="Lista, filtra e pagina os pedidos da loja ativa",
)
def listar_pedidos(
    status_filtro: str | None = Query(default=None, alias="status", max_length=60),
    busca: str | None = Query(default=None, max_length=120),
    de: date | None = Query(default=None, description="Data inicial (AAAA-MM-DD)"),
    ate: date | None = Query(default=None, description="Data final (AAAA-MM-DD)"),
    ordenar: str = Query(
        default="recentes",
        pattern="^(recentes|antigos|valor_desc|valor_asc)$",
    ),
    pagina: int = Query(default=1, ge=1),
    por_pagina: int = Query(default=25, ge=1, le=200),
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.PedidosPaginaOut:
    base = db.query(models.Pedido).filter(models.Pedido.loja_id == sessao.loja.id)
    filtrada = _filtrar_pedidos(base, status_filtro, busca, de, ate)
    total = filtrada.count()
    itens = (
        _ordenar_pedidos(filtrada, ordenar)
        .offset((pagina - 1) * por_pagina)
        .limit(por_pagina)
        .all()
    )

    return schemas.PedidosPaginaOut(
        itens=[schemas.PedidoOut.model_validate(item) for item in itens],
        total=total,
        pagina=pagina,
        por_pagina=por_pagina,
        paginas=math.ceil(total / por_pagina) if total else 0,
        resumo=_resumo_pedidos(db, sessao.loja.id),
    )


@router.get(
    "/api/pedidos/exportacao.csv",
    tags=["pedidos"],
    summary="Exporta em CSV os pedidos filtrados da loja ativa",
)
def exportar_pedidos(
    status_filtro: str | None = Query(default=None, alias="status", max_length=60),
    busca: str | None = Query(default=None, max_length=120),
    de: date | None = Query(default=None),
    ate: date | None = Query(default=None),
    ordenar: str = Query(default="recentes", pattern="^(recentes|antigos|valor_desc|valor_asc)$"),
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> Response:
    base = db.query(models.Pedido).filter(models.Pedido.loja_id == sessao.loja.id)
    filtrada = _filtrar_pedidos(base, status_filtro, busca, de, ate)
    pedidos = _ordenar_pedidos(filtrada, ordenar).all()

    buffer = io.StringIO()
    buffer.write("\ufeff")
    escritor = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    escritor.writerow(["ID", "Pedido", "Status", "Valor", "Cliente", "Atualizado em"])
    for pedido in pedidos:
        escritor.writerow(
            [
                pedido.id,
                pedido.marketplace_id,
                pedido.status_atual,
                f"{pedido.valor_total:.2f}".replace(".", ","),
                pedido.cliente_nome or "",
                pedido.data_atualizacao.isoformat(),
            ]
        )

    return Response(
        content=buffer.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="pedidos-{sessao.loja.slug}.csv"'
        },
    )


@router.get(
    "/api/pedidos/{pedido_id}",
    response_model=schemas.PedidoDetalheOut,
    tags=["pedidos"],
    summary="Detalha o pedido com histórico de eventos e alertas",
)
def detalhar_pedido(
    pedido_id: int,
    sessao: security.SessaoAtiva = Depends(security.obter_sessao),
    db: Session = Depends(get_db),
) -> schemas.PedidoDetalheOut:
    pedido = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.id == pedido_id,
            models.Pedido.loja_id == sessao.loja.id,
        )
        .one_or_none()
    )
    if pedido is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado"
        )

    logs = (
        db.query(models.WebhookLog)
        .filter(
            models.WebhookLog.loja_id == sessao.loja.id,
            models.WebhookLog.pedido_id == pedido.id,
        )
        .order_by(models.WebhookLog.recebido_em.asc(), models.WebhookLog.id.asc())
        .all()
    )
    eventos: list[schemas.PedidoEventoOut] = []
    for log_item in logs:
        dados: dict = {}
        try:
            carregado = json.loads(log_item.payload_raw)
            if isinstance(carregado, dict):
                dados = carregado
        except (ValueError, TypeError):
            dados = {}
        eventos.append(
            schemas.PedidoEventoOut(
                id=log_item.id,
                origem=log_item.origem,
                evento_id=log_item.evento_id,
                recebido_em=log_item.recebido_em,
                status=dados.get("status"),
                valor=dados.get("valor")
                if isinstance(dados.get("valor"), (int, float))
                else None,
                cliente_nome=dados.get("cliente_nome"),
                payload=dados or None,
            )
        )

    notificacoes = (
        db.query(models.Notificacao)
        .filter(
            models.Notificacao.loja_id == sessao.loja.id,
            models.Notificacao.pedido_id == pedido.id,
        )
        .order_by(models.Notificacao.criada_em.desc())
        .all()
    )

    return schemas.PedidoDetalheOut(
        pedido=schemas.PedidoOut.model_validate(pedido),
        eventos=eventos,
        notificacoes=[schemas.NotificacaoOut.model_validate(item) for item in notificacoes],
    )
