import { useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { CloseIcon, PlusIcon } from './icons';

interface NovaLojaDialogProps {
  onCriar: (nome: string) => Promise<void>;
  onClose: () => void;
}

const FIELD_CLASS =
  'h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink placeholder:text-faint outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10';

export default function NovaLojaDialog({ onCriar, onClose }: NovaLojaDialogProps) {
  useDialogBehavior(true, onClose);

  const [nome, setNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nome.trim().length < 2) {
      setErro('Informe um nome com pelo menos 2 caracteres.');
      return;
    }

    setCriando(true);
    setErro(null);
    try {
      await onCriar(nome.trim());
      onClose();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível criar a loja.');
    } finally {
      setCriando(false);
    }
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
        aria-labelledby="nova-loja-title"
        className="animate-rise panel-shadow relative w-full max-w-[400px] overflow-hidden rounded-xl border border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Lojas</p>
            <h2 id="nova-loja-title" className="mt-1.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">
              Criar nova loja
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5">
          <label className="block">
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
              Nome da loja
            </span>
            <input
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              className={`mt-1.5 ${FIELD_CLASS}`}
              placeholder="Loja Centro"
              autoFocus
              maxLength={120}
            />
          </label>

          <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
            A loja nasce com um identificador próprio para os webhooks e configurações de alerta
            independentes. Você passa a ser o único usuário dela.
          </p>

          {erro && (
            <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-fill px-3 py-2 text-[11.5px] text-ink">
              {erro}
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
              disabled={criando}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:cursor-wait disabled:opacity-60"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {criando ? 'Criando…' : 'Criar loja'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
