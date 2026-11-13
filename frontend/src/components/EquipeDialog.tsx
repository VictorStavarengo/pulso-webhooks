import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  atualizarUsuario,
  criarUsuario,
  expurgarAntigos,
  fetchUsuarios,
  type ExpurgoResposta,
  type Loja,
  type Papel,
  type UsuarioAdmin,
} from '../lib/api';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { formatDateTime, parseServerDate } from '../lib/format';
import {
  AlertTriangleIcon,
  CheckIcon,
  CloseIcon,
  PlusIcon,
  UsersIcon,
} from './icons';

interface EquipeDialogProps {
  aberto: boolean;
  onFechar: () => void;
  lojas: Loja[];
  lojaAtual: Loja;
}

const CAMPO_CLASS =
  'h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-[12px] text-ink placeholder:text-faint outline-none transition focus:border-line-strong focus:ring-2 focus:ring-ink/10';

const PAPEL_ROTULO: Record<Papel, string> = {
  admin: 'Administrador',
  operador: 'Operador',
};

export default function EquipeDialog({ aberto, onFechar, lojas, lojaAtual }: EquipeDialogProps) {
  useDialogBehavior(aberto, onFechar);

  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [salvandoId, setSalvandoId] = useState<number | null>(null);
  const [expurgando, setExpurgando] = useState(false);
  const [confirmarExpurgo, setConfirmarExpurgo] = useState(false);
  const [expurgo, setExpurgo] = useState<ExpurgoResposta | null>(null);
  const [novo, setNovo] = useState({
    nome: '',
    email: '',
    senha: '',
    papel: 'operador' as Papel,
    lojaIds: [lojaAtual.id] as number[],
  });

  useEffect(() => {
    if (!aberto) {
      return;
    }
    let ativo = true;
    const timer = window.setTimeout(() => {
      setCarregando(true);
      setErro(null);
      fetchUsuarios()
        .then((lista) => {
          if (ativo) {
            setUsuarios(lista);
          }
        })
        .catch((cause) => {
          if (ativo) {
            setErro(cause instanceof Error ? cause.message : 'Não foi possível carregar a equipe.');
          }
        })
        .finally(() => {
          if (ativo) {
            setCarregando(false);
          }
        });
    }, 0);

    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [aberto]);

  if (!aberto) {
    return null;
  }

  const nomesLojas = new Map(lojas.map((loja) => [loja.id, loja.nome]));

  function alternarLoja(lojaId: number) {
    setNovo((atual) => ({
      ...atual,
      lojaIds: atual.lojaIds.includes(lojaId)
        ? atual.lojaIds.filter((id) => id !== lojaId)
        : [...atual.lojaIds, lojaId],
    }));
  }

  async function criar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (novo.nome.trim().length < 2 || !novo.email.trim() || novo.senha.length < 8) {
      setErro('Informe nome, e-mail válido e senha com pelo menos 8 caracteres.');
      return;
    }
    if (novo.lojaIds.length === 0) {
      setErro('Selecione ao menos uma loja para a pessoa.');
      return;
    }
    setCriando(true);
    setErro(null);
    try {
      const criado = await criarUsuario({
        nome: novo.nome.trim(),
        email: novo.email.trim(),
        senha: novo.senha,
        papel: novo.papel,
        loja_ids: novo.lojaIds,
      });
      setUsuarios((atual) =>
        [...atual.filter((item) => item.id !== criado.id), criado].sort((a, b) =>
          a.nome.localeCompare(b.nome),
        ),
      );
      setNovo({ nome: '', email: '', senha: '', papel: 'operador', lojaIds: [lojaAtual.id] });
      setFormAberto(false);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível criar o usuário.');
    } finally {
      setCriando(false);
    }
  }

  async function alterar(usuarioId: number, dados: { papel?: Papel; ativo?: boolean }) {
    setSalvandoId(usuarioId);
    setErro(null);
    try {
      const atualizado = await atualizarUsuario(usuarioId, dados);
      setUsuarios((atual) =>
        atual.map((item) => (item.id === atualizado.id ? atualizado : item)),
      );
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível atualizar o usuário.');
    } finally {
      setSalvandoId(null);
    }
  }

  async function executarExpurgo() {
    if (!confirmarExpurgo) {
      setConfirmarExpurgo(true);
      return;
    }
    setExpurgando(true);
    setErro(null);
    setExpurgo(null);
    try {
      const resultado = await expurgarAntigos();
      setExpurgo(resultado);
      setConfirmarExpurgo(false);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : 'Não foi possível executar o expurgo.');
    } finally {
      setExpurgando(false);
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
        aria-labelledby="equipe-title"
        className="animate-rise panel-shadow relative max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-fill text-muted">
              <UsersIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                Administração
              </p>
              <h2 id="equipe-title" className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">
                Equipe e acessos
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
          {erro && (
            <p
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-line-strong bg-fill px-3 py-2.5 text-[11.5px] leading-relaxed text-ink"
            >
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {erro}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              Pessoas com acesso
            </p>
            <button
              type="button"
              onClick={() => setFormAberto((valor) => !valor)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {formAberto ? 'Fechar cadastro' : 'Adicionar pessoa'}
            </button>
          </div>

          {formAberto && (
            <form
              onSubmit={criar}
              className="mt-3 space-y-3 rounded-lg border border-line bg-surface-2 p-3.5"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                    Nome
                  </span>
                  <input
                    value={novo.nome}
                    onChange={(event) => setNovo((atual) => ({ ...atual, nome: event.target.value }))}
                    className={`mt-1 ${CAMPO_CLASS}`}
                    placeholder="Maria Silva"
                    maxLength={120}
                  />
                </label>
                <label className="block">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                    Papel
                  </span>
                  <select
                    value={novo.papel}
                    onChange={(event) =>
                      setNovo((atual) => ({ ...atual, papel: event.target.value as Papel }))
                    }
                    className={`mt-1 ${CAMPO_CLASS} appearance-none`}
                  >
                    <option value="operador" className="bg-surface text-ink">
                      Operador
                    </option>
                    <option value="admin" className="bg-surface text-ink">
                      Administrador
                    </option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  E-mail
                </span>
                <input
                  type="email"
                  value={novo.email}
                  onChange={(event) => setNovo((atual) => ({ ...atual, email: event.target.value }))}
                  className={`mt-1 ${CAMPO_CLASS}`}
                  placeholder="maria@loja.com"
                  maxLength={200}
                />
              </label>

              <label className="block">
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  Senha inicial
                </span>
                <input
                  type="password"
                  value={novo.senha}
                  onChange={(event) => setNovo((atual) => ({ ...atual, senha: event.target.value }))}
                  className={`mt-1 ${CAMPO_CLASS}`}
                  placeholder="mínimo de 8 caracteres"
                  autoComplete="new-password"
                  maxLength={200}
                />
              </label>

              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">
                  Lojas liberadas
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {lojas.map((loja) => {
                    const marcada = novo.lojaIds.includes(loja.id);
                    return (
                      <button
                        key={loja.id}
                        type="button"
                        onClick={() => alternarLoja(loja.id)}
                        aria-pressed={marcada}
                        className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition ${
                          marcada
                            ? 'border-transparent bg-invert text-invert-ink'
                            : 'border-line text-muted hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        {marcada && <CheckIcon className="h-3 w-3" />}
                        {loja.nome}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={criando}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-invert px-3.5 text-[12.5px] font-medium text-invert-ink transition hover:bg-invert/90 disabled:cursor-wait disabled:opacity-60"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  {criando ? 'Criando…' : 'Criar acesso'}
                </button>
              </div>
            </form>
          )}

          {carregando ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="skeleton h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {usuarios.map((usuario) => (
                <li
                  key={usuario.id}
                  className="rounded-lg border border-line bg-canvas px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink">
                        {usuario.nome}
                        {!usuario.ativo && (
                          <span className="ml-2 rounded border border-line px-1 py-0.5 text-[9px] uppercase tracking-wider text-faint">
                            inativo
                          </span>
                        )}
                        {usuario.totp_ativo && (
                          <span className="ml-1.5 rounded border border-line px-1 py-0.5 text-[9px] uppercase tracking-wider text-faint">
                            2FA
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
                        {usuario.email}
                      </p>
                      <p className="mt-1 text-[10.5px] text-muted">
                        {usuario.loja_ids
                          .map((id) => nomesLojas.get(id) ?? `Loja ${id}`)
                          .join(' · ') || 'Sem lojas'}
                      </p>
                      <p className="mt-1 text-[10px] text-faint">
                        desde {formatDateTime(parseServerDate(usuario.criado_em))}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <select
                        value={usuario.papel}
                        disabled={salvandoId === usuario.id}
                        onChange={(event) =>
                          alterar(usuario.id, { papel: event.target.value as Papel })
                        }
                        aria-label={`Papel de ${usuario.nome}`}
                        className="h-7 appearance-none rounded-md border border-line bg-surface px-1.5 text-[10.5px] text-ink outline-none focus:border-line-strong disabled:opacity-50"
                      >
                        <option value="operador" className="bg-surface text-ink">
                          Operador
                        </option>
                        <option value="admin" className="bg-surface text-ink">
                          Admin
                        </option>
                      </select>
                      <button
                        type="button"
                        disabled={salvandoId === usuario.id}
                        onClick={() => alterar(usuario.id, { ativo: !usuario.ativo })}
                        className="h-7 rounded-md border border-line px-2 text-[10.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-wait disabled:opacity-50"
                      >
                        {usuario.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-faint">
                    Papel atual: {PAPEL_ROTULO[usuario.papel]}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 border-t border-line-soft pt-5">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              Manutenção
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Remove webhooks e registros de envio mais antigos que o período de retenção
              configurado. A rotina também roda automaticamente todos os dias.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={executarExpurgo}
                disabled={expurgando}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition disabled:cursor-wait disabled:opacity-60 ${
                  confirmarExpurgo
                    ? 'border-line-strong bg-invert text-invert-ink hover:bg-invert/90'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                <AlertTriangleIcon className="h-3.5 w-3.5" />
                {expurgando
                  ? 'Expurgando…'
                  : confirmarExpurgo
                    ? 'Confirmar expurgo'
                    : 'Executar expurgo agora'}
              </button>
              {confirmarExpurgo && (
                <button
                  type="button"
                  onClick={() => setConfirmarExpurgo(false)}
                  className="h-8 rounded-lg px-2 text-[11px] text-muted transition hover:text-ink"
                >
                  Cancelar
                </button>
              )}
            </div>
            {expurgo && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink">
                <CheckIcon className="h-3.5 w-3.5" />
                {expurgo.logs_removidos} logs e {expurgo.envios_removidos} envios removidos
                (retenção de {expurgo.retencao_dias} dias).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
