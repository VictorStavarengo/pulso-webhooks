import { useCallback, useMemo, useState } from 'react';
import AppHeader from './components/AppHeader';
import CopyButton from './components/CopyButton';
import EquipeDialog from './components/EquipeDialog';
import IntegrationsPanel from './components/IntegrationsPanel';
import LoginScreen from './components/LoginScreen';
import NotificationsPanel from './components/NotificationsPanel';
import NovaLojaDialog from './components/NovaLojaDialog';
import OrdersPanel from './components/OrdersPanel';
import SegurancaDialog from './components/SegurancaDialog';
import StatCard from './components/StatCard';
import { ConnectionCard, StatusBreakdown } from './components/SidePanels';
import {
  ActivityIcon,
  AlertTriangleIcon,
  PackageIcon,
  ReceiptIcon,
  RefreshIcon,
  TrendingUpIcon,
  ZapIcon,
} from './components/icons';
import { useNotificacoes } from './hooks/useNotificacoes';
import { usePedidos } from './hooks/usePedidos';
import { useSessao } from './hooks/useSessao';
import { useTheme, type Theme } from './hooks/useTheme';
import { API_BASE, WEBHOOK_ENDPOINT, type Loja, type Sessao } from './lib/api';
import {
  formatCompactNumber,
  formatCurrency,
  formatShortDate,
  parseServerDate,
} from './lib/format';

function Splash() {
  return (
    <div className="relative grid min-h-screen place-items-center bg-canvas text-ink">
      <div aria-hidden="true" className="dot-grid pointer-events-none fixed inset-0 opacity-70" />
      <div className="relative flex flex-col items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-invert text-invert-ink motion-safe:animate-pulse">
          <ZapIcon className="h-5 w-5" strokeWidth={2.1} />
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
          carregando painel
        </p>
      </div>
    </div>
  );
}

interface DashboardProps {
  sessao: Sessao;
  theme: Theme;
  onToggleTheme: () => void;
  onSelecionarLoja: (lojaId: number) => void;
  onCriarLoja: (nome: string) => Promise<void>;
  onSair: () => void;
  trocandoLoja: boolean;
  onLojaAtualizada: (loja: Loja) => void;
  onRecarregarSessao: () => Promise<void>;
}

function Dashboard({
  sessao,
  theme,
  onToggleTheme,
  onSelecionarLoja,
  onCriarLoja,
  onSair,
  trocandoLoja,
  onLojaAtualizada,
  onRecarregarSessao,
}: DashboardProps) {
  const { loja } = sessao;
  const {
    pedidos,
    resumo: resumoPedidos,
    total,
    paginas,
    paginaAtual,
    porPagina,
    filtros,
    atualizarFiltros,
    limparFiltros,
    connection,
    modo,
    latency,
    lastSync,
    isRefreshing,
    error,
    hasLoaded,
    now,
    refresh,
  } = usePedidos(loja.id);
  const notificacoes = useNotificacoes(loja.id);

  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false);
  const [integracoesAbertas, setIntegracoesAbertas] = useState(false);
  const [novaLojaAberta, setNovaLojaAberta] = useState(false);
  const [equipeAberta, setEquipeAberta] = useState(false);
  const [segurancaAberta, setSegurancaAberta] = useState(false);

  const stats = useMemo(() => {
    const oldest = resumoPedidos?.mais_antigo ? parseServerDate(resumoPedidos.mais_antigo) : null;
    return {
      total: resumoPedidos?.total ?? 0,
      revenue: resumoPedidos?.receita ?? 0,
      average: resumoPedidos?.ticket_medio ?? 0,
      active: resumoPedidos?.em_andamento ?? 0,
      oldest,
    };
  }, [resumoPedidos]);

  const abrirNotificacoes = useCallback(() => {
    setIntegracoesAbertas(false);
    setNotificacoesAbertas(true);
    notificacoes.recarregar();
  }, [notificacoes]);

  const fecharNotificacoes = useCallback(() => setNotificacoesAbertas(false), []);

  const abrirIntegracoes = useCallback(() => {
    setNotificacoesAbertas(false);
    setIntegracoesAbertas(true);
  }, []);

  const fecharIntegracoes = useCallback(() => setIntegracoesAbertas(false), []);
  const abrirNovaLoja = useCallback(() => setNovaLojaAberta(true), []);
  const fecharNovaLoja = useCallback(() => setNovaLojaAberta(false), []);
  const abrirEquipe = useCallback(() => setEquipeAberta(true), []);
  const fecharEquipe = useCallback(() => setEquipeAberta(false), []);
  const abrirSeguranca = useCallback(() => setSegurancaAberta(true), []);
  const fecharSeguranca = useCallback(() => setSegurancaAberta(false), []);

  const displayValue = (value: string) => (hasLoaded ? value : '—');
  const origemApi = API_BASE || window.location.origin;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-canvas text-ink">
      <div aria-hidden="true" className="dot-grid pointer-events-none fixed inset-0 opacity-70" />
      <div aria-hidden="true" className="hero-glow pointer-events-none fixed inset-x-0 top-0 h-[520px]" />

      <AppHeader
        sessao={sessao}
        connection={connection}
        modo={modo}
        latency={latency}
        isRefreshing={isRefreshing}
        naoLidas={notificacoes.naoLidas}
        trocandoLoja={trocandoLoja}
        theme={theme}
        onRefresh={refresh}
        onToggleTheme={onToggleTheme}
        onSelecionarLoja={onSelecionarLoja}
        onNovaLoja={abrirNovaLoja}
        onAbrirNotificacoes={abrirNotificacoes}
        onAbrirIntegracoes={abrirIntegracoes}
        onAbrirSeguranca={abrirSeguranca}
        onAbrirEquipe={abrirEquipe}
        onSair={onSair}
      />

      <main className="relative mx-auto w-full max-w-[1240px] px-5 pb-16 pt-10 sm:px-8">
        <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-ink motion-safe:animate-pulse" />
              {modo === 'sse' ? 'Stream em tempo real' : 'Pipeline de webhooks'}
            </span>

            <h1 className="mt-4 text-[31px] font-semibold leading-[1.04] tracking-[-0.045em] text-ink sm:text-[42px]">
              Pedidos em{' '}
              <span className="inline-block rounded-[3px] bg-invert px-2 py-[0.08em] text-invert-ink">
                tempo real
              </span>
            </h1>

            <p className="mt-3.5 max-w-lg text-[13px] leading-relaxed text-muted">
              Cada evento assinado das suas integrações atualiza este painel automaticamente.
              Acompanhe status, receita e os últimos pedidos de{' '}
              <span className="font-medium text-ink">{loja.nome}</span> em um só lugar.
            </p>
          </div>

          <div className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 lg:w-[382px] lg:shrink-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-invert text-invert-ink">
              <ZapIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
                Webhook da loja{' '}
                <span className="font-mono normal-case tracking-normal text-muted">{loja.slug}</span>
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-ink">
                  POST
                </span>
                <span className="truncate font-mono text-[11px] text-muted">/webhooks/pedidos</span>
              </div>
            </div>
            <CopyButton value={WEBHOOK_ENDPOINT} label="Copiar endpoint" />
          </div>
        </section>

        {connection === 'offline' && (
          <div className="animate-rise mt-6 flex flex-col gap-3 rounded-xl border border-line-strong bg-fill px-4 py-3.5 sm:flex-row sm:items-center">
            <AlertTriangleIcon className="h-4 w-4 shrink-0 text-ink" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-ink">
                Não foi possível falar com a API de pedidos
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                {error ?? 'Verifique a conexão.'} A API está em{' '}
                <span className="font-mono text-ink">{origemApi}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={isRefreshing}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-invert px-3 text-[12px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:opacity-50"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
              Tentar novamente
            </button>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Pedidos monitorados"
            value={displayValue(formatCompactNumber(stats.total))}
            hint={stats.oldest ? `Desde ${formatShortDate(stats.oldest)}` : 'Aguardando o primeiro evento'}
            icon={<PackageIcon className="h-4 w-4" />}
          />
          <StatCard
            label="Receita total"
            value={displayValue(formatCurrency(stats.revenue))}
            hint={`${stats.total} ${stats.total === 1 ? 'pedido somado' : 'pedidos somados'}`}
            icon={<TrendingUpIcon className="h-4 w-4" />}
            featured
            delay={60}
          />
          <StatCard
            label="Ticket médio"
            value={displayValue(formatCurrency(stats.average))}
            hint="Média por pedido"
            icon={<ReceiptIcon className="h-4 w-4" />}
            delay={120}
          />
          <StatCard
            label="Em andamento"
            value={displayValue(formatCompactNumber(stats.active))}
            hint="Fora de entrega ou cancelamento"
            icon={<ActivityIcon className="h-4 w-4" />}
            delay={180}
          />
        </div>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_312px]">
          <OrdersPanel
            pedidos={pedidos}
            hasLoaded={hasLoaded}
            now={now}
            modo={modo}
            lojaSlug={loja.slug}
            filtros={filtros}
            paginaAtual={paginaAtual}
            paginas={paginas}
            porPagina={porPagina}
            total={total}
            statusDisponiveis={Object.keys(resumoPedidos?.por_status ?? {})}
            onAtualizarFiltros={atualizarFiltros}
            onLimparFiltros={limparFiltros}
            onRefresh={refresh}
            admin={sessao.usuario.papel === 'admin'}
          />

          <aside className="flex flex-col gap-5 xl:sticky xl:top-[84px]">
            <StatusBreakdown resumo={resumoPedidos} />
            <ConnectionCard
              connection={connection}
              modo={modo}
              latency={latency}
              lastSync={lastSync}
              now={now}
            />
          </aside>
        </div>

        <footer className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-line-soft pt-5 text-[10.5px] text-faint sm:flex-row sm:items-center">
          <span>
            Pulso · painel de operações · {sessao.usuario.nome} ·{' '}
            {sessao.usuario.papel === 'admin' ? 'administrador' : 'operador'}
          </span>
          <span className="font-mono">
            {modo === 'sse' ? 'stream SSE' : 'polling 8s'} · {origemApi.replace(/^https?:\/\//, '')}
          </span>
        </footer>
      </main>

      <NotificationsPanel
        aberto={notificacoesAbertas}
        onFechar={fecharNotificacoes}
        notificacoes={notificacoes.notificacoes}
        carregando={notificacoes.carregando}
        erro={notificacoes.erro}
        loja={loja}
        now={now}
        admin={sessao.usuario.papel === 'admin'}
        onMarcarLida={notificacoes.marcarLida}
        onMarcarTodas={notificacoes.marcarTodas}
        onRecarregar={notificacoes.recarregar}
        onLojaAtualizada={onLojaAtualizada}
      />

      <IntegrationsPanel aberto={integracoesAbertas} onFechar={fecharIntegracoes} loja={loja} />

      {novaLojaAberta && <NovaLojaDialog onCriar={onCriarLoja} onClose={fecharNovaLoja} />}

      <EquipeDialog
        aberto={equipeAberta}
        onFechar={fecharEquipe}
        lojas={sessao.lojas}
        lojaAtual={loja}
      />

      <SegurancaDialog
        aberto={segurancaAberta}
        onFechar={fecharSeguranca}
        usuario={sessao.usuario}
        onAtualizado={onRecarregarSessao}
      />
    </div>
  );
}

export default function App() {
  const {
    sessao,
    carregando,
    entrando,
    trocandoLoja,
    erroLogin,
    desafio2FA,
    concluindo2FA,
    entrar,
    concluir2FA,
    cancelar2FA,
    sair,
    selecionarLoja,
    criarNovaLoja,
    lojaAtualizada,
    recarregarSessao,
  } = useSessao();
  const { theme, toggleTheme } = useTheme();

  if (carregando) {
    return <Splash />;
  }

  if (!sessao) {
    return (
      <LoginScreen
        onEntrar={entrar}
        onConcluir2FA={concluir2FA}
        onCancelar2FA={cancelar2FA}
        entrando={entrando}
        concluindo2FA={concluindo2FA}
        desafio2FA={desafio2FA}
        erro={erroLogin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <Dashboard
      key={sessao.loja.id}
      sessao={sessao}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSelecionarLoja={selecionarLoja}
      onCriarLoja={criarNovaLoja}
      onSair={sair}
      trocandoLoja={trocandoLoja}
      onLojaAtualizada={lojaAtualizada}
      onRecarregarSessao={recarregarSessao}
    />
  );
}
