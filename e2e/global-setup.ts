import { request } from '@playwright/test';

const EVENTOS = [
  {
    origem: 'shopify',
    pedido_id: 'E2E-1001',
    status: 'PAGO',
    valor: 149.9,
    cliente_nome: 'Cliente E2E',
    evento_id: 'evt_e2e_1001',
  },
  {
    origem: 'shopify',
    pedido_id: 'E2E-1002',
    status: 'ENVIADO',
    valor: 320,
    cliente_nome: 'Cliente Enviado',
    evento_id: 'evt_e2e_1002',
  },
  {
    origem: 'shopify',
    pedido_id: 'E2E-1003',
    status: 'CANCELADO',
    valor: 89.9,
    cliente_nome: 'Cliente Cancelado',
    evento_id: 'evt_e2e_1003',
  },
  {
    origem: 'shopify',
    pedido_id: 'E2E-1004',
    status: 'PAGO',
    valor: 2500,
    cliente_nome: 'Cliente Valor Alto',
    evento_id: 'evt_e2e_1004',
  },
];

export default async function globalSetup() {
  const api = await request.newContext({ baseURL: 'http://127.0.0.1:8010' });

  const login = await api.post('/api/auth/login', {
    data: { email: 'admin@pulso.local', senha: 'pulso123' },
  });
  if (!login.ok()) {
    throw new Error(`login do seed falhou: ${login.status()} ${await login.text()}`);
  }

  const estado = await api.storageState();
  const csrf = estado.cookies.find((cookie) => cookie.name === 'pulso_csrf')?.value;
  if (!csrf) throw new Error('cookie CSRF ausente no seed');

  for (const evento of EVENTOS) {
    const resposta = await api.post('/api/simular-webhook', {
      headers: { 'X-Pulso-Csrf': csrf },
      data: evento,
    });
    if (!resposta.ok()) {
      throw new Error(`seed ${evento.pedido_id} falhou: ${resposta.status()} ${await resposta.text()}`);
    }
  }

  await api.dispose();
}
