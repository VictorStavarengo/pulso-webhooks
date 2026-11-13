from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.types import TypeDecorator

from database import Base


class UTCDateTime(TypeDecorator):
    """Grava sempre em UTC e devolve datetimes com timezone na leitura."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


def agora_utc() -> datetime:
    return datetime.now(timezone.utc)


class Loja(Base):
    __tablename__ = "lojas"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(120), nullable=False)
    slug = Column(String(80), unique=True, index=True, nullable=False)
    criado_em = Column(UTCDateTime, default=agora_utc, nullable=False)

    atraso_horas = Column(Integer, default=24, nullable=False)
    valor_alto = Column(Float, default=1000.0, nullable=False)
    notificar_atraso = Column(Boolean, default=True, nullable=False)
    notificar_cancelado = Column(Boolean, default=True, nullable=False)
    notificar_valor_alto = Column(Boolean, default=True, nullable=False)

    notificar_email = Column(Boolean, default=False, nullable=False)
    alerta_email = Column(String(200), nullable=True)
    notificar_telegram = Column(Boolean, default=False, nullable=False)
    alerta_telegram = Column(String(80), nullable=True)
    notificar_whatsapp = Column(Boolean, default=False, nullable=False)
    alerta_whatsapp = Column(String(30), nullable=True)


class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(120), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    senha_hash = Column(String(255), nullable=False)
    papel = Column(String(20), default="admin", nullable=False)
    totp_secret = Column(String(64), nullable=True)
    totp_ativo = Column(Boolean, default=False, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)
    criado_em = Column(UTCDateTime, default=agora_utc, nullable=False)


class UsuarioLoja(Base):
    __tablename__ = "usuario_loja"

    usuario_id = Column(
        Integer,
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        primary_key=True,
    )
    loja_id = Column(
        Integer,
        ForeignKey("lojas.id", ondelete="CASCADE"),
        primary_key=True,
    )
    criado_em = Column(UTCDateTime, default=agora_utc, nullable=False)


class Integracao(Base):
    __tablename__ = "integracoes"
    __table_args__ = (
        UniqueConstraint("loja_id", "marketplace", name="uq_integracoes_loja_marketplace"),
    )

    id = Column(Integer, primary_key=True, index=True)
    loja_id = Column(Integer, ForeignKey("lojas.id", ondelete="CASCADE"), index=True, nullable=False)
    marketplace = Column(String(60), nullable=False)
    segredo = Column(String(128), nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)
    criado_em = Column(UTCDateTime, default=agora_utc, nullable=False)


class Pedido(Base):
    __tablename__ = "pedidos"
    __table_args__ = (
        UniqueConstraint("loja_id", "marketplace_id", name="uq_pedidos_loja_marketplace"),
    )

    id = Column(Integer, primary_key=True, index=True)
    loja_id = Column(Integer, ForeignKey("lojas.id", ondelete="CASCADE"), index=True, nullable=False)
    marketplace_id = Column(String(120), index=True, nullable=False)
    status_atual = Column(String(60), index=True, nullable=False)
    valor_total = Column(Float, nullable=False)
    cliente_nome = Column(String(160), nullable=True)
    data_atualizacao = Column(
        UTCDateTime,
        default=agora_utc,
        onupdate=agora_utc,
        nullable=False,
    )


class WebhookLog(Base):
    __tablename__ = "webhook_logs"
    __table_args__ = (
        UniqueConstraint("loja_id", "evento_id", name="uq_webhook_logs_loja_evento"),
    )

    id = Column(Integer, primary_key=True, index=True)
    loja_id = Column(Integer, ForeignKey("lojas.id", ondelete="CASCADE"), index=True, nullable=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="SET NULL"), index=True, nullable=True)
    evento_id = Column(String(120), nullable=True)
    origem = Column(String(60), index=True, nullable=False)
    payload_raw = Column(Text, nullable=False)
    recebido_em = Column(UTCDateTime, default=agora_utc, nullable=False)
    processado = Column(Boolean, default=False, nullable=False)


class Notificacao(Base):
    __tablename__ = "notificacoes"
    __table_args__ = (
        UniqueConstraint("loja_id", "chave_unica", name="uq_notificacoes_loja_chave"),
    )

    id = Column(Integer, primary_key=True, index=True)
    loja_id = Column(Integer, ForeignKey("lojas.id", ondelete="CASCADE"), index=True, nullable=False)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), index=True, nullable=True)
    tipo = Column(String(30), index=True, nullable=False)
    titulo = Column(String(160), nullable=False)
    mensagem = Column(String(300), nullable=False)
    chave_unica = Column(String(200), nullable=False)
    criada_em = Column(UTCDateTime, default=agora_utc, nullable=False)
    lida_em = Column(UTCDateTime, nullable=True)


class EnvioAlerta(Base):
    __tablename__ = "envios_alerta"

    id = Column(Integer, primary_key=True, index=True)
    notificacao_id = Column(
        Integer,
        ForeignKey("notificacoes.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    canal = Column(String(20), index=True, nullable=False)
    destino = Column(String(200), nullable=False)
    status = Column(String(20), index=True, nullable=False)
    erro = Column(String(500), nullable=True)
    tentativas = Column(Integer, default=0, nullable=False)
    proxima_tentativa_em = Column(UTCDateTime, nullable=True, index=True)
    criado_em = Column(UTCDateTime, default=agora_utc, nullable=False)
