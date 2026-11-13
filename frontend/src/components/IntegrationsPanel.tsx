import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  criarIntegracao,
  fetchIntegracoes,
  removerIntegracao,
  rotacionarSegredo,
  WEBHOOK_ENDPOINT,
  type Integracao,
  type Loja,
} from '../lib/api';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { formatDateTime, parseServerDate } from '../lib/format';
import CopyButton from './CopyButton';
import {
  ChevronDownIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  PlusIcon,
  RefreshIcon,
} from './icons';

interface IntegrationsPanelProps {
  aberto: boolean;
  onFechar: () => void;
  loja: Loja;
}

const FIELD_CLASS =
  'h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink placeholder:text-faint outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10';

function snippetAssinatura(slug: string): string {
  return `BODY='{"origem":"shopee","pedido_id":"BR-1001","status":"PAGO","valor":249.90,"evento_id":"evt_1001"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PULSO_SEGREDO" | sed 's/^.* //')

curl -X POST ${WEBHOOK_ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -H "X-Pulso-Loja: ${slug}" \\
  -H "X-Pulso-Marketplace: shopee" \\
  -H "X-Pulso-Timestamp: $TS" \\
  -H "X-Pulso-Assinatura: sha256=$SIG" \\
  -d "$BODY"`;
}

export default function IntegrationsPanel({ aberto, onFechar, loja }: IntegrationsPanelProps) {
  useDialogBehavior(aberto, onFechar);

  const [integracoes, setIntegracoes] = useState<Integracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [revelados, setRevelados] = useState<Set<number>>(new Set());
  const [rotacionando, setRotacionando] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [removendo, setRemovendo] = useState<number | null>(null);
  const [novoMarketplace, setNovoMarketplace] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) {
      return;
    }

    let ativo = true;

    const carregar = async () => {
      setCarregando(true);
      setErro(null);
      try {
        const lista = await fetchIntegracoes(loja.id);
        if (ativo) {
          setIntegracoes(lista);
        }
      } catch (cause) {
        if (ativo) {
          setErro(cause instanceof Error ? cause.message : 'Não foi possível carregar as integrações.');
        }
      } finally {
        if (ativo) {
          setCarregando(false);
        }
      }
    };

    void carregar();

    return () => {
      ativo = false;
    };
  }, [aberto, loja.id]);

  if (!aberto) {
    return null;
  }

  function alternarRevelado(id: number) {
    setRevelados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) {
        proximo.delete(id);
      } else {
        proximo.add(id);
      }
      return proximo;
    });
  }

  async function adicionar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const marketplace = novoMarketplace.trim();
    if (marketplace.length < 2) {
      setErroForm('Informe o nome do marketplace (mínimo 2 caracteres).');
      return;
    }

    setAdicionando(true);
    setErroForm(null);
    try {
      const criada = await criarIntegracao(loja.id, marketplace);
      setIntegracoes((lista) =>
        [...lista, criada].sort((a, b) => a.marketplace.localeCompare(b.marketplace)),
      );
      setNovoMarketplace('');
    } catch (cause) {
      setErroForm(cause instanceof Error ? cause.message : 'Não foi possível criar a integração.');
    } finally {
      setAdicionando(false);
    }
  }

  async function rotacionar(id: number) {
    setRotacionando(id);
    setErro(null);
    try {
      const atualizada = await rotacionarSegredo(id);
      setIntegracoes((lista) => lista.map((item) => (item.id === id ? atualizada : item)));
      setRevelados((atual) => new Set(atual).add(id));
      setConfirmando(null);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível rotacionar o segredo.');
    } finally {
      setRotacionando(null);
    }
  }

  async function remover(id: number) {
    setRemovendo(id);
    setErro(null);
    try {
      await removerIntegracao(id);
      setIntegracoes((lista) => lista.filter((item) => item.id !== id));
      setConfirmando(null);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível remover a integração.');
    } finally {
      setRemovendo(null);
    }
  }

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
        aria-labelledby="integracoes-title"
        className="animate-slide-in panel-shadow absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              {loja.nome} · {loja.slug}
            </p>
            <h2
              id="integracoes-title"
              className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink"
            >
              <KeyIcon className="h-4 w-4" />
              Integrações assinadas
            </h2>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar integrações"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="rounded-lg border border-line bg-fill px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
              Endpoint de recebimento
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-ink">
                POST
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                {WEBHOOK_ENDPOINT}
              </span>
              <CopyButton value={WEBHOOK_ENDPOINT} label="Copiar endpoint" />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <h3 className="text-[12.5px] font-semibold text-ink">Marketplaces</h3>
            <span className="font-mono text-[10.5px] text-faint">
              {integracoes.length} {integracoes.length === 1 ? 'segredo' : 'segredos'}
            </span>
          </div>

          {erro && (
            <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-fill px-3 py-2 text-[11.5px] text-ink">
              {erro}
            </p>
          )}

          {carregando ? (
            <div className="mt-3 space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="skeleton h-20 rounded-lg" />
              ))}
            </div>
          ) : integracoes.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-4 text-[11.5px] leading-relaxed text-muted">
              Nenhum marketplace configurado. Crie o primeiro abaixo para gerar um segredo HMAC.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {integracoes.map((integracao) => {
                const revelado = revelados.has(integracao.id);
                const confirmandoEsta = confirmando === integracao.id;

                return (
                  <li key={integracao.id} className="rounded-xl border border-line bg-surface-2 p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-surface font-mono text-[10px] uppercase text-muted">
                        {integracao.marketplace.slice(0, 2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium capitalize text-ink">
                          {integracao.marketplace}
                        </p>
                        <p className="mt-0.5 text-[10px] text-faint">
                          Criada em {formatDateTime(parseServerDate(integracao.criado_em))}
                        </p>
                      </div>
                      <span className="rounded-full border border-line px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-muted">
                        {integracao.ativo ? 'ativa' : 'inativa'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                      <span className="min-w-0 flex-1 break-all font-mono text-[10.5px] leading-relaxed text-muted">
                        {revelado ? integracao.segredo : '••••••••••••••••••••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => alternarRevelado(integracao.id)}
                        aria-label={revelado ? 'Esconder segredo' : 'Revelar segredo'}
                        title={revelado ? 'Esconder segredo' : 'Revelar segredo'}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-fill text-faint transition hover:border-line-strong hover:bg-fill-hover hover:text-ink"
                      >
                        {revelado ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                      </button>
                      <CopyButton value={integracao.segredo} label="Copiar segredo" />
                    </div>

                    <div className="mt-2.5 flex items-center justify-end gap-2">
                      {confirmandoEsta ? (
                        <>
                          <span className="mr-auto text-[10.5px] text-muted">
                            O segredo atual deixa de funcionar.
                          </span>
                          <button
                            type="button"
                            onClick={() => setConfirmando(null)}
                            className="h-7 rounded-md border border-line px-2.5 text-[11px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => void rotacionar(integracao.id)}
                            disabled={rotacionando === integracao.id || removendo === integracao.id}
                            className="h-7 rounded-md bg-invert px-2.5 text-[11px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:cursor-wait disabled:opacity-60"
                          >
                            {rotacionando === integracao.id ? 'Rotacionando…' : 'Confirmar'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setConfirmando(integracao.id)}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
                          >
                            <RefreshIcon className="h-3 w-3" />
                            Rotacionar
                          </button>
                          <button
                            type="button"
                            onClick={() => void remover(integracao.id)}
                            disabled={removendo === integracao.id}
                            className="h-7 rounded-md border border-dashed border-line-strong px-2.5 text-[11px] font-medium text-muted transition hover:bg-fill hover:text-ink disabled:cursor-wait disabled:opacity-60"
                          >
                            {removendo === integracao.id ? 'Removendo…' : 'Remover'}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={adicionar} className="mt-4 flex items-start gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Novo marketplace</span>
              <input
                value={novoMarketplace}
                onChange={(event) => setNovoMarketplace(event.target.value)}
                placeholder="Novo marketplace (ex.: shopee)"
                className={FIELD_CLASS}
                maxLength={60}
              />
            </label>
            <button
              type="submit"
              disabled={adicionando}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-fill px-3 text-[12px] font-medium text-ink transition hover:border-line-strong hover:bg-fill-hover disabled:cursor-wait disabled:opacity-60"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {adicionando ? 'Criando…' : 'Adicionar'}
            </button>
          </form>
          {erroForm && (
            <p role="alert" className="mt-2 text-[11px] text-ink">
              {erroForm}
            </p>
          )}

          <details className="group mt-5 rounded-lg border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[11.5px] font-medium text-muted transition hover:text-ink">
              Como assinar cada requisição
              <span className="font-mono text-[10px] text-faint transition group-open:rotate-180">
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </span>
            </summary>
            <div className="border-t border-line-soft px-3 pb-3 pt-3">
              <p className="text-[11px] leading-relaxed text-muted">
                A assinatura é o HMAC-SHA256 de{' '}
                <span className="font-mono text-ink">timestamp + &quot;.&quot; + corpo bruto</span>,
                usando o segredo do marketplace. A tolerância é de 5 minutos e o cabeçalho{' '}
                <span className="font-mono text-ink">X-Pulso-Assinatura</span> aceita o prefixo{' '}
                <span className="font-mono text-ink">sha256=</span>.
              </p>
              <div className="relative mt-3">
                <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-3 pr-11 font-mono text-[10px] leading-relaxed text-muted">
                  {snippetAssinatura(loja.slug)}
                </pre>
                <CopyButton
                  value={snippetAssinatura(loja.slug)}
                  label="Copiar exemplo"
                  className="absolute right-2 top-2"
                />
              </div>
            </div>
          </details>

          <p className="mt-4 text-[10.5px] leading-relaxed text-faint">
            Ao rotacionar, atualize o segredo imediatamente no marketplace. Requisições com
            assinatura antiga passam a ser recusadas com HTTP 401.
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
