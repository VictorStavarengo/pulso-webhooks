import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EnvioAlerta, EnvioAlertaFila, Loja, Notificacao } from '../lib/api';
import {
  atualizarConfiguracoes,
  listarEnviosDeAlerta,
  testarAlertas,
} from '../lib/api';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { formatRelativeTime, parseServerDate } from '../lib/format';
import {
  AlertTriangleIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  SendIcon,
  TrendingUpIcon,
} from './icons';

type Aba = 'alertas' | 'preferencias';

interface NotificationsPanelProps {
  aberto: boolean;
  onFechar: () => void;
  notificacoes: Notificacao[];
  carregando: boolean;
  erro: string | null;
  loja: Loja;
  now: number;
  admin: boolean;
  onMarcarLida: (id: number) => void;
  onMarcarTodas: () => void;
  onRecarregar: () => void;
  onLojaAtualizada: (loja: Loja) => void;
}

const TIPO_META: Record<string, { rotulo: string; Icone: typeof ClockIcon }> = {
  atraso: { rotulo: 'Atraso', Icone: ClockIcon },
  cancelado: { rotulo: 'Cancelado', Icone: AlertTriangleIcon },
  valor_alto: { rotulo: 'Valor alto', Icone: TrendingUpIcon },
};

const CAMPO_CLASS =
  'mt-1.5 h-9 w-full rounded-md border border-line bg-canvas px-2.5 text-[12px] text-ink outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10 disabled:opacity-60';

const RESULTADO_ESTILO: Record<string, string> = {
  enviado: 'border-line-strong bg-fill text-ink',
  ignorado: 'border-dashed border-line text-muted',
  erro: 'border-line-strong bg-fill text-ink',
};

const FILA_META: Record<EnvioAlertaFila['status'], { rotulo: string; estilo: string }> = {
  enviado: { rotulo: 'entregue', estilo: 'border-line-strong bg-fill text-ink' },
  pendente: { rotulo: 'retentativa', estilo: 'border-dashed border-line text-muted' },
  ignorado: { rotulo: 'ignorado', estilo: 'border-dashed border-line text-muted' },
  descartado: { rotulo: 'dead-letter', estilo: 'border-line-strong bg-fill text-ink' },
};

interface PreferenciasProps {
  loja: Loja;
  admin: boolean;
  now: number;
  onLojaAtualizada: (loja: Loja) => void;
  onRecarregar: () => void;
}

function Preferencias({ loja, admin, now, onLojaAtualizada, onRecarregar }: PreferenciasProps) {
  const [form, setForm] = useState({
    atraso_horas: loja.atraso_horas,
    valor_alto: loja.valor_alto,
    notificar_atraso: loja.notificar_atraso,
    notificar_cancelado: loja.notificar_cancelado,
    notificar_valor_alto: loja.notificar_valor_alto,
    notificar_email: loja.notificar_email,
    alerta_email: loja.alerta_email ?? '',
    notificar_telegram: loja.notificar_telegram,
    alerta_telegram: loja.alerta_telegram ?? '',
    notificar_whatsapp: loja.notificar_whatsapp,
    alerta_whatsapp: loja.alerta_whatsapp ?? '',
  });
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [resultados, setResultados] = useState<EnvioAlerta[] | null>(null);
  const [fila, setFila] = useState<EnvioAlertaFila[] | null>(null);
  const [carregandoFila, setCarregandoFila] = useState(true);
  const [versaoFila, setVersaoFila] = useState(0);

  useEffect(() => {
    if (!admin) {
      return;
    }
    let ativo = true;
    listarEnviosDeAlerta(loja.id)
      .then((itens) => {
        if (ativo) {
          setFila(itens);
        }
      })
      .catch(() => {
        if (ativo) {
          setFila(null);
        }
      })
      .finally(() => {
        if (ativo) {
          setCarregandoFila(false);
        }
      });
    return () => {
      ativo = false;
    };
  }, [admin, loja.id, versaoFila]);

  function alterar<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
    setSalvo(false);
    setResultados(null);
  }

  function aplicarLoja(atualizada: Loja) {
    onLojaAtualizada(atualizada);
    setForm({
      atraso_horas: atualizada.atraso_horas,
      valor_alto: atualizada.valor_alto,
      notificar_atraso: atualizada.notificar_atraso,
      notificar_cancelado: atualizada.notificar_cancelado,
      notificar_valor_alto: atualizada.notificar_valor_alto,
      notificar_email: atualizada.notificar_email,
      alerta_email: atualizada.alerta_email ?? '',
      notificar_telegram: atualizada.notificar_telegram,
      alerta_telegram: atualizada.alerta_telegram ?? '',
      notificar_whatsapp: atualizada.notificar_whatsapp,
      alerta_whatsapp: atualizada.alerta_whatsapp ?? '',
    });
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const atualizada = await atualizarConfiguracoes(loja.id, {
        atraso_horas: Math.min(720, Math.max(1, Math.round(form.atraso_horas || 1))),
        valor_alto: Math.max(0, form.valor_alto || 0),
        notificar_atraso: form.notificar_atraso,
        notificar_cancelado: form.notificar_cancelado,
        notificar_valor_alto: form.notificar_valor_alto,
        notificar_email: form.notificar_email,
        alerta_email: form.alerta_email.trim() || null,
        notificar_telegram: form.notificar_telegram,
        alerta_telegram: form.alerta_telegram.trim() || null,
        notificar_whatsapp: form.notificar_whatsapp,
        alerta_whatsapp: form.alerta_whatsapp.trim() || null,
      });
      aplicarLoja(atualizada);
      setSalvo(true);
      onRecarregar();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível salvar as preferências.');
    } finally {
      setSalvando(false);
    }
  }

  async function enviarTeste() {
    setTestando(true);
    setErro(null);
    setResultados(null);
    try {
      const resposta = await testarAlertas(loja.id);
      setResultados(resposta);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível enviar o teste.');
    } finally {
      setTestando(false);
    }
  }

  return (
    <div className="px-5 py-5">
      {!admin && (
        <p className="mb-4 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          Somente administradores podem alterar os limites e os canais de alerta desta loja.
        </p>
      )}

      <div className="space-y-5">
        <Toggle
          ligado={form.notificar_atraso}
          onChange={(valor) => alterar('notificar_atraso', valor)}
          rotulo="Pedido atrasado"
          descricao="Avisa quando um pedido em andamento fica sem atualização além do limite."
          desabilitado={!admin}
        />
        {form.notificar_atraso && (
          <label className="block rounded-lg border border-line bg-fill px-3 py-2.5">
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
              Limite de inatividade (horas)
            </span>
            <input
              type="number"
              min={1}
              max={720}
              value={form.atraso_horas}
              disabled={!admin}
              onChange={(event) => alterar('atraso_horas', Number(event.target.value))}
              className={`${CAMPO_CLASS} font-mono`}
            />
          </label>
        )}

        <Toggle
          ligado={form.notificar_cancelado}
          onChange={(valor) => alterar('notificar_cancelado', valor)}
          rotulo="Pedido cancelado"
          descricao="Destaca cancelamentos, estornos e recusas assim que chegam."
          desabilitado={!admin}
        />

        <Toggle
          ligado={form.notificar_valor_alto}
          onChange={(valor) => alterar('notificar_valor_alto', valor)}
          rotulo="Valor acima do limite"
          descricao="Cria um alerta para pedidos com ticket igual ou acima do valor definido."
          desabilitado={!admin}
        />
        {form.notificar_valor_alto && (
          <label className="block rounded-lg border border-line bg-fill px-3 py-2.5">
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
              Valor mínimo (R$)
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.valor_alto}
              disabled={!admin}
              onChange={(event) => alterar('valor_alto', Number(event.target.value))}
              className={`${CAMPO_CLASS} font-mono`}
            />
          </label>
        )}
      </div>

      <div className="mt-6 border-t border-line-soft pt-5">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
          Canais externos
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Os alertas continuam no painel e também são entregues nestes destinos quando o canal
          estiver ativo.
        </p>

        <div className="mt-4 space-y-5">
          <div>
            <Toggle
              ligado={form.notificar_email}
              onChange={(valor) => alterar('notificar_email', valor)}
              rotulo="E-mail"
              descricao="Envia o alerta para o endereço cadastrado abaixo."
              desabilitado={!admin}
            />
            {form.notificar_email && (
              <input
                type="email"
                value={form.alerta_email}
                disabled={!admin}
                onChange={(event) => alterar('alerta_email', event.target.value)}
                placeholder="operacao@loja.com"
                aria-label="E-mail de destino"
                className={CAMPO_CLASS}
              />
            )}
          </div>

          <div>
            <Toggle
              ligado={form.notificar_telegram}
              onChange={(valor) => alterar('notificar_telegram', valor)}
              rotulo="Telegram"
              descricao="Use o chat ID numérico do grupo ou @canal já iniciado com o bot."
              desabilitado={!admin}
            />
            {form.notificar_telegram && (
              <input
                value={form.alerta_telegram}
                disabled={!admin}
                onChange={(event) => alterar('alerta_telegram', event.target.value)}
                placeholder="-1001234567890 ou @minhaoperacao"
                aria-label="Destino no Telegram"
                className={`${CAMPO_CLASS} font-mono`}
              />
            )}
          </div>

          <div>
            <Toggle
              ligado={form.notificar_whatsapp}
              onChange={(valor) => alterar('notificar_whatsapp', valor)}
              rotulo="WhatsApp"
              descricao="Número com DDI e DDD, apenas dígitos, ex.: 5511999998888."
              desabilitado={!admin}
            />
            {form.notificar_whatsapp && (
              <input
                value={form.alerta_whatsapp}
                disabled={!admin}
                onChange={(event) => alterar('alerta_whatsapp', event.target.value)}
                placeholder="5511999998888"
                aria-label="Número de WhatsApp"
                inputMode="numeric"
                className={`${CAMPO_CLASS} font-mono`}
              />
            )}
          </div>
        </div>

        {admin && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={enviarTeste}
              disabled={testando}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-wait disabled:opacity-60"
            >
              <SendIcon className="h-3.5 w-3.5" />
              {testando ? 'Enviando…' : 'Enviar teste'}
            </button>
            <span className="text-[10px] text-faint">Salve antes de testar para usar o destino atual.</span>
          </div>
        )}

        {resultados && (
          <ul className="mt-3 space-y-2">
            {resultados.length === 0 ? (
              <li className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] text-muted">
                Nenhum canal externo está ativo nesta loja.
              </li>
            ) : (
              resultados.map((resultado) => (
                <li
                  key={`${resultado.canal}-${resultado.destino}`}
                  className={`rounded-lg border px-3 py-2.5 ${RESULTADO_ESTILO[resultado.status] ?? 'border-line'}`}
                >
                  <p className="flex items-center justify-between gap-2 text-[11.5px] font-medium text-ink">
                    <span className="uppercase tracking-[0.12em]">{resultado.canal}</span>
                    <span className="font-mono text-[10px] text-muted">{resultado.status}</span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                    {resultado.destino}
                  </p>
                  {resultado.erro && (
                    <p className="mt-1 text-[10.5px] leading-relaxed text-ink">{resultado.erro}</p>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {admin && (
        <div className="mt-6 border-t border-line-soft pt-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              Fila de entrega
            </h3>
            <button
              type="button"
              onClick={() => {
                setCarregandoFila(true);
                setVersaoFila((valor) => valor + 1);
              }}
              disabled={carregandoFila}
              className="inline-flex h-7 items-center rounded-md border border-line px-2 text-[10.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-wait disabled:opacity-60"
            >
              {carregandoFila ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Falhas de e-mail, Telegram ou WhatsApp são retentadas com backoff exponencial. Depois do
            limite de tentativas, o envio vira dead-letter e para de ser reprocessado.
          </p>

          {fila && fila.length > 0 && (
            <ul className="mt-3 space-y-2">
              {fila.map((item) => {
                const meta = FILA_META[item.status];
                return (
                  <li
                    key={item.id}
                    className={`rounded-lg border px-3 py-2.5 ${meta.estilo}`}
                  >
                    <p className="flex items-center justify-between gap-2 text-[11px] font-medium text-ink">
                      <span className="uppercase tracking-[0.12em]">{item.canal}</span>
                      <span className="font-mono text-[10px] text-muted">
                        {meta.rotulo} · {item.tentativas}x
                      </span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                      {item.destino}
                    </p>
                    {item.status === 'pendente' && item.proxima_tentativa_em && (
                      <p className="mt-1 text-[10px] text-faint">
                        {parseServerDate(item.proxima_tentativa_em).getTime() <= now
                          ? 'Retentativa atrasada'
                          : 'Próxima tentativa'}{' '}
                        {formatRelativeTime(parseServerDate(item.proxima_tentativa_em), now)}
                      </p>
                    )}
                    {item.erro && (
                      <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-ink">
                        {item.erro}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {fila && fila.length === 0 && (
            <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] text-muted">
              Nenhuma entrega externa registrada ainda.
            </p>
          )}
        </div>
      )}

      <p className="mt-5 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
        Cada tipo de alerta é gerado no máximo uma vez por pedido por dia, evitando repetição.
      </p>

      {erro && (
        <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-fill px-3 py-2 text-[11.5px] text-ink">
          {erro}
        </p>
      )}

      {admin && (
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-muted" role="status">
            {salvo && (
              <>
                <CheckIcon className="h-3.5 w-3.5 text-ink" />
                Preferências salvas
              </>
            )}
          </span>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="inline-flex h-9 items-center rounded-lg bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:cursor-wait disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : 'Salvar preferências'}
          </button>
        </div>
      )}
    </div>
  );
}

interface ToggleProps {
  ligado: boolean;
  onChange: (valor: boolean) => void;
  rotulo: string;
  descricao: string;
  desabilitado?: boolean;
}

function Toggle({ ligado, onChange, rotulo, descricao, desabilitado = false }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{rotulo}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{descricao}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={desabilitado}
        onClick={() => onChange(!ligado)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-50 ${
          ligado ? 'border-transparent bg-invert' : 'border-line-strong bg-fill'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
            ligado ? 'left-[18px] bg-invert-ink' : 'left-0.5 bg-faint'
          }`}
        />
      </button>
    </div>
  );
}

export default function NotificationsPanel({
  aberto,
  onFechar,
  notificacoes,
  carregando,
  erro,
  loja,
  now,
  admin,
  onMarcarLida,
  onMarcarTodas,
  onRecarregar,
  onLojaAtualizada,
}: NotificationsPanelProps) {
  const [aba, setAba] = useState<Aba>('alertas');

  useDialogBehavior(aberto, onFechar);

  if (!aberto) {
    return null;
  }

  const naoLidas = notificacoes.filter((item) => !item.lida_em).length;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="animate-fade absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onFechar}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="notificacoes-title"
        className="animate-slide-in panel-shadow absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              {loja.nome}
            </p>
            <h2
              id="notificacoes-title"
              className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink"
            >
              Notificações
              {naoLidas > 0 && (
                <span className="rounded-full bg-invert px-1.5 py-0.5 font-mono text-[10px] text-invert-ink">
                  {naoLidas}
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar notificações"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-line-soft px-4 py-2">
          {(
            [
              ['alertas', 'Alertas'],
              ['preferencias', 'Preferências'],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setAba(valor)}
              className={`h-8 rounded-md px-3 text-[12px] font-medium transition ${
                aba === valor
                  ? 'bg-fill-strong text-ink'
                  : 'text-muted hover:bg-fill hover:text-ink'
              }`}
            >
              {rotulo}
            </button>
          ))}

          {aba === 'alertas' && naoLidas > 0 && (
            <button
              type="button"
              onClick={onMarcarTodas}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted transition hover:bg-fill hover:text-ink"
            >
              <CheckIcon className="h-3.5 w-3.5" />
              Marcar todas
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {aba === 'preferencias' ? (
            <Preferencias
              loja={loja}
              admin={admin}
              now={now}
              onLojaAtualizada={onLojaAtualizada}
              onRecarregar={onRecarregar}
            />
          ) : carregando ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex gap-3">
                  <div className="skeleton h-8 w-8 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3 w-32 rounded-full" />
                    <div className="skeleton h-3 w-full rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : erro ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[12.5px] text-muted">{erro}</p>
              <button
                type="button"
                onClick={onRecarregar}
                className="mt-3 h-8 rounded-lg border border-line px-3 text-[11.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
              >
                Tentar novamente
              </button>
            </div>
          ) : notificacoes.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-dashed border-line-strong text-muted">
                <BellIcon className="h-5 w-5" />
              </div>
              <p className="text-[14px] font-semibold text-ink">Nenhum alerta no momento</p>
              <p className="mt-1.5 max-w-[280px] text-[11.5px] leading-relaxed text-muted">
                Pedidos atrasados, cancelados ou acima do limite aparecem aqui.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line-soft">
              {notificacoes.map((notificacao) => {
                const meta = TIPO_META[notificacao.tipo] ?? {
                  rotulo: 'Alerta',
                  Icone: BellIcon,
                };
                const Icone = meta.Icone;
                const criadaEm = parseServerDate(notificacao.criada_em);
                const naoLida = !notificacao.lida_em;

                return (
                  <li key={notificacao.id}>
                    <button
                      type="button"
                      onClick={() => onMarcarLida(notificacao.id)}
                      disabled={!naoLida}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition ${
                        naoLida ? 'bg-fill/60 hover:bg-fill' : 'hover:bg-fill/50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                          naoLida
                            ? 'border-transparent bg-invert text-invert-ink'
                            : 'border-line bg-fill text-muted'
                        }`}
                      >
                        <Icone className="h-3.5 w-3.5" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium text-ink">
                            {notificacao.titulo}
                          </span>
                          <span className="shrink-0 rounded border border-line px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                            {meta.rotulo}
                          </span>
                          {naoLida && (
                            <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                          )}
                        </span>
                        <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                          {notificacao.mensagem}
                        </span>
                        <span className="mt-1.5 block text-[10px] text-faint">
                          {formatRelativeTime(criadaEm, now)}
                          {notificacao.lida_em ? ' · lida' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
