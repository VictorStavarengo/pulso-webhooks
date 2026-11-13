import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const painel = path.join(raiz, 'frontend');

function resolverNpm() {
  const base = path.dirname(process.execPath);
  const candidatos = [
    path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    process.env.npm_config_prefix
      ? path.join(process.env.npm_config_prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : null,
  ].filter(Boolean);
  const cli = candidatos.find((caminho) => existsSync(caminho));
  if (cli) {
    return { comando: process.execPath, argumentos: [cli], shell: false };
  }
  return {
    comando: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    argumentos: [],
    shell: process.platform === 'win32',
  };
}

const npm = resolverNpm();
const compilar = spawnSync(npm.comando, [...npm.argumentos, 'run', 'build'], {
  cwd: painel,
  stdio: 'inherit',
  shell: npm.shell,
});
if (compilar.status !== 0) {
  console.error('E2E: falha ao compilar o painel');
  process.exit(compilar.status ?? 1);
}

const banco = path.join(raiz, 'e2e', 'e2e-pulso.db');
const segredo = path.join(raiz, 'e2e', 'e2e-sessao.txt');
for (const arquivo of [banco, `${banco}-wal`, `${banco}-shm`, segredo]) {
  rmSync(arquivo, { force: true });
}

const candidatos = [
  path.join(raiz, '.venv', 'Scripts', 'python.exe'),
  path.join(raiz, '.venv', 'bin', 'python'),
  process.env.PULSO_PYTHON,
].filter(Boolean);
const python = candidatos.find((caminho) => caminho.includes(path.sep) && existsSync(caminho)) ?? 'python';

const servidor = spawn(
  python,
  ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8010', '--log-level', 'warning'],
  {
    cwd: raiz,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:///${banco.split(path.sep).join('/')}`,
      PULSO_SERVIR_FRONTEND: '1',
      PULSO_SESSAO_ARQUIVO: segredo,
      SESSION_SECRET: 'segredo-exclusivo-do-e2e',
      PULSO_ALERTAS_EXTERNAS: '0',
      PULSO_BACKUP: '0',
      PULSO_RETENCAO_DIAS: '0',
      PULSO_RATE_LIMIT_LOGIN: '1000',
      PULSO_RATE_LIMIT_WEBHOOK: '100000',
    },
  },
);

const encerrar = () => {
  if (!servidor.killed) servidor.kill();
};
process.on('SIGINT', () => {
  encerrar();
  process.exit(0);
});
process.on('SIGTERM', () => {
  encerrar();
  process.exit(0);
});
servidor.on('exit', (codigo) => process.exit(codigo ?? 0));
