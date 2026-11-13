import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Theme } from '../hooks/useTheme';
import ThemeToggle from './ThemeToggle';
import { AlertTriangleIcon, CheckIcon, KeyIcon, ShieldIcon, ZapIcon } from './icons';

interface LoginScreenProps {
  onEntrar: (email: string, senha: string) => Promise<boolean>;
  onConcluir2FA: (codigo: string) => Promise<boolean>;
  onCancelar2FA: () => void;
  entrando: boolean;
  concluindo2FA: boolean;
  desafio2FA: boolean;
  erro: string | null;
  theme: Theme;
  onToggleTheme: () => void;
}

const FIELD_CLASS =
  'h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink placeholder:text-faint outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10';

const RECURSOS = [
  'Pedidos de todas as lojas em um só painel',
  'Assinatura HMAC por marketplace',
  'Alertas de atraso, cancelamento e ticket alto',
];

export default function LoginScreen({
  onEntrar,
  onConcluir2FA,
  onCancelar2FA,
  entrando,
  concluindo2FA,
  desafio2FA,
  erro,
  theme,
  onToggleTheme,
}: LoginScreenProps) {
  const [email, setEmail] = useState(import.meta.env.DEV ? 'admin@pulso.local' : '');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !senha) {
      return;
    }
    await onEntrar(email.trim(), senha);
  }

  async function handleSubmit2FA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codigo.replace(/\s/g, '').length < 6) {
      return;
    }
    const concluido = await onConcluir2FA(codigo);
    if (!concluido) {
      setCodigo('');
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-canvas px-5 py-10 text-ink">
      <div aria-hidden="true" className="dot-grid pointer-events-none fixed inset-0 opacity-70" />
      <div aria-hidden="true" className="hero-glow pointer-events-none fixed inset-x-0 top-0 h-[520px]" />

      <div className="absolute right-5 top-5">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="relative grid w-full max-w-[960px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_392px]">
        <section className="animate-rise hidden lg:block">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-invert text-invert-ink">
              <ZapIcon className="h-[18px] w-[18px]" strokeWidth={2.1} />
            </span>
            <div className="leading-none">
              <p className="text-[14.5px] font-semibold tracking-[-0.02em] text-ink">Pulso</p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-faint">
                Commerce Ops
              </p>
            </div>
          </div>

          <h1 className="mt-8 max-w-md text-[38px] font-semibold leading-[1.05] tracking-[-0.045em] text-ink">
            O pulso das suas{' '}
            <span className="inline-block rounded-[3px] bg-invert px-2 py-[0.08em] text-invert-ink">
              vendas
            </span>
          </h1>
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
            Webhooks assinados, pedidos consolidados por loja e alertas operacionais em tempo real.
          </p>

          <ul className="mt-7 space-y-2.5">
            {RECURSOS.map((recurso) => (
              <li key={recurso} className="flex items-center gap-2.5 text-[12.5px] text-muted">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line">
                  <CheckIcon className="h-3 w-3 text-ink" />
                </span>
                {recurso}
              </li>
            ))}
          </ul>
        </section>

        <section className="animate-rise panel-shadow rounded-xl border border-line bg-surface p-6 sm:p-7">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-invert text-invert-ink">
              <ZapIcon className="h-4 w-4" strokeWidth={2.1} />
            </span>
            <p className="text-[14px] font-semibold tracking-[-0.02em] text-ink">Pulso</p>
          </div>

          <div className="mt-5 flex items-start gap-3 lg:mt-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted">
              {desafio2FA ? <ShieldIcon className="h-4 w-4" /> : <KeyIcon className="h-4 w-4" />}
            </span>
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
                {desafio2FA ? 'Verificação em duas etapas' : 'Entrar no painel'}
              </h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                {desafio2FA
                  ? 'Abra o app autenticador e informe o código de 6 dígitos da sua conta.'
                  : 'A sessão fica em um cookie seguro e dá acesso apenas às suas lojas.'}
              </p>
            </div>
          </div>

          {desafio2FA ? (
            <form onSubmit={handleSubmit2FA} className="mt-6">
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  Código do autenticador
                </span>
                <input
                  value={codigo}
                  onChange={(event) => setCodigo(event.target.value.replace(/[^\d\s]/g, ''))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={`mt-1.5 ${FIELD_CLASS} text-center font-mono text-[18px] tracking-[0.35em]`}
                  placeholder="000000"
                  maxLength={8}
                  autoFocus
                  required
                />
              </label>

              {erro && (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-line-strong bg-fill px-3 py-2.5 text-[11.5px] leading-relaxed text-ink"
                >
                  <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {erro}
                </p>
              )}

              <button
                type="submit"
                disabled={concluindo2FA}
                className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-invert text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-wait disabled:opacity-60"
              >
                {concluindo2FA ? 'Verificando…' : 'Confirmar código'}
              </button>

              <button
                type="button"
                onClick={onCancelar2FA}
                className="mt-3 h-9 w-full rounded-lg border border-line text-[12px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
              >
                Voltar ao login
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6">
              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  E-mail
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  className={`mt-1.5 ${FIELD_CLASS}`}
                  placeholder="voce@loja.com"
                  required
                  autoFocus
                />
              </label>

              <label className="mt-4 block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  Senha
                </span>
                <input
                  type="password"
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  autoComplete="current-password"
                  className={`mt-1.5 ${FIELD_CLASS}`}
                  placeholder="••••••••"
                  required
                />
              </label>

              {erro && (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-line-strong bg-fill px-3 py-2.5 text-[11.5px] leading-relaxed text-ink"
                >
                  <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {erro}
                </p>
              )}

              <button
                type="submit"
                disabled={entrando}
                className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-invert text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-wait disabled:opacity-60"
              >
                {entrando ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          )}

          {import.meta.env.DEV && !desafio2FA && (
            <p className="mt-5 border-t border-line-soft pt-4 text-center font-mono text-[10.5px] leading-relaxed text-faint">
              Ambiente local · admin@pulso.local / pulso123
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
