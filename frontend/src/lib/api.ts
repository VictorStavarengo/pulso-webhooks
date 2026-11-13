export type Papel = 'admin' | 'operador';

export type Ordenacao = 'recentes' | 'antigos' | 'valor_desc' | 'valor_asc';

export interface Pedido {
  id: number;
  marketplace_id: string;
  status_atual: string;
  valor_total: number;
  cliente_nome: string | null;
  data_atualizacao: string;
}

export interface PedidoResumo {
  total: number;
  receita: number;
  ticket_medio: number;
  em_andamento: number;
  mais_antigo: string | null;
  por_status: Record<string, number>;
}

export interface PedidosPagina {
  itens: Pedido[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
  resumo: PedidoResumo;
}

export interface PedidoEvento {
  id: number;
  origem: string;
  evento_id: string | null;
  recebido_em: string;
  status: string | null;
  valor: number | null;
  cliente_nome: string | null;
  payload: Record<string, unknown> | null;
}

export interface Notificacao {
  id: number;
  pedido_id: number | null;
  tipo: string;
  titulo: string;
  mensagem: string;
  criada_em: string;
  lida_em: string | null;
}

export interface PedidoDetalhe {
  pedido: Pedido;
  eventos: PedidoEvento[];
  notificacoes: Notificacao[];
}

export interface Loja {
  id: number;
  nome: string;
  slug: string;
  atraso_horas: number;
  valor_alto: number;
  notificar_atraso: boolean;
  notificar_cancelado: boolean;
  notificar_valor_alto: boolean;
  notificar_email: boolean;
  alerta_email: string | null;
  notificar_telegram: boolean;
  alerta_telegram: string | null;
  notificar_whatsapp: boolean;
  alerta_whatsapp: string | null;
}

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  totp_ativo: boolean;
}

export interface Sessao {
  usuario: Usuario;
  lojas: Loja[];
  loja: Loja;
}

export interface Desafio2FA {
  requer_2fa: true;
  mensagem: string;
}

export interface TotpInicio {
  segredo: string;
  otpauth_url: string;
  qr_svg: string;
}

export interface UsuarioAdmin {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  totp_ativo: boolean;
  criado_em: string;
  loja_ids: number[];
}

export interface Integracao {
  id: number;
  marketplace: string;
  segredo: string;
  ativo: boolean;
  criado_em: string;
}

export interface WebhookPayload {
  origem: string;
  pedido_id: string;
  status: string;
  valor: number;
  evento_id?: string;
  cliente_nome?: string;
}

export interface WebhookResposta {
  mensagem: string;
  criado: boolean;
  duplicado: boolean;
  pedido: Pedido | null;
}

export interface ConfiguracaoLoja {
  atraso_horas?: number;
  valor_alto?: number;
  notificar_atraso?: boolean;
  notificar_cancelado?: boolean;
  notificar_valor_alto?: boolean;
  notificar_email?: boolean;
  alerta_email?: string | null;
  notificar_telegram?: boolean;
  alerta_telegram?: string | null;
  notificar_whatsapp?: boolean;
  alerta_whatsapp?: string | null;
}

export interface EnvioAlerta {
  canal: string;
  destino: string;
  status: 'enviado' | 'ignorado' | 'erro';
  erro: string | null;
}

export interface EnvioAlertaFila {
  id: number;
  notificacao_id: number;
  canal: string;
  destino: string;
  status: 'pendente' | 'enviado' | 'ignorado' | 'descartado';
  tentativas: number;
  erro: string | null;
  proxima_tentativa_em: string | null;
  criado_em: string;
}

export interface ExpurgoResposta {
  logs_removidos: number;
  envios_removidos: number;
  retencao_dias: number;
}

export interface FiltrosPedidos {
  status: string;
  busca: string;
  de: string;
  ate: string;
  ordenar: Ordenacao;
  pagina: number;
  porPagina: number;
}

export const FILTROS_PEDIDOS_INICIAIS: FiltrosPedidos = {
  status: '',
  busca: '',
  de: '',
  ate: '',
  ordenar: 'recentes',
  pagina: 1,
  porPagina: 25,
};

export const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? ''
).replace(/\/$/, '');

export const WEBHOOK_ENDPOINT = `${API_BASE || window.location.origin}/webhooks/pedidos`;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface OpcoesRequisicao {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  corpo?: unknown;
  signal?: AbortSignal;
  silenciar401?: boolean;
}

function tokenCsrf(): string | null {
  const alvo = document.cookie
    .split('; ')
    .find((item) => item.startsWith('pulso_csrf='));
  return alvo ? decodeURIComponent(alvo.slice('pulso_csrf='.length)) : null;
}

async function extrairErro(resposta: Response): Promise<string> {
  try {
    const dados = (await resposta.json()) as { detail?: unknown };
    if (typeof dados.detail === 'string') {
      return dados.detail;
    }
    if (Array.isArray(dados.detail)) {
      const mensagens = dados.detail
        .map((item) => {
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg: unknown }).msg);
          }
          return String(item);
        })
        .filter(Boolean);
      if (mensagens.length > 0) {
        return mensagens.join(' · ');
      }
    }
  } catch {
    // Resposta sem corpo JSON: cai no fallback abaixo.
  }
  return `A API respondeu com HTTP ${resposta.status}`;
}

async function requisitar<T>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  const { metodo = 'GET', corpo, signal, silenciar401 = false } = opcoes;
  const csrf = metodo === 'GET' ? null : tokenCsrf();

  let resposta: Response;
  try {
    resposta = await fetch(`${API_BASE}${caminho}`, {
      method: metodo,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-Pulso-Csrf': csrf } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal,
    });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'AbortError') {
      throw erro;
    }
    throw new ApiError(0, 'Sem resposta do servidor. Verifique se a API está no ar.');
  }

  if (resposta.status === 401 && !silenciar401) {
    window.dispatchEvent(new CustomEvent('pulso:sessao-expirada'));
  }

  if (!resposta.ok) {
    throw new ApiError(resposta.status, await extrairErro(resposta));
  }

  if (resposta.status === 204) {
    return undefined as T;
  }

  return (await resposta.json()) as T;
}

export function urlStream(): string {
  return `${API_BASE}/api/stream`;
}

export function ehDesafio2FA(valor: Sessao | Desafio2FA): valor is Desafio2FA {
  return 'requer_2fa' in valor;
}

export function sessaoAtual(): Promise<Sessao> {
  return requisitar<Sessao>('/api/auth/me', { silenciar401: true });
}

export function entrar(email: string, senha: string): Promise<Sessao | Desafio2FA> {
  return requisitar<Sessao | Desafio2FA>('/api/auth/login', {
    metodo: 'POST',
    corpo: { email, senha },
    silenciar401: true,
  });
}

export function concluir2FA(codigo: string): Promise<Sessao> {
  return requisitar<Sessao>('/api/auth/2fa', {
    metodo: 'POST',
    corpo: { codigo },
    silenciar401: true,
  });
}

export function iniciar2FA(): Promise<TotpInicio> {
  return requisitar<TotpInicio>('/api/auth/2fa/iniciar', { metodo: 'POST' });
}

export function ativar2FA(codigo: string): Promise<Usuario> {
  return requisitar<Usuario>('/api/auth/2fa/ativar', {
    metodo: 'POST',
    corpo: { codigo },
  });
}

export function desativar2FA(senha: string): Promise<Usuario> {
  return requisitar<Usuario>('/api/auth/2fa/desativar', {
    metodo: 'POST',
    corpo: { senha },
  });
}

export async function sair(): Promise<void> {
  await requisitar<{ mensagem: string }>('/api/auth/logout', {
    metodo: 'POST',
    silenciar401: true,
  });
}

export function trocarLoja(lojaId: number): Promise<Sessao> {
  return requisitar<Sessao>('/api/auth/loja', {
    metodo: 'POST',
    corpo: { loja_id: lojaId },
  });
}

export function criarLoja(nome: string): Promise<Loja> {
  return requisitar<Loja>('/api/lojas', { metodo: 'POST', corpo: { nome } });
}

export function atualizarConfiguracoes(
  lojaId: number,
  dados: ConfiguracaoLoja,
): Promise<Loja> {
  return requisitar<Loja>(`/api/lojas/${lojaId}/configuracoes`, {
    metodo: 'PATCH',
    corpo: dados,
  });
}

export function testarAlertas(lojaId: number): Promise<EnvioAlerta[]> {
  return requisitar<EnvioAlerta[]>(`/api/lojas/${lojaId}/alertas/teste`, {
    metodo: 'POST',
  });
}

export function listarEnviosDeAlerta(lojaId: number): Promise<EnvioAlertaFila[]> {
  return requisitar<EnvioAlertaFila[]>(`/api/lojas/${lojaId}/alertas/envios?limite=20`);
}

function montarQuery(filtros: FiltrosPedidos, comPaginacao = true): string {
  const parametros = new URLSearchParams();
  if (filtros.status) {
    parametros.set('status', filtros.status);
  }
  if (filtros.busca.trim()) {
    parametros.set('busca', filtros.busca.trim());
  }
  if (filtros.de) {
    parametros.set('de', filtros.de);
  }
  if (filtros.ate) {
    parametros.set('ate', filtros.ate);
  }
  parametros.set('ordenar', filtros.ordenar);
  if (comPaginacao) {
    parametros.set('pagina', String(filtros.pagina));
    parametros.set('por_pagina', String(filtros.porPagina));
  }
  return parametros.toString();
}

export interface PedidosResponse {
  pagina: PedidosPagina;
  latency: number;
}

export async function fetchPedidos(
  filtros: FiltrosPedidos,
  signal?: AbortSignal,
): Promise<PedidosResponse> {
  const iniciadoEm = performance.now();
  const pagina = await requisitar<PedidosPagina>(
    `/api/pedidos?${montarQuery(filtros)}`,
    { signal },
  );
  return { pagina, latency: Math.round(performance.now() - iniciadoEm) };
}

export function fetchPedidoDetalhe(
  pedidoId: number,
  signal?: AbortSignal,
): Promise<PedidoDetalhe> {
  return requisitar<PedidoDetalhe>(`/api/pedidos/${pedidoId}`, { signal });
}

export function urlExportacao(filtros: FiltrosPedidos): string {
  return `${API_BASE}/api/pedidos/exportacao.csv?${montarQuery(filtros, false)}`;
}

export function simularWebhook(payload: WebhookPayload): Promise<WebhookResposta> {
  return requisitar<WebhookResposta>('/api/simular-webhook', {
    metodo: 'POST',
    corpo: payload,
  });
}

export function fetchNotificacoes(limite = 50): Promise<Notificacao[]> {
  return requisitar<Notificacao[]>(`/api/notificacoes?limite=${limite}`);
}

export function marcarNotificacaoLida(id: number): Promise<Notificacao> {
  return requisitar<Notificacao>(`/api/notificacoes/${id}/ler`, { metodo: 'POST' });
}

export function marcarTodasNotificacoes(): Promise<{ atualizadas: number }> {
  return requisitar<{ atualizadas: number }>('/api/notificacoes/ler-todas', {
    metodo: 'POST',
  });
}

export function fetchIntegracoes(lojaId: number): Promise<Integracao[]> {
  return requisitar<Integracao[]>(`/api/lojas/${lojaId}/integracoes`);
}

export function criarIntegracao(lojaId: number, marketplace: string): Promise<Integracao> {
  return requisitar<Integracao>(`/api/lojas/${lojaId}/integracoes`, {
    metodo: 'POST',
    corpo: { marketplace },
  });
}

export function rotacionarSegredo(integracaoId: number): Promise<Integracao> {
  return requisitar<Integracao>(`/api/integracoes/${integracaoId}/rotacionar`, {
    metodo: 'POST',
  });
}

export function removerIntegracao(integracaoId: number): Promise<void> {
  return requisitar<void>(`/api/integracoes/${integracaoId}`, { metodo: 'DELETE' });
}

export interface NovoUsuario {
  nome: string;
  email: string;
  senha: string;
  papel: Papel;
  loja_ids: number[];
}

export interface AtualizacaoUsuario {
  nome?: string;
  papel?: Papel;
  ativo?: boolean;
  senha?: string;
  loja_ids?: number[];
}

export function fetchUsuarios(): Promise<UsuarioAdmin[]> {
  return requisitar<UsuarioAdmin[]>('/api/usuarios');
}

export function criarUsuario(dados: NovoUsuario): Promise<UsuarioAdmin> {
  return requisitar<UsuarioAdmin>('/api/usuarios', { metodo: 'POST', corpo: dados });
}

export function atualizarUsuario(
  usuarioId: number,
  dados: AtualizacaoUsuario,
): Promise<UsuarioAdmin> {
  return requisitar<UsuarioAdmin>(`/api/usuarios/${usuarioId}`, {
    metodo: 'PATCH',
    corpo: dados,
  });
}

export function expurgarAntigos(): Promise<ExpurgoResposta> {
  return requisitar<ExpurgoResposta>('/api/manutencao/expurgar', { metodo: 'POST' });
}
