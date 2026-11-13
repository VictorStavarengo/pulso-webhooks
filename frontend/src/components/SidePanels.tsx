import { API_BASE, type PedidoResumo } from '../lib/api';
import type { ConnectionState, StreamMode } from '../hooks/usePedidos';
import { formatRelativeTime } from '../lib/format';
import { barClasses, dotClasses, statusMeta } from '../lib/status';

interface StatusBreakdownProps {
  resumo: PedidoResumo | null;
}

export function StatusBreakdown({ resumo }: StatusBreakdownProps) {
  const groups = Object.entries(resumo?.por_status ?? {})
    .map(([status, count]) => ({ status, count, meta: statusMeta(status) }))
    .sort((a, b) => b.count - a.count);

  const total = resumo?.total ?? 0;

  return (
    <section
      className="animate-rise rounded-xl border border-line bg-surface p-5"
      style={{ animationDelay: '180ms' }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
          Distribuição por status
        </h2>
        <span className="font-mono text-[10.5px] text-faint">
          {total} {total === 1 ? 'pedido' : 'pedidos'}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
          Os status aparecem aqui assim que o primeiro webhook for processado.
        </p>
      ) : (
        <ul className="mt-4 space-y-3.5">
          {groups.map(({ status, count, meta }) => {
            const percentage = total === 0 ? 0 : Math.round((count / total) * 100);

            return (
              <li key={status}>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="flex min-w-0 items-center gap-2 text-muted">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses(meta.tone)}`} />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">
                    {count}
                    <span className="text-faint"> · {percentage}%</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-fill">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${barClasses(meta.tone)}`}
                    style={{ width: `${Math.max(percentage, 3)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface ConnectionCardProps {
  connection: ConnectionState;
  modo: StreamMode;
  latency: number | null;
  lastSync: Date | null;
  now: number;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Conectando',
  online: 'Online',
  offline: 'Offline',
};

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: 'bg-ink/40',
  online: 'bg-ink',
  offline: 'border border-ink bg-transparent',
};

function getHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function ConnectionCard({ connection, modo, latency, lastSync, now }: ConnectionCardProps) {
  const rows: Array<[string, string]> = [
    [
      'Canal',
      modo === 'sse' ? 'SSE (stream)' : modo === 'polling' ? 'Polling · 8 s' : 'Conectando',
    ],
    ['Latência', latency === null ? '—' : `${latency} ms`],
    ['Última sincronização', lastSync ? formatRelativeTime(lastSync, now) : '—'],
    ['Fonte', API_BASE ? getHost(API_BASE) : window.location.host],
  ];

  return (
    <section
      className="animate-rise rounded-xl border border-line bg-surface p-5"
      style={{ animationDelay: '240ms' }}
    >
      <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
        Saúde da conexão
      </h2>

      <dl className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[11.5px] text-faint">Status</dt>
          <dd className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
            <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`} />
            {CONNECTION_LABEL[connection]}
          </dd>
        </div>

        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-[11.5px] text-faint">{label}</dt>
            <dd className="truncate font-mono text-[11px] tabular-nums text-muted" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 border-t border-line-soft pt-3 text-[10.5px] leading-relaxed text-faint">
        {modo === 'sse'
          ? 'O stream mantém a conexão aberta e atualiza o painel assim que um evento é processado.'
          : 'Sem o stream, o painel consulta a API a cada 8 segundos e pausa em segundo plano.'}
      </p>
    </section>
  );
}
