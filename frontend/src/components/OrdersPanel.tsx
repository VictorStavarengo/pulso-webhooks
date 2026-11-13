import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  WEBHOOK_ENDPOINT,
  urlExportacao,
  type FiltrosPedidos,
  type Pedido,
} from '../lib/api';
import type { StreamMode } from '../hooks/usePedidos';
import {
  formatCurrency,
  formatDateTime,
  formatRelativeTime,
  parseServerDate,
} from '../lib/format';
import CopyButton from './CopyButton';
import OrderDrawer from './OrderDrawer';
import StatusBadge from './StatusBadge';
import TestWebhookDialog from './TestWebhookDialog';
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  InboxIcon,
  PlusIcon,
  SearchIcon,
} from './icons';

interface OrdersPanelProps {
  pedidos: Pedido[];
  hasLoaded: boolean;
  now: number;
  modo: StreamMode;
  lojaSlug: string;
  filtros: FiltrosPedidos;
  paginaAtual: number;
  paginas: number;
  porPagina: number;
  total: number;
  statusDisponiveis: string[];
  onAtualizarFiltros: (parcial: Partial<FiltrosPedidos>) => void;
  onLimparFiltros: () => void;
  onRefresh: () => void;
  admin: boolean;
}

function montarSnippet(lojaSlug: string): string {
  return `BODY='{"origem":"shopify","pedido_id":"BR-1001","status":"PAGO","valor":249.90,"evento_id":"evt_1001","cliente_nome":"Ana Souza"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PULSO_SEGREDO" | sed 's/^.* //')

curl -X POST ${WEBHOOK_ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -H "X-Pulso-Loja: ${lojaSlug}" \\
  -H "X-Pulso-Marketplace: shopify" \\
  -H "X-Pulso-Timestamp: $TS" \\
  -H "X-Pulso-Assinatura: sha256=$SIG" \\
  -d "$BODY"`;
}

function TableSkeleton() {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="skeleton h-9 w-9 rounded-lg" />
          <div className="skeleton h-3 w-32 rounded-full" />
          <div className="skeleton ml-auto h-6 w-24 rounded-full" />
          <div className="skeleton h-3 w-20 rounded-full" />
          <div className="skeleton hidden h-3 w-24 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

interface SortIndicatorProps {
  active: boolean;
  direction: 'asc' | 'desc';
}

function SortIndicator({ active, direction }: SortIndicatorProps) {
  if (!active) {
    return <ChevronsUpDownIcon className="h-3 w-3 text-faint" />;
  }

  return <span className="font-mono text-[11px] leading-none text-ink">{direction === 'asc' ? '↑' : '↓'}</span>;
}

export default function OrdersPanel({
  pedidos,
  hasLoaded,
  now,
  modo,
  lojaSlug,
  filtros,
  paginaAtual,
  paginas,
  porPagina,
  total,
  statusDisponiveis,
  onAtualizarFiltros,
  onLimparFiltros,
  onRefresh,
  admin,
}: OrdersPanelProps) {
  const [buscaLocal, setBuscaLocal] = useState(filtros.busca);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isTestOpen, setIsTestOpen] = useState(false);

  const snippet = useMemo(() => montarSnippet(lojaSlug), [lojaSlug]);

  useEffect(() => {
    const termo = buscaLocal.trim();
    if (termo === filtros.busca) {
      return;
    }
    const timer = window.setTimeout(() => {
      onAtualizarFiltros({ busca: termo });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [buscaLocal, filtros.busca, onAtualizarFiltros]);

  const selected = useMemo(
    () => pedidos.find((pedido) => pedido.id === selectedId) ?? null,
    [pedidos, selectedId],
  );

  const isFiltered =
    filtros.busca !== '' || filtros.status !== '' || filtros.de !== '' || filtros.ate !== '';
  const isValueSort = filtros.ordenar === 'valor_asc' || filtros.ordenar === 'valor_desc';
  const isDateSort = filtros.ordenar === 'recentes' || filtros.ordenar === 'antigos';

  const limpar = useCallback(() => {
    setBuscaLocal('');
    onLimparFiltros();
  }, [onLimparFiltros]);

  const closeDrawer = useCallback(() => setSelectedId(null), []);
  const openTestDialog = useCallback(() => setIsTestOpen(true), []);
  const closeTestDialog = useCallback(() => setIsTestOpen(false), []);

  const toggleSort = (column: 'valor' | 'atualizacao') => {
    if (column === 'valor') {
      onAtualizarFiltros({
        ordenar: filtros.ordenar === 'valor_desc' ? 'valor_asc' : 'valor_desc',
      });
      return;
    }
    onAtualizarFiltros({
      ordenar: filtros.ordenar === 'recentes' ? 'antigos' : 'recentes',
    });
  };

  const exportar = () => {
    const link = document.createElement('a');
    link.href = urlExportacao(filtros);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const inicio = total === 0 ? 0 : (paginaAtual - 1) * porPagina + 1;
  const fim = Math.min(paginaAtual * porPagina, total);

  return (
    <section className="animate-rise panel-shadow overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line-soft p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">Pedidos</h2>
            <span className="rounded border border-line bg-fill px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
              {isFiltered ? `${total} filtrados` : total}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={exportar}
              disabled={total === 0}
              title={`Exportar ${total} ${total === 1 ? 'pedido' : 'pedidos'} em CSV`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-muted transition hover:border-line-strong hover:bg-fill hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </button>

            {admin && (
              <button
                type="button"
                onClick={openTestDialog}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-invert px-3 text-[12px] font-medium text-invert-ink transition hover:bg-invert/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Testar webhook</span>
                <span className="sm:hidden">Testar</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={buscaLocal}
              onChange={(event) => setBuscaLocal(event.target.value)}
              placeholder="Buscar por pedido, cliente ou ID"
              aria-label="Buscar pedidos"
              className="h-9 w-full rounded-lg border border-line bg-canvas pl-8 pr-3 text-[12.5px] text-ink placeholder:text-faint outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10"
            />
          </div>

          <div className="relative sm:w-40">
            <select
              value={filtros.status}
              onChange={(event) => onAtualizarFiltros({ status: event.target.value })}
              aria-label="Filtrar por status"
              className="h-9 w-full appearance-none rounded-lg border border-line bg-canvas pl-3 pr-8 text-[12.5px] text-ink outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10"
            >
              <option value="" className="bg-surface text-ink">
                Todos os status
              </option>
              {statusDisponiveis.map((status) => (
                <option key={status} value={status} className="bg-surface text-ink">
                  {status}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="sr-only">Data inicial</span>
              <input
                type="date"
                value={filtros.de}
                max={filtros.ate || undefined}
                onChange={(event) => onAtualizarFiltros({ de: event.target.value })}
                aria-label="Data inicial"
                title="Data inicial"
                className="h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-[11.5px] text-ink outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10"
              />
            </label>
            <span className="text-[10px] text-faint">até</span>
            <label className="flex-1">
              <span className="sr-only">Data final</span>
              <input
                type="date"
                value={filtros.ate}
                min={filtros.de || undefined}
                onChange={(event) => onAtualizarFiltros({ ate: event.target.value })}
                aria-label="Data final"
                title="Data final"
                className="h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-[11.5px] text-ink outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10"
              />
            </label>
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={limpar}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-line px-3 text-[12px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {!hasLoaded ? (
        <TableSkeleton />
      ) : pedidos.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-xl border border-dashed border-line-strong text-muted">
            <InboxIcon className="h-6 w-6" />
          </div>

          {!isFiltered ? (
            <>
              <p className="text-[15px] font-semibold text-ink">Nenhum pedido por aqui ainda</p>
              <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted">
                Envie um evento assinado para a loja{' '}
                <span className="font-mono text-ink">{lojaSlug}</span>
                {admin ? ' ou use o simulador autenticado e veja o pedido aparecer na hora.' : '.'}
              </p>
              {admin && (
                <button
                  type="button"
                  onClick={openTestDialog}
                  className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Enviar pedido de teste
                </button>
              )}
              <div className="relative mt-5 w-full max-w-xl">
                <pre className="max-h-[280px] overflow-auto rounded-lg border border-line bg-surface-2 p-4 pr-12 text-left font-mono text-[10.5px] leading-relaxed text-muted">
                  {snippet}
                </pre>
                <CopyButton
                  value={snippet}
                  label="Copiar comando"
                  className="absolute right-2.5 top-2.5"
                />
              </div>
              <p className="mt-2 max-w-xl text-left text-[10.5px] leading-relaxed text-faint">
                {admin
                  ? 'O segredo do marketplace está em Integrações (ícone de chave no topo). '
                  : 'Peça o segredo do marketplace ao administrador da loja. '}
                A assinatura cobre <span className="font-mono">timestamp + &quot;.&quot; + corpo</span>.
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-ink">Nenhum pedido corresponde aos filtros</p>
              <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">
                Ajuste a busca, o status ou o período selecionado para ver outros pedidos.
              </p>
              <button
                type="button"
                onClick={limpar}
                className="mt-5 inline-flex h-9 items-center rounded-lg border border-line bg-fill px-3.5 text-[12.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
              >
                Limpar filtros
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line-soft text-[10px] uppercase tracking-[0.16em] text-faint">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Pedido
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Cliente
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                  <th
                    scope="col"
                    aria-sort={isValueSort ? (filtros.ordenar === 'valor_asc' ? 'ascending' : 'descending') : 'none'}
                    className="px-5 py-3 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort('valor')}
                      className="inline-flex items-center gap-1.5 uppercase tracking-[0.16em] transition hover:text-ink"
                    >
                      Valor
                      <SortIndicator
                        active={isValueSort}
                        direction={filtros.ordenar === 'valor_asc' ? 'asc' : 'desc'}
                      />
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={isDateSort ? (filtros.ordenar === 'antigos' ? 'ascending' : 'descending') : 'none'}
                    className="px-5 py-3 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort('atualizacao')}
                      className="inline-flex items-center gap-1.5 uppercase tracking-[0.16em] transition hover:text-ink"
                    >
                      Atualizado
                      <SortIndicator
                        active={isDateSort}
                        direction={filtros.ordenar === 'antigos' ? 'asc' : 'desc'}
                      />
                    </button>
                  </th>
                  <th scope="col" className="w-10 px-3 py-3">
                    <span className="sr-only">Abrir detalhes</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {pedidos.map((pedido) => {
                  const updatedAt = parseServerDate(pedido.data_atualizacao);
                  const isSelected = selectedId === pedido.id;

                  return (
                    <tr
                      key={pedido.id}
                      tabIndex={0}
                      onClick={() => setSelectedId(pedido.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(pedido.id);
                        }
                      }}
                      className={`group cursor-pointer transition outline-none hover:bg-fill focus-visible:bg-fill ${
                        isSelected ? 'bg-fill' : ''
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-fill font-mono text-[10.5px] text-muted">
                            #{pedido.id}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[12.5px] font-medium text-ink">
                              {pedido.marketplace_id}
                            </p>
                            <p className="mt-0.5 text-[10.5px] text-faint">
                              {pedido.cliente_nome ?? 'marketplace'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[180px] truncate px-5 py-3.5 text-[12px] text-muted">
                        {pedido.cliente_nome ?? '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={pedido.status_atual} />
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[12.5px] tabular-nums text-ink">
                        {formatCurrency(pedido.valor_total)}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-[12.5px] text-muted">{formatRelativeTime(updatedAt, now)}</p>
                        <p className="mt-0.5 text-[10.5px] text-faint">{formatDateTime(updatedAt)}</p>
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <ArrowUpRightIcon className="ml-auto h-4 w-4 text-faint transition group-hover:text-ink" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-line-soft md:hidden">
            {pedidos.map((pedido) => {
              const updatedAt = parseServerDate(pedido.data_atualizacao);

              return (
                <li key={pedido.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(pedido.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-fill"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-fill font-mono text-[10px] text-muted">
                      #{pedido.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-ink">
                        {pedido.marketplace_id}
                      </span>
                      {pedido.cliente_nome && (
                        <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                          {pedido.cliente_nome}
                        </span>
                      )}
                      <span className="mt-1.5 flex items-center gap-2">
                        <StatusBadge status={pedido.status_atual} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[12px] tabular-nums text-ink">
                        {formatCurrency(pedido.valor_total)}
                      </span>
                      <span className="mt-1 block text-[10px] text-faint">
                        {formatRelativeTime(updatedAt, now)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-3 border-t border-line-soft px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[10.5px] text-faint">
              <span>
                Mostrando <span className="font-mono text-ink">{inicio}–{fim}</span> de{' '}
                <span className="font-mono text-ink">{total}</span> pedidos
              </span>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="hidden sm:inline">Por página</span>
                  <select
                    value={porPagina}
                    onChange={(event) =>
                      onAtualizarFiltros({ porPagina: Number(event.target.value) })
                    }
                    aria-label="Pedidos por página"
                    className="h-7 rounded-md border border-line bg-canvas px-1.5 font-mono text-[10.5px] text-ink outline-none focus:border-line-strong"
                  >
                    {[10, 25, 50, 100].map((valor) => (
                      <option key={valor} value={valor} className="bg-surface text-ink">
                        {valor}
                      </option>
                    ))}
                  </select>
                </label>

                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink motion-safe:animate-pulse" />
                  {modo === 'sse'
                    ? 'SSE'
                    : modo === 'polling'
                      ? 'polling 8 s'
                      : 'conectando'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onAtualizarFiltros({ pagina: Math.max(1, paginaAtual - 1) })}
                disabled={paginaAtual <= 1}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[11.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRightIcon className="h-3.5 w-3.5 rotate-180" />
                Anterior
              </button>

              <span className="font-mono text-[11px] text-muted">
                página {paginaAtual} de {Math.max(1, paginas)}
              </span>

              <button
                type="button"
                onClick={() =>
                  onAtualizarFiltros({ pagina: Math.min(Math.max(1, paginas), paginaAtual + 1) })
                }
                disabled={paginaAtual >= paginas}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[11.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

      <OrderDrawer pedido={selected} now={now} onClose={closeDrawer} />

      {isTestOpen && <TestWebhookDialog onClose={closeTestDialog} onCreated={onRefresh} />}
    </section>
  );
}
