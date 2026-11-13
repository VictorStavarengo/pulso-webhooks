import { expect, test } from '@playwright/test';

async function entrar(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Entrar no painel/i })).toBeVisible();
  await page.getByLabel(/e-mail/i).fill('admin@pulso.local');
  await page.getByLabel(/senha/i).fill('pulso123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Pedidos em tempo real/i })).toBeVisible();
}

function linhaDoPedido(page: import('@playwright/test').Page, pedido: string) {
  return page.getByRole('row').filter({ hasText: pedido });
}

test('login, lista de pedidos, detalhe e notificações', async ({ page }) => {
  await entrar(page);

  await expect(linhaDoPedido(page, 'E2E-1002')).toBeVisible();
  await expect(linhaDoPedido(page, 'E2E-1004')).toBeVisible();

  await linhaDoPedido(page, 'E2E-1001').click();
  await expect(page.getByText('Histórico de eventos')).toBeVisible();
  await expect(page.getByText('E2E-1001').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Histórico de eventos')).toBeHidden();

  await page.getByRole('button', { name: /notificações/i }).click();
  await expect(page.getByText('Pedido de valor alto').first()).toBeVisible();

  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fila de entrega' })).toBeVisible();
  await expect(page.getByText('Nenhuma entrega externa registrada ainda.')).toBeVisible();
});

test('pedido novo aparece em tempo real via SSE', async ({ page }) => {
  await entrar(page);
  await expect(linhaDoPedido(page, 'E2E-1002')).toBeVisible();
  await expect(page.getByText('Tempo real', { exact: true })).toBeVisible({ timeout: 15_000 });

  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'pulso_csrf')?.value;
  expect(csrf).toBeTruthy();

  const resposta = await page.request.post('/api/simular-webhook', {
    headers: { 'X-Pulso-Csrf': csrf! },
    data: {
      origem: 'shopify',
      pedido_id: 'E2E-1050',
      status: 'PAGO',
      valor: 199.9,
      cliente_nome: 'Cliente SSE',
      evento_id: 'evt_e2e_1050',
    },
  });
  expect(resposta.ok()).toBeTruthy();

  await expect(linhaDoPedido(page, 'E2E-1050')).toBeVisible({ timeout: 15_000 });
});
