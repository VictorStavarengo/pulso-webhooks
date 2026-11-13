import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ativar2FA, desativar2FA, iniciar2FA, type TotpInicio, type Usuario } from '../lib/api';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import CopyButton from './CopyButton';
import { AlertTriangleIcon, CheckIcon, CloseIcon, ShieldIcon } from './icons';

interface SegurancaDialogProps {
  aberto: boolean;
  onFechar: () => void;
  usuario: Usuario;
  onAtualizado: () => Promise<void>;
}

const CAMPO_CLASS =
  'mt-1.5 h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-[12.5px] text-ink outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10';

export default function SegurancaDialog({
  aberto,
  onFechar,
  usuario,
  onAtualizado,
}: SegurancaDialogProps) {
  useDialogBehavior(aberto, onFechar);

  const [inicio, setInicio] = useState<TotpInicio | null>(null);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<'ativado' | 'desativado' | null>(null);

  if (!aberto) {
    return null;
  }

  const ativo = concluido === 'ativado' || (usuario.totp_ativo && concluido !== 'desativado');

  async function iniciar() {
    setOcupado(true);
    setErro(null);
    try {
      const dados = await iniciar2FA();
      setInicio(dados);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível iniciar a configuração.');
    } finally {
      setOcupado(false);
    }
  }

  async function ativar() {
    setOcupado(true);
    setErro(null);
    try {
      await ativar2FA(codigo);
      setConcluido('ativado');
      setInicio(null);
      setCodigo('');
      await onAtualizado();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Código inválido. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  async function desativar() {
    setOcupado(true);
    setErro(null);
    try {
      await desativar2FA(senha);
      setConcluido('desativado');
      setSenha('');
      await onAtualizado();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível desativar a verificação.');
    } finally {
      setOcupado(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="animate-fade absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onFechar}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seguranca-title"
        className="animate-rise panel-shadow relative max-h-[92vh] w-full max-w-[440px] overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted">
              <ShieldIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                Segurança
              </p>
              <h2 id="seguranca-title" className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">
                Verificação em duas etapas
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted transition hover:border-line-strong hover:bg-fill-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink">{usuario.email}</p>
              <p className="mt-0.5 text-[10.5px] text-muted">
                {ativo ? '2FA ativa neste dispositivo de autenticação' : 'Proteção adicional desativada'}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.14em] ${
                ativo ? 'border-transparent bg-invert text-invert-ink' : 'border-line text-muted'
              }`}
            >
              {ativo ? 'Ativa' : 'Inativa'}
            </span>
          </div>

          {concluido === 'ativado' && (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-line-strong bg-fill px-3 py-2.5 text-[11.5px] text-ink">
              <CheckIcon className="h-4 w-4 shrink-0" />
              Verificação ativada. No próximo login será pedido o código do autenticador.
            </p>
          )}
          {concluido === 'desativado' && (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[11.5px] text-ink">
              <CheckIcon className="h-4 w-4 shrink-0" />
              Verificação desativada. O login volta a pedir apenas e-mail e senha.
            </p>
          )}

          {erro && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-line-strong bg-fill px-3 py-2.5 text-[11.5px] leading-relaxed text-ink"
            >
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {erro}
            </p>
          )}

          {ativo ? (
            <div className="mt-5">
              <p className="text-[11.5px] leading-relaxed text-muted">
                Para desativar, confirme a senha da sua conta. Você pode reativar quando quiser com
                um novo autenticador.
              </p>
              <label className="mt-4 block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  Senha atual
                </span>
                <input
                  type="password"
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  autoComplete="current-password"
                  className={CAMPO_CLASS}
                  placeholder="••••••••"
                />
              </label>
              <button
                type="button"
                onClick={desativar}
                disabled={ocupado || senha.length === 0}
                className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg border border-line-strong bg-fill text-[12.5px] font-medium text-ink transition hover:bg-fill-hover disabled:cursor-wait disabled:opacity-50"
              >
                {ocupado ? 'Desativando…' : 'Desativar verificação'}
              </button>
            </div>
          ) : inicio ? (
            <div className="mt-5">
              <p className="text-[11.5px] leading-relaxed text-muted">
                Escaneie o código no seu autenticador (Google Authenticator, 1Password, Authy) e
                informe o código gerado.
              </p>

              <div className="mt-4 flex items-center gap-4">
                <div
                  className="grid h-[132px] w-[132px] shrink-0 place-items-center rounded-lg border border-line bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: inicio.qr_svg }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                    Chave manual
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ink">
                    {inicio.segredo}
                  </p>
                  <div className="mt-2">
                    <CopyButton value={inicio.segredo} label="Copiar chave" />
                  </div>
                </div>
              </div>

              <label className="mt-4 block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  Código de 6 dígitos
                </span>
                <input
                  value={codigo}
                  onChange={(event) => setCodigo(event.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={`${CAMPO_CLASS} text-center font-mono text-[16px] tracking-[0.3em]`}
                  placeholder="000000"
                />
              </label>

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInicio(null);
                    setCodigo('');
                    setErro(null);
                  }}
                  className="h-9 flex-1 rounded-lg border border-line text-[12px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={ativar}
                  disabled={ocupado || codigo.length < 6}
                  className="h-9 flex-1 rounded-lg bg-invert text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:cursor-wait disabled:opacity-60"
                >
                  {ocupado ? 'Ativando…' : 'Ativar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <p className="text-[11.5px] leading-relaxed text-muted">
                Adicione uma camada extra de proteção ao login. Além da senha, será solicitado um
                código temporário gerado pelo aplicativo autenticador.
              </p>
              <button
                type="button"
                onClick={iniciar}
                disabled={ocupado}
                className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-invert text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:cursor-wait disabled:opacity-60"
              >
                <ShieldIcon className="h-3.5 w-3.5" />
                {ocupado ? 'Preparando…' : 'Configurar autenticador'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
