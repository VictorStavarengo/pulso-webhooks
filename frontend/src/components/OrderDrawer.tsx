import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchPedidoDetalhe, type Pedido, type PedidoDetalhe } from '../lib/api';
import {
  formatCurrency,
  formatDateTime,
  formatRelativeTime,
  parseServerDate,
} from '../lib/format';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import CopyButton from './CopyButton';
import StatusBadge from './StatusBadge';
import {
  ActivityIcon,
  BellIcon,
  CloseIcon,
  ClockIcon,
  InboxIcon,
  PackageIcon,
  RefreshIcon,
  ServerIcon,
  UserIcon,
  ZapIcon,
} from './icons';

interface OrderDrawerProps {
  pedido: Pedido | null;
  now: number;
  onClose: () => void;
}

interface DetailRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  copyValue?: string;
}

function DetailRow({ icon, label, value, copyValue }: DetailRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-fill">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-fill text-muted">
        {icon}
      </span>
      <dt className="shrink-0 text-[11.5px] text-faint">{label}</dt>
      <dd className="ml-auto flex min-w-0 items-center gap-2 text-[11.5px] text-ink">
        <span className="break-words text-right font-mono leading-snug">{value}</span>
        {copyValue && <CopyButton value={copyValue} label={`Copiar ${label}`} />}
      </dd>
    </div>
  );
}

export default function OrderDrawer({ pedido, now, onClose }: OrderDrawerProps) {
  useDialogBehavior(pedido !== null, onClose);

  const pedidoId = pedido?.id ?? null;
  const [detalhe, setDetalhe] = useState<PedidoDetalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (pedidoId === null) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCarregando(true);
      setErro(null);
      fetchPedidoDetalhe(pedidoId, controller.signal)
        .then((dados) => {
          if (!controller.signal.aborted) {
            setDetalhe(dados);
          }
        })
        .catch((cause) => {
          if (controller.signal.aborted) {
            return;
          }
          setErro(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar o histórico do pedido.',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setCarregando(false);
          }
        });
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pedidoId, tentativa]);

  const repetir = useCallback(() => setTentativa((valor) => valor + 1), []);

  if (!pedido) {
    return null;
  }

  const base = detalhe?.pedido ?? pedido;
  const updatedAt = parseServerDate(base.data_atualizacao);
  const eventos = detalhe?.eventos ?? [];
  const notificacoes = detalhe?.notificacoes ?? [];

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="animate-fade absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-drawer-title"
        className="animate-slide-in panel-shadow absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              Detalhes do pedido
            </p>
            <p
              id="order-drawer-title"
              className="mt-2 truncate font-mono text-[15px] font-semibold text-ink"
            >
              {base.marketplace_id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhes"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="rounded-xl border border-line bg-surface-2 p-5">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              Valor total
            </p>
            <p className="mt-2.5 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">
              {formatCurrency(base.valor_total)}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={base.status_atual} />
              {base.cliente_nome && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[11px] text-muted">
                  <UserIcon className="h-3 w-3" />
                  {base.cliente_nome}
                </span>
              )}
            </div>
          </div>

          <dl className="mt-5">
            <DetailRow icon={<PackageIcon className="h-3.5 w-3.5" />} label="ID interno" value={`#${base.id}`} />
            <DetailRow
              icon={<ServerIcon className="h-3.5 w-3.5" />}
              label="Marketplace"
              value={base.marketplace_id}
              copyValue={base.marketplace_id}
            />
            <DetailRow
              icon={<ActivityIcon className="h-3.5 w-3.5" />}
              label="Código do status"
              value={base.status_atual}
            />
            <DetailRow
              icon={<ClockIcon className="h-3.5 w-3.5" />}
              label="Atualizado"
              value={`${formatRelativeTime(updatedAt, now)} · ${formatDateTime(updatedAt)}`}
            />
          </dl>

          {erro && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-line-strong bg-fill px-3 py-2.5">
              <p className="flex-1 text-[11.5px] leading-relaxed text-ink">{erro}</p>
              <button
                type="button"
                onClick={repetir}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-medium text-muted transition hover:text-ink"
              >
                <RefreshIcon className="h-3 w-3" />
                Tentar
              </button>
            </div>
          )}

          <section className="mt-6" aria-labelledby="historico-titulo">
            <div className="flex items-center justify-between gap-3">
              <h3
                id="historico-titulo"
                className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint"
              >
                Histórico de eventos
              </h3>
              <span className="rounded border border-line bg-fill px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {eventos.length}
              </span>
            </div>

            {carregando && eventos.length === 0 ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="skeleton h-14 rounded-lg" />
                ))}
              </div>
            ) : eventos.length === 0 ? (
              <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-dashed border-line px-3 py-4 text-[11.5px] text-muted">
                <InboxIcon className="h-4 w-4 shrink-0" />
                Nenhum evento registrado para este pedido.
              </div>
            ) : (
              <ol className="mt-3 space-y-0">
                {eventos.map((evento, index) => {
                  const recebido = parseServerDate(evento.recebido_em);
                  const ultimo = index === eventos.length - 1;
                  return (
                    <li key={evento.id} className="relative flex gap-3 pb-4 last:pb-0">
                      {!ultimo && (
                        <span
                          aria-hidden="true"
                          className="absolute left-[5px] top-4 h-full w-px bg-line"
                        />
                      )}
                      <span
                        className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${
                          ultimo ? 'border-ink bg-ink' : 'border-line-strong bg-surface'
                        }`}
                      />
                      <div className="min-w-0 flex-1 rounded-lg border border-line bg-canvas p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
                            <ZapIcon className="h-3 w-3" />
                            {evento.origem}
                            {evento.evento_id && (
                              <span className="truncate font-mono text-[10px] font-normal text-faint">
                                {evento.evento_id}
                              </span>
                            )}
                          </p>
                          <span className="font-mono text-[10px] text-faint">
                            {formatDateTime(recebido)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {evento.status && <StatusBadge status={evento.status} />}
                          {typeof evento.valor === 'number' && (
                            <span className="font-mono text-[11.5px] tabular-nums text-ink">
                              {formatCurrency(evento.valor)}
                            </span>
                          )}
                          {evento.cliente_nome && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                              <UserIcon className="h-3 w-3" />
                              {evento.cliente_nome}
                            </span>
                          )}
                        </div>
                        {evento.payload && (
                          <details className="group mt-2">
                            <summary className="cursor-pointer select-none text-[10.5px] text-faint transition hover:text-ink">
                              Ver payload
                            </summary>
                            <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-line bg-surface-2 p-2.5 font-mono text-[10px] leading-relaxed text-muted">
                              {JSON.stringify(evento.payload, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="mt-6" aria-labelledby="alertas-titulo">
            <div className="flex items-center justify-between gap-3">
              <h3
                id="alertas-titulo"
                className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint"
              >
                Alertas gerados
              </h3>
              <span className="rounded border border-line bg-fill px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {notificacoes.length}
              </span>
            </div>

            {notificacoes.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-4 text-[11.5px] text-muted">
                Nenhum alerta disparado para este pedido.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {notificacoes.map((notificacao) => (
                  <li
                    key={notificacao.id}
                    className="rounded-lg border border-line bg-canvas px-3 py-2.5"
                  >
                    <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
                      <BellIcon className="h-3 w-3 shrink-0" />
                      {notificacao.titulo}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">
                      {notificacao.mensagem}
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] text-faint">
                      {formatDateTime(parseServerDate(notificacao.criada_em))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="border-t border-line-soft px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-full rounded-lg border border-line bg-fill text-[12.5px] font-medium text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            Fechar
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
