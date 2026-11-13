import math
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PapelUsuario = Literal["admin", "operador"]


def _texto_opcional(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class LoginEntrada(BaseModel):
    email: str = Field(min_length=3, max_length=200, examples=["admin@pulso.local"])
    senha: str = Field(min_length=1, max_length=200, examples=["pulso123"])

    @field_validator("email")
    @classmethod
    def normalizar_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value:
            raise ValueError("informe um e-mail válido")
        return value


class Desafio2FAOut(BaseModel):
    requer_2fa: bool = True
    mensagem: str = "Informe o código do autenticador para concluir o login"


class Codigo2FAEntrada(BaseModel):
    codigo: str = Field(min_length=6, max_length=8)

    @field_validator("codigo")
    @classmethod
    def normalizar_codigo(cls, value: str) -> str:
        value = re.sub(r"\s+", "", value)
        if not value.isdigit():
            raise ValueError("o código deve conter apenas números")
        return value


class TotpInicioOut(BaseModel):
    segredo: str
    otpauth_url: str
    qr_svg: str


class TotpAtivacaoEntrada(Codigo2FAEntrada):
    pass


class TotpDesativacaoEntrada(BaseModel):
    senha: str = Field(min_length=1, max_length=200)


class TrocarLojaEntrada(BaseModel):
    loja_id: int = Field(gt=0)


class LojaEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120, examples=["Loja Centro"])

    @field_validator("nome")
    @classmethod
    def exigir_nome(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("precisa de ao menos 2 caracteres")
        return value


class ConfiguracaoLojaEntrada(BaseModel):
    atraso_horas: int | None = Field(default=None, ge=1, le=720)
    valor_alto: float | None = Field(default=None, ge=0)
    notificar_atraso: bool | None = None
    notificar_cancelado: bool | None = None
    notificar_valor_alto: bool | None = None

    notificar_email: bool | None = None
    alerta_email: str | None = Field(default=None, max_length=200)
    notificar_telegram: bool | None = None
    alerta_telegram: str | None = Field(default=None, max_length=80)
    notificar_whatsapp: bool | None = None
    alerta_whatsapp: str | None = Field(default=None, max_length=30)

    @field_validator("valor_alto")
    @classmethod
    def exigir_valor_finito(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("deve ser um número finito")
        return value

    @field_validator("alerta_email")
    @classmethod
    def validar_email(cls, value: str | None) -> str | None:
        value = _texto_opcional(value)
        if value is None:
            return None
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("informe um e-mail válido")
        return value.lower()

    @field_validator("alerta_telegram")
    @classmethod
    def validar_telegram(cls, value: str | None) -> str | None:
        value = _texto_opcional(value)
        if value is None:
            return None
        if not value.startswith("@") and not re.fullmatch(r"-?\d{3,25}", value):
            raise ValueError("use o chat ID numérico ou @canal")
        return value

    @field_validator("alerta_whatsapp")
    @classmethod
    def validar_whatsapp(cls, value: str | None) -> str | None:
        value = _texto_opcional(value)
        if value is None:
            return None
        digitos = re.sub(r"\D", "", value)
        if not 8 <= len(digitos) <= 15:
            raise ValueError("informe o número com DDI e DDD, só dígitos")
        return digitos


class IntegracaoEntrada(BaseModel):
    marketplace: str = Field(min_length=2, max_length=60, examples=["shopee"])

    @field_validator("marketplace")
    @classmethod
    def exigir_marketplace(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("precisa de ao menos 2 caracteres")
        return value


class WebhookPayload(BaseModel):
    origem: str = Field(min_length=1, max_length=60, examples=["shopify"])
    pedido_id: str = Field(min_length=1, max_length=120, examples=["BR-1001"])
    status: str = Field(min_length=1, max_length=60, examples=["PAGO"])
    valor: float = Field(ge=0, examples=[249.90])
    cliente_nome: str | None = Field(default=None, max_length=160, examples=["Ana Souza"])
    evento_id: str | None = Field(default=None, max_length=120, examples=["evt_123"])

    @field_validator("origem", "pedido_id", "status")
    @classmethod
    def exigir_texto_util(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("não pode ficar em branco")
        return value

    @field_validator("cliente_nome", "evento_id")
    @classmethod
    def normalizar_opcional(cls, value: str | None) -> str | None:
        return _texto_opcional(value)

    @field_validator("valor")
    @classmethod
    def exigir_valor_finito(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("deve ser um número finito")
        return value


class PedidoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    marketplace_id: str
    status_atual: str
    valor_total: float
    cliente_nome: str | None = None
    data_atualizacao: datetime


class PedidoResumoOut(BaseModel):
    total: int
    receita: float
    ticket_medio: float
    em_andamento: int
    mais_antigo: datetime | None = None
    por_status: dict[str, int] = Field(default_factory=dict)


class PedidosPaginaOut(BaseModel):
    itens: list[PedidoOut]
    total: int
    pagina: int
    por_pagina: int
    paginas: int
    resumo: PedidoResumoOut


class PedidoEventoOut(BaseModel):
    id: int
    origem: str
    evento_id: str | None = None
    recebido_em: datetime
    status: str | None = None
    valor: float | None = None
    cliente_nome: str | None = None
    payload: dict | None = None


class NotificacaoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pedido_id: int | None
    tipo: str
    titulo: str
    mensagem: str
    criada_em: datetime
    lida_em: datetime | None


class EnvioAlertaOut(BaseModel):
    canal: str
    destino: str
    status: str
    erro: str | None = None


class EnvioAlertaHistoricoOut(BaseModel):
    id: int
    notificacao_id: int
    canal: str
    destino: str
    status: str
    tentativas: int
    erro: str | None = None
    proxima_tentativa_em: datetime | None = None
    criado_em: datetime


class PedidoDetalheOut(BaseModel):
    pedido: PedidoOut
    eventos: list[PedidoEventoOut]
    notificacoes: list[NotificacaoOut]


class WebhookResposta(BaseModel):
    mensagem: str
    criado: bool
    duplicado: bool = False
    pedido: PedidoOut | None = None


class WebhookLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    origem: str
    evento_id: str | None = None
    payload_raw: str
    recebido_em: datetime
    processado: bool


class LojaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    slug: str
    atraso_horas: int
    valor_alto: float
    notificar_atraso: bool
    notificar_cancelado: bool
    notificar_valor_alto: bool
    notificar_email: bool
    alerta_email: str | None = None
    notificar_telegram: bool
    alerta_telegram: str | None = None
    notificar_whatsapp: bool
    alerta_whatsapp: str | None = None


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    email: str
    papel: PapelUsuario
    totp_ativo: bool


class SessaoOut(BaseModel):
    usuario: UsuarioOut
    lojas: list[LojaOut]
    loja: LojaOut


class IntegracaoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    marketplace: str
    segredo: str
    ativo: bool
    criado_em: datetime


class UsuarioAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    email: str
    papel: PapelUsuario
    ativo: bool
    totp_ativo: bool
    criado_em: datetime
    loja_ids: list[int] = Field(default_factory=list)


class UsuarioEntrada(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    senha: str = Field(min_length=8, max_length=200)
    papel: PapelUsuario = "operador"
    loja_ids: list[int] = Field(default_factory=list)

    @field_validator("nome")
    @classmethod
    def exigir_nome(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("precisa de ao menos 2 caracteres")
        return value

    @field_validator("email")
    @classmethod
    def normalizar_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value:
            raise ValueError("informe um e-mail válido")
        return value


class UsuarioAtualizacao(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    papel: PapelUsuario | None = None
    ativo: bool | None = None
    senha: str | None = Field(default=None, min_length=8, max_length=200)
    loja_ids: list[int] | None = None

    @field_validator("nome")
    @classmethod
    def exigir_nome(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) < 2:
            raise ValueError("precisa de ao menos 2 caracteres")
        return value


class LerTodasResposta(BaseModel):
    atualizadas: int


class ExpurgoResposta(BaseModel):
    logs_removidos: int
    envios_removidos: int
    retencao_dias: int


class HealthOut(BaseModel):
    status: str
    banco: str
    versao: str
    retencao_dias: int
