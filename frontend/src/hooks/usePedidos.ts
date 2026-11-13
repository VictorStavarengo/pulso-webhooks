import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FILTROS_PEDIDOS_INICIAIS,
  fetchPedidos,
  urlStream,
  type FiltrosPedidos,
  type Pedido,
  type PedidoResumo,
  type PedidosPagina,
} from '../lib/api';

export type ConnectionState = 'connecting' | 'online' | 'offline';
export type StreamMode = 'conectando' | 'sse' | 'polling';

interface UsePedidosResult {
  pedidos: Pedido[];
  resumo: PedidoResumo | null;
  total: number;
  paginas: number;
  paginaAtual: number;
  porPagina: number;
  filtros: FiltrosPedidos;
  atualizarFiltros: (parcial: Partial<FiltrosPedidos>) => void;
  limparFiltros: () => void;
  connection: ConnectionState;
  modo: StreamMode;
  latency: number | null;
  lastSync: Date | null;
  isRefreshing: boolean;
  error: string | null;
  hasLoaded: boolean;
  now: number;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 8000;

export function usePedidos(lojaId: number): UsePedidosResult {
  const [pagina, setPagina] = useState<PedidosPagina | null>(null);
  const [filtros, setFiltros] = useState<FiltrosPedidos>(FILTROS_PEDIDOS_INICIAIS);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [modo, setModo] = useState<StreamMode>('conectando');
  const [latency, setLatency] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const controllerRef = useRef<AbortController | null>(null);
  const modoRef = useRef<StreamMode>('conectando');
  const filtrosRef = useRef<FiltrosPedidos>(FILTROS_PEDIDOS_INICIAIS);

  const definirModo = useCallback((novo: StreamMode) => {
    modoRef.current = novo;
    setModo(novo);
  }, []);

  const load = useCallback(async (manual: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (manual) {
      setIsRefreshing(true);
    }

    try {
      const result = await fetchPedidos(filtrosRef.current, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setPagina(result.pagina);
      setLatency(result.latency);
      setLastSync(new Date());
      setConnection('online');
      setError(null);
    } catch (cause) {
      if (controller.signal.aborted) {
        return;
      }
      if (modoRef.current !== 'sse') {
        setConnection('offline');
      }
      setError(
        cause instanceof TypeError
          ? 'Sem resposta do servidor.'
          : cause instanceof Error
            ? cause.message
            : 'Não foi possível consultar a API de pedidos.',
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsRefreshing(false);
        setHasLoaded(true);
      }
    }
  }, []);

  const atualizarFiltros = useCallback(
    (parcial: Partial<FiltrosPedidos>) => {
      const proximo: FiltrosPedidos = { ...filtrosRef.current, ...parcial };
      if (parcial.pagina === undefined) {
        proximo.pagina = 1;
      }
      filtrosRef.current = proximo;
      setFiltros(proximo);
      void load(true);
    },
    [load],
  );

  const limparFiltros = useCallback(() => {
    filtrosRef.current = FILTROS_PEDIDOS_INICIAIS;
    setFiltros(FILTROS_PEDIDOS_INICIAIS);
    void load(true);
  }, [load]);

  useEffect(() => {
    let ativo = true;
    let stream: EventSource | null = null;
    let tentativas = 0;
    let timerReconexao: number | undefined;

    modoRef.current = 'conectando';

    const conectarStream = () => {
      if (!ativo) {
        return;
      }

      stream?.close();
      stream = new EventSource(urlStream(), { withCredentials: true });

      stream.addEventListener('pronto', () => {
        if (!ativo) {
          return;
        }
        tentativas = 0;
        definirModo('sse');
        setConnection('online');
        setError(null);
      });

      stream.addEventListener('pedidos', () => {
        if (ativo) {
          void load(false);
        }
      });

      stream.addEventListener('notificacoes', () => {
        if (ativo) {
          window.dispatchEvent(new CustomEvent('pulso:evento', { detail: 'notificacoes' }));
        }
      });

      stream.onerror = () => {
        if (!ativo) {
          return;
        }
        stream?.close();
        definirModo('polling');
        const atraso = Math.min(30000, 3000 * 2 ** tentativas);
        tentativas += 1;
        timerReconexao = window.setTimeout(conectarStream, atraso);
      };
    };

    const inicio = window.setTimeout(() => {
      void load(false);
      conectarStream();
    }, 0);

    const intervalo = window.setInterval(() => {
      if (!document.hidden && modoRef.current !== 'sse') {
        void load(false);
      }
    }, POLL_INTERVAL_MS);

    const aoVoltar = () => {
      if (!document.hidden) {
        void load(false);
      }
    };
    document.addEventListener('visibilitychange', aoVoltar);

    return () => {
      ativo = false;
      window.clearTimeout(inicio);
      stream?.close();
      window.clearTimeout(timerReconexao);
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoVoltar);
      controllerRef.current?.abort();
    };
  }, [definirModo, load, lojaId]);

  useEffect(() => {
    const clockId = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(clockId);
  }, []);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return {
    pedidos: pagina?.itens ?? [],
    resumo: pagina?.resumo ?? null,
    total: pagina?.total ?? 0,
    paginas: pagina?.paginas ?? 0,
    paginaAtual: pagina?.pagina ?? filtros.pagina,
    porPagina: pagina?.por_pagina ?? filtros.porPagina,
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
  };
}
