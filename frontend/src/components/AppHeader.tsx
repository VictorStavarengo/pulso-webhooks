import { useEffect, useRef, useState } from 'react';
import type { Sessao } from '../lib/api';
import type { ConnectionState, StreamMode } from '../hooks/usePedidos';
import type { Theme } from '../hooks/useTheme';
import ThemeToggle from './ThemeToggle';
import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  KeyIcon,
  LogOutIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
  ZapIcon,
} from './icons';

interface AppHeaderProps {
  sessao: Sessao;
  connection: ConnectionState;
  modo: StreamMode;
  latency: number | null;
  isRefreshing: boolean;
  naoLidas: number;
  trocandoLoja: boolean;
  theme: Theme;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onSelecionarLoja: (lojaId: number) => void;
  onNovaLoja: () => void;
  onAbrirNotificacoes: () => void;
  onAbrirIntegracoes: () => void;
  onAbrirSeguranca: () => void;
  onAbrirEquipe: () => void;
  onSair: () => void;
}

type Menu = 'loja' | 'conta' | null;

function rotuloConexao(connection: ConnectionState, modo: StreamMode): string {
  if (connection === 'offline') {
    return 'Offline';
  }
  if (connection === 'connecting' || modo === 'conectando') {
    return 'Conectando';
  }
  return modo === 'sse' ? 'Tempo real' : 'Polling';
}

function estiloConexao(connection: ConnectionState): { dot: string; pill: string } {
  if (connection === 'offline') {
    return { dot: 'border border-ink bg-transparent', pill: 'border-dashed border-line-strong text-muted' };
  }
  if (connection === 'connecting') {
    return { dot: 'bg-ink/40', pill: 'border-dashed border-line text-muted' };
  }
  return { dot: 'bg-ink', pill: 'border-line bg-fill text-ink' };
}

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');
}

export default function AppHeader({
  sessao,
  connection,
  modo,
  latency,
  isRefreshing,
  naoLidas,
  trocandoLoja,
  theme,
  onRefresh,
  onToggleTheme,
  onSelecionarLoja,
  onNovaLoja,
  onAbrirNotificacoes,
  onAbrirIntegracoes,
  onAbrirSeguranca,
  onAbrirEquipe,
  onSair,
}: AppHeaderProps) {
  const [menu, setMenu] = useState<Menu>(null);
  const lojaRef = useRef<HTMLDivElement>(null);
  const contaRef = useRef<HTMLDivElement>(null);

  const estado = estiloConexao(connection);
  const loja = sessao.loja;
  const admin = sessao.usuario.papel === 'admin';

  useEffect(() => {
    if (!menu) {
      return;
    }

    const fecharFora = (event: MouseEvent) => {
      const alvo = event.target as Node;
      const dentroDaLoja = lojaRef.current?.contains(alvo) ?? false;
      const dentroDaConta = contaRef.current?.contains(alvo) ?? false;
      if (!dentroDaLoja && !dentroDaConta) {
        setMenu(null);
      }
    };
    const fecharEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
      }
    };

    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharEsc);

    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharEsc);
    };
  }, [menu]);

  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-2 px-4 sm:gap-3 sm:px-8">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-invert text-invert-ink">
          <ZapIcon className="h-[18px] w-[18px]" strokeWidth={2.1} />
        </div>

        <div className="hidden leading-none sm:block">
          <p className="text-[14.5px] font-semibold tracking-[-0.02em] text-ink">Pulso</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-faint">
            Commerce Ops
          </p>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-line sm:block" />

        <div className="relative" ref={lojaRef}>
          <button
            type="button"
            onClick={() => setMenu(menu === 'loja' ? null : 'loja')}
            disabled={trocandoLoja}
            aria-haspopup="menu"
            aria-expanded={menu === 'loja'}
            className="inline-flex h-9 max-w-[168px] items-center gap-2 rounded-lg border border-line bg-fill px-2.5 text-left transition hover:border-line-strong hover:bg-fill-hover disabled:cursor-wait disabled:opacity-60 sm:max-w-[220px]"
          >
            <StoreIcon className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium leading-tight text-ink">
                {trocandoLoja ? 'Trocando…' : loja.nome}
              </span>
              <span className="block truncate font-mono text-[9.5px] leading-tight text-faint">
                {loja.slug}
              </span>
            </span>
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-faint" />
          </button>

          {menu === 'loja' && (
            <div
              role="menu"
              aria-label="Selecionar loja"
              className="animate-fade panel-shadow absolute left-0 top-[calc(100%+8px)] z-40 w-64 overflow-hidden rounded-xl border border-line bg-surface"
            >
              <p className="border-b border-line-soft px-3 py-2 text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
                Suas lojas
              </p>
              <ul className="max-h-64 overflow-y-auto py-1">
                {sessao.lojas.map((item) => {
                  const ativa = item.id === loja.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={ativa}
                        onClick={() => {
                          setMenu(null);
                          if (!ativa) {
                            onSelecionarLoja(item.id);
                          }
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                          ativa ? 'bg-fill' : 'hover:bg-fill'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-ink">
                            {item.nome}
                          </span>
                          <span className="block truncate font-mono text-[9.5px] text-faint">
                            {item.slug}
                          </span>
                        </span>
                        {ativa && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ink" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {admin && (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    onNovaLoja();
                  }}
                  className="flex w-full items-center gap-2 border-t border-line-soft px-3 py-2.5 text-[12px] font-medium text-muted transition hover:bg-fill hover:text-ink"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Nova loja
                </button>
              )}
            </div>
          )}
        </div>

        <nav
          aria-label="Trilha de navegação"
          className="ml-1 hidden items-center gap-1.5 text-[12.5px] text-muted lg:flex"
        >
          <ChevronRightIcon className="h-3.5 w-3.5 text-faint" />
          <span className="font-medium text-ink">Pedidos</span>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span
            title={rotuloConexao(connection, modo)}
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-2.5 text-[11.5px] font-medium ${estado.pill}`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${estado.dot}`}
              />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${estado.dot}`} />
            </span>
            <span className="hidden md:inline">{rotuloConexao(connection, modo)}</span>
            {connection === 'online' && modo === 'sse' && latency !== null && (
              <span className="hidden font-mono text-[10px] text-faint lg:inline">{latency} ms</span>
            )}
          </span>

          <button
            type="button"
            onClick={onAbrirNotificacoes}
            aria-label={naoLidas > 0 ? `${naoLidas} notificações não lidas` : 'Abrir notificações'}
            title="Notificações"
            className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <BellIcon className="h-4 w-4" />
            {naoLidas > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-invert px-1 font-mono text-[9px] leading-none text-invert-ink">
                {naoLidas > 9 ? '9+' : naoLidas}
              </span>
            )}
          </button>

          {admin && (
            <button
              type="button"
              onClick={onAbrirIntegracoes}
              aria-label="Integrações e segredos"
              title="Integrações e segredos"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              <KeyIcon className="h-4 w-4" />
            </button>
          )}

          <ThemeToggle theme={theme} onToggle={onToggleTheme} />

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Atualizar pedidos"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-fill px-2.5 text-[12.5px] font-medium text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
            <span className="hidden xl:inline">Atualizar</span>
          </button>

          <div className="relative" ref={contaRef}>
            <button
              type="button"
              onClick={() => setMenu(menu === 'conta' ? null : 'conta')}
              aria-haspopup="menu"
              aria-expanded={menu === 'conta'}
              aria-label="Menu da conta"
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-invert text-[11px] font-semibold text-invert-ink transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              {iniciais(sessao.usuario.nome) || 'U'}
            </button>

            {menu === 'conta' && (
              <div
                role="menu"
                aria-label="Conta"
                className="animate-fade panel-shadow absolute right-0 top-[calc(100%+8px)] z-40 w-60 overflow-hidden rounded-xl border border-line bg-surface"
              >
                <div className="border-b border-line-soft px-3 py-3">
                  <p className="truncate text-[12.5px] font-medium text-ink">{sessao.usuario.nome}</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                    {sessao.usuario.email}
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted">
                    {admin ? 'Administrador' : 'Operador'}
                    {sessao.usuario.totp_ativo && ' · 2FA'}
                  </span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    onAbrirSeguranca();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-muted transition hover:bg-fill hover:text-ink"
                >
                  <ShieldIcon className="h-3.5 w-3.5" />
                  Segurança e 2FA
                </button>
                {admin && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      onAbrirEquipe();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-muted transition hover:bg-fill hover:text-ink"
                  >
                    <UsersIcon className="h-3.5 w-3.5" />
                    Equipe e acessos
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    void onSair();
                  }}
                  className="flex w-full items-center gap-2 border-t border-line-soft px-3 py-2.5 text-[12px] font-medium text-muted transition hover:bg-fill hover:text-ink"
                >
                  <LogOutIcon className="h-3.5 w-3.5" />
                  Encerrar sessão
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
