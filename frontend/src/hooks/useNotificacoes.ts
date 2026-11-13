import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoes,
  type Notificacao,
} from '../lib/api';

interface UseNotificacoesResult {
  notificacoes: Notificacao[];
  naoLidas: number;
  carregando: boolean;
  erro: string | null;
  marcarLida: (id: number) => Promise<void>;
  marcarTodas: () => Promise<void>;
  recarregar: () => void;
}

export function useNotificacoes(lojaId: number): UseNotificacoesResult {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const montadoRef = useRef(true);

  const carregar = useCallback(async () => {
    try {
      const lista = await fetchNotificacoes();
      if (montadoRef.current) {
        setNotificacoes(lista);
        setErro(null);
      }
    } catch (cause) {
      if (montadoRef.current) {
        setErro(cause instanceof Error ? cause.message : 'Não foi possível carregar as notificações.');
      }
    } finally {
      if (montadoRef.current) {
        setCarregando(false);
      }
    }
  }, []);

  useEffect(() => {
    montadoRef.current = true;
    const inicio = window.setTimeout(() => {
      void carregar();
    }, 0);

    const intervalo = window.setInterval(() => {
      if (!document.hidden) {
        void carregar();
      }
    }, 60000);

    const aoEvento = (event: Event) => {
      const detalhe = (event as CustomEvent<string>).detail;
      if (detalhe === 'notificacoes') {
        void carregar();
      }
    };

    window.addEventListener('pulso:evento', aoEvento);

    return () => {
      montadoRef.current = false;
      window.clearTimeout(inicio);
      window.clearInterval(intervalo);
      window.removeEventListener('pulso:evento', aoEvento);
    };
  }, [carregar, lojaId]);

  const marcarLida = useCallback(async (id: number) => {
    const anterior = notificacoes;
    setNotificacoes((lista) =>
      lista.map((item) =>
        item.id === id && !item.lida_em ? { ...item, lida_em: new Date().toISOString() } : item,
      ),
    );
    try {
      await marcarNotificacaoLida(id);
    } catch {
      setNotificacoes(anterior);
    }
  }, [notificacoes]);

  const marcarTodas = useCallback(async () => {
    const anterior = notificacoes;
    const agora = new Date().toISOString();
    setNotificacoes((lista) =>
      lista.map((item) => (item.lida_em ? item : { ...item, lida_em: agora })),
    );
    try {
      await marcarTodasNotificacoes();
    } catch {
      setNotificacoes(anterior);
    }
  }, [notificacoes]);

  const naoLidas = useMemo(
    () => notificacoes.filter((item) => !item.lida_em).length,
    [notificacoes],
  );

  const recarregar = useCallback(() => {
    void carregar();
  }, [carregar]);

  return { notificacoes, naoLidas, carregando, erro, marcarLida, marcarTodas, recarregar };
}
