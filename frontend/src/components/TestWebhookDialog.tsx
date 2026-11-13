import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { simularWebhook } from '../lib/api';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { CheckIcon, ChevronDownIcon, CloseIcon, SendIcon } from './icons';

interface TestWebhookDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

const STATUS_OPTIONS = [
  'PAGO',
  'APROVADO',
  'PREPARANDO_ENVIO',
  'ENVIADO',
  'ENTREGUE',
  'PENDENTE_PAGAMENTO',
  'CANCELADO',
];

const FIELD_CLASS =
  'h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink placeholder:text-faint outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10';

function nextPedidoId(): string {
  return `TESTE-${Math.floor(100000 + Math.random() * 900000)}`;
}

interface FieldProps {
  label: string;
  className?: string;
  children: ReactNode;
}

function Field({ label, className = '', children }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
        {label}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export default function TestWebhookDialog({ onClose, onCreated }: TestWebhookDialogProps) {
  useDialogBehavior(true, onClose);

  const [origem, setOrigem] = useState('shopify');
  const [pedidoId, setPedidoId] = useState(nextPedidoId);
  const [status, setStatus] = useState('PAGO');
  const [valor, setValor] = useState('199,90');
  const [cliente, setCliente] = useState('Ana Souza');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number.parseFloat(valor.replace(',', '.'));

    if (!origem.trim() || !pedidoId.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Informe origem, pedido e um valor maior que zero.');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const resposta = await simularWebhook({
        origem: origem.trim(),
        pedido_id: pedidoId.trim(),
        status,
        valor: parsed,
        cliente_nome: cliente.trim() || undefined,
        evento_id: `sim-${Date.now()}`,
      });
      setSent(true);
      setResumo(
        resposta.duplicado
          ? 'Este evento já havia sido processado.'
          : resposta.criado
            ? 'Pedido criado na loja ativa.'
            : 'Pedido existente atualizado.',
      );
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o webhook.');
    } finally {
      setIsSending(false);
    }
  }

  function resetForm() {
    setPedidoId(nextPedidoId());
    setSent(false);
    setResumo(null);
    setError(null);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="animate-fade absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-webhook-title"
        className="animate-rise panel-shadow relative max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              Simulador
            </p>
            <h2
              id="test-webhook-title"
              className="mt-1.5 text-[15px] font-semibold tracking-[-0.01em] text-ink"
            >
              {sent ? 'Webhook enviado' : 'Enviar pedido de teste'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar simulador"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="px-5 py-8 text-center" role="status">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-invert text-invert-ink">
              <CheckIcon className="h-5 w-5" />
            </span>
            <p className="mt-4 text-[13px] font-medium text-ink">Evento processado pelo backend</p>
            <p className="mx-auto mt-1.5 max-w-[290px] text-[11.5px] leading-relaxed text-muted">
              {resumo ?? 'O pedido já está gravado na base da API.'} O painel é atualizado na hora
              pelo stream em tempo real.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-5">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Origem">
                <input
                  value={origem}
                  onChange={(event) => setOrigem(event.target.value)}
                  className={FIELD_CLASS}
                  placeholder="shopify"
                  autoFocus
                />
              </Field>

              <Field label="Status">
                <span className="relative block">
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className={`${FIELD_CLASS} appearance-none pr-8`}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option} className="bg-surface text-ink">
                        {option}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                </span>
              </Field>

              <Field label="ID do pedido" className="sm:col-span-2">
                <input
                  value={pedidoId}
                  onChange={(event) => setPedidoId(event.target.value)}
                  className={FIELD_CLASS}
                  placeholder="TESTE-000000"
                />
              </Field>

              <Field label="Valor (R$)" className="sm:col-span-2">
                <input
                  value={valor}
                  onChange={(event) => setValor(event.target.value)}
                  inputMode="decimal"
                  className={FIELD_CLASS}
                  placeholder="199,90"
                />
              </Field>

              <Field label="Cliente (opcional)" className="sm:col-span-2">
                <input
                  value={cliente}
                  onChange={(event) => setCliente(event.target.value)}
                  className={FIELD_CLASS}
                  placeholder="Ana Souza"
                  maxLength={160}
                />
              </Field>
            </div>

            <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              Usa o endpoint autenticado{' '}
              <span className="font-mono text-ink">POST /api/simular-webhook</span> na loja ativa,
              sem precisar montar a assinatura HMAC. Se a origem ainda não existe, a integração é
              criada automaticamente.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-line-strong bg-fill px-3 py-2 text-[11.5px] text-ink"
              >
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg border border-line px-3.5 text-[12.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSending}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-wait disabled:opacity-60"
              >
                <SendIcon className={`h-3.5 w-3.5 ${isSending ? 'motion-safe:animate-pulse' : ''}`} />
                {isSending ? 'Enviando…' : 'Enviar webhook'}
              </button>
            </div>
          </form>
        )}

        {sent && (
          <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-4">
            <button
              type="button"
              onClick={resetForm}
              className="h-9 rounded-lg border border-line px-3.5 text-[12.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
            >
              Enviar outro
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
