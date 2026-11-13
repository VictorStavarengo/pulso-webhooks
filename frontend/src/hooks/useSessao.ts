import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  concluir2FA as concluir2FANaApi,
  criarLoja,
  ehDesafio2FA,
  entrar as entrarNaApi,
  sair as sairDaApi,
  sessaoAtual,
  trocarLoja as trocarLojaNaApi,
  type Loja,
  type Sessao,
} from '../lib/api';

interface UseSessaoResult {
  sessao: Sessao | null;
  carregando: boolean;
  entrando: boolean;
  trocandoLoja: boolean;
  erroLogin: string | null;
  desafio2FA: boolean;
  concluindo2FA: boolean;
  entrar: (email: string, senha: string) => Promise<boolean>;
  concluir2FA: (codigo: string) => Promise<boolean>;
  cancelar2FA: () => void;
  sair: () => Promise<void>;
  selecionarLoja: (lojaId: number) => Promise<void>;
  criarNovaLoja: (nome: string) => Promise<void>;
  lojaAtualizada: (loja: Loja) => void;
  recarregarSessao: () => Promise<void>;
}

function mensagemDeErro(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.message;
  }
  return 'Não foi possível concluir a operação.';
}

export function useSessao(): UseSessaoResult {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [entrando, setEntrando] = useState(false);
  const [trocandoLoja, setTrocandoLoja] = useState(false);
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [desafio2FA, setDesafio2FA] = useState(false);
  const [concluindo2FA, setConcluindo2FA] = useState(false);

  useEffect(() => {
    let ativo = true;

    sessaoAtual()
      .then((atual) => {
        if (ativo) {
          setSessao(atual);
        }
      })
      .catch(() => {
        // Sem sessão válida: a tela de login assume.
      })
      .finally(() => {
        if (ativo) {
          setCarregando(false);
        }
      });

    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    const expirar = () => {
      setSessao((atual) => {
        if (atual) {
          setErroLogin('Sua sessão expirou. Entre novamente para continuar.');
        }
        return null;
      });
    };

    window.addEventListener('pulso:sessao-expirada', expirar);
    return () => window.removeEventListener('pulso:sessao-expirada', expirar);
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    setEntrando(true);
    setErroLogin(null);
    try {
      const resposta = await entrarNaApi(email, senha);
      if (ehDesafio2FA(resposta)) {
        setDesafio2FA(true);
        return true;
      }
      setSessao(resposta);
      setDesafio2FA(false);
      return true;
    } catch (cause) {
      setErroLogin(mensagemDeErro(cause));
      return false;
    } finally {
      setEntrando(false);
    }
  }, []);

  const concluir2FA = useCallback(async (codigo: string) => {
    setConcluindo2FA(true);
    setErroLogin(null);
    try {
      const nova = await concluir2FANaApi(codigo);
      setSessao(nova);
      setDesafio2FA(false);
      return true;
    } catch (cause) {
      setErroLogin(mensagemDeErro(cause));
      return false;
    } finally {
      setConcluindo2FA(false);
    }
  }, []);

  const cancelar2FA = useCallback(() => {
    setDesafio2FA(false);
    setErroLogin(null);
  }, []);

  const sair = useCallback(async () => {
    try {
      await sairDaApi();
    } catch {
      // Mesmo se a API falhar, o painel volta para o login.
    } finally {
      setSessao(null);
      setErroLogin(null);
      setDesafio2FA(false);
    }
  }, []);

  const selecionarLoja = useCallback(async (lojaId: number) => {
    setTrocandoLoja(true);
    try {
      const nova = await trocarLojaNaApi(lojaId);
      setSessao(nova);
    } finally {
      setTrocandoLoja(false);
    }
  }, []);

  const criarNovaLoja = useCallback(async (nome: string) => {
    const loja = await criarLoja(nome);
    const nova = await trocarLojaNaApi(loja.id);
    setSessao(nova);
  }, []);

  const lojaAtualizada = useCallback((loja: Loja) => {
    setSessao((atual) => {
      if (!atual) {
        return atual;
      }
      return {
        ...atual,
        loja,
        lojas: atual.lojas.map((item) => (item.id === loja.id ? loja : item)),
      };
    });
  }, []);

  const recarregarSessao = useCallback(async () => {
    try {
      const atual = await sessaoAtual();
      setSessao(atual);
    } catch {
      // Mantém a sessão atual se a consulta falhar pontualmente.
    }
  }, []);

  return {
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
  };
}
