import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, SERVER, NOW, iso, amt, bt, state0, conn, txs, idle } from './helpers.mjs';

const ING = { id: 'a_ing', name: 'ING', kind: 'banco', iban: '', aliases: ['ing'], track: 'auto' };
const TR = { id: 'a_tr', name: 'Trade Republic', kind: 'broker', iban: '', aliases: ['trade republic', 'traderepublic'], track: 'auto' };

test('el ejemplo en un iPhone: sin errores, sin desplazamiento lateral y campos de 16 px', async ({ page }) => {
  const { errors } = await openApp(page);
  for (const tab of ['inicio', 'movimientos', 'analisis', 'inversiones', 'ajustes']) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await expect(page.locator('#view-' + tab)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), tab).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() => [...document.querySelectorAll('input:not([type=file]), select, textarea')]
      .filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.outerHTML.slice(0, 80)));
    expect(small, tab).toEqual([]); // iOS zooms into anything smaller
  }
  await page.click('.tab[data-tab="movimientos"]');
  const row = await page.locator('.mv-row').first().boundingBox();
  expect(row.height).toBeLessThan(100); // concept and amount, then date and category
  expect(errors).toEqual([]);
});

test('importar un extracto sustituye el ejemplo, repetirlo no duplica y lo dudoso espera en «Por revisar»', async ({ page }) => {
  await openApp(page, { path: 'index.html#ajustes' });
  const csv = 'Fecha;Concepto;Importe;Saldo\n01/10/2026;TRANSFERENCIA RECIBIDA NOMINA ACME;2.000,00;2.500,00\n'
    + '02/10/2026;Pago en MERCADONA VALENCIA;-54,30;2.445,70\n03/10/2026;PAGO EN COSA RARISIMA;-9,99;2.435,71\n';
  const file = { name: 'ing-octubre.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };
  await page.setInputFiles('#file', file);
  await expect.poll(async () => (await txs(page)).length).toBe(3);
  expect(await page.evaluate(() => window.__cg.state().sample)).toBe(false);
  await page.setInputFiles('#file', file);
  await expect(page.locator('#files .file-row').first()).toContainText('3 repetidos ignorados');
  expect((await txs(page)).length).toBe(3);

  await page.click('.tab[data-tab="inicio"]');
  await expect(page.locator('#tabBadge')).toHaveText('1');
  await expect(page.locator('#reviewList')).toContainText('PAGO EN COSA RARISIMA');
  await page.locator('#reviewList select').selectOption('compras');
  await expect(page.locator('#reviewPanel')).toBeHidden();
  await expect(page.locator('#tabBadge')).toBeHidden();
  expect((await txs(page)).find((t) => t.concept === 'PAGO EN COSA RARISIMA').cat).toBe('compras');
});

test('Excel: se lee en segundo plano', async ({ page }) => {
  await openApp(page, { path: 'index.html#ajustes' });
  const bytes = await page.evaluate(async () => {
    await new Promise((ok) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = ok; document.head.appendChild(s); });
    const ws = window.XLSX.utils.aoa_to_sheet([['Fecha operación', 'Fecha valor', 'Concepto', 'Importe'], ['20/10/2026', '21/10/2026', 'COMPRA ZARA', -29.9], ['22/10/2026', '22/10/2026', 'NETFLIX.COM', -12.99]]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    return Array.from(new Uint8Array(window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
  });
  await page.setInputFiles('#file', { name: 'bankinter.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
  await expect.poll(async () => (await txs(page)).map((t) => [t.date, t.amount, t.cat])).toEqual([['2026-10-20', -29.9, 'compras'], ['2026-10-22', -12.99, 'suscripciones']]);
});

test('PDF de la tarjeta de diciembre a enero: cada movimiento en su año', async ({ page }) => {
  await openApp(page, { path: 'index.html#ajustes' });
  await page.setInputFiles('#file', 'tests/fixtures/tarjeta-dic-ene.pdf');
  await expect.poll(async () => (await txs(page)).length, { timeout: 15000 }).toBe(4);
  expect((await txs(page)).map((t) => [t.date, t.amount, t.cat]).sort()).toEqual([
    ['2025-12-16', -54.3, 'supermercado'], ['2025-12-28', -148.6, 'viajes'], ['2026-01-03', -12.99, 'suscripciones'], ['2026-01-10', -55, 'transporte'],
  ]);
});

test('un banco recién autorizado vuelve solo a la app y se descarga entero al momento', async ({ page }) => {
  const { calls, errors } = await openApp(page, {
    state: state0({ accounts: [ING] }),
    bank: { server: SERVER, token: 't', conns: [conn({ lastSync: iso(NOW - 5 * 60e3) })], // ING synced 5 minutes ago
      pendingAuth: { state: 'S1abcdefgh', aspsp: { name: 'Bankinter', country: 'ES' }, at: iso(NOW - 60e3), via: 'server', reconn: null } },
    mock: (u) => {
      if (u.pathname === '/claim') return { ok: true, aspsp: { name: 'Bankinter', country: 'ES' }, session: { session_id: 's1', access: { valid_until: iso(NOW + 180 * 864e5) }, accounts: [{ uid: 'bk1', name: 'Cuenta', identification_hash: 'h1', cash_account_type: 'CACC' }] } };
      if (u.pathname === '/transactions') return { transactions: [bt({ entry_reference: 'r1', booking_date: '2026-10-20', transaction_amount: amt('10.00'), remittance_information: ['COMPRA ZARA'] })] };
      if (u.pathname === '/ping') return { ok: true, version: 2, features: { kv: true, callback: true } };
      if (u.pathname === '/aspsps') return { aspsps: [] };
      return [404, { error: 'no' }];
    },
  });
  await idle(page);
  await expect.poll(async () => (await txs(page)).length).toBe(1);
  expect(calls.filter((c) => c.path === '/claim').map((c) => c.q.state)).toEqual(['S1abcdefgh']);
  expect(calls.filter((c) => c.path === '/transactions').map((c) => [c.q.account, c.q.strategy, c.q.psu])).toEqual([['bk1', 'longest', '1']]);
  const bank = await page.evaluate(() => window.__cg.bank());
  expect(bank.pendingAuth).toBeNull();
  expect(bank.conns.map((c) => [c.aspsp.name, c.firstDone])).toEqual([['ING', true], ['Bankinter', true]]);
  expect((await page.evaluate(() => window.__cg.state().accounts)).map((a) => a.name)).toEqual(['ING', 'Bankinter · Cuenta']);
  await expect(page.locator('#notices')).not.toContainText('Esperando la autorización');
  expect(errors).toEqual([]);
});

test('vuelta del banco a la dirección de la app con ?code=: se completa y la dirección queda limpia', async ({ page }) => {
  const { calls } = await openApp(page, {
    path: 'index.html?code=C1&state=S2abcdefgh',
    state: state0(),
    bank: { server: SERVER, token: 't', conns: [], pendingAuth: { state: 'S2abcdefgh', aspsp: { name: 'ING', country: 'ES' }, at: iso(NOW - 60e3), via: 'app', reconn: null } },
    mock: (u) => {
      if (u.pathname === '/session') return { session_id: 's1', access: { valid_until: iso(NOW + 90 * 864e5) }, accounts: [{ uid: 'ing1', account_id: { iban: 'ES9121000418450200051332' } }] };
      if (u.pathname === '/transactions') return { transactions: [] };
      return { aspsps: [], features: { kv: false, callback: false } };
    },
  });
  await idle(page);
  expect(calls.find((c) => c.path === '/session').body).toEqual({ code: 'C1' });
  expect(page.url()).not.toContain('code=');
  expect((await page.evaluate(() => window.__cg.bank())).conns).toHaveLength(1);
});

test('de ING a Trade Republic con los dos bancos conectados: ni gasto ni ingreso, y el plan cuenta como inversión', async ({ page }) => {
  await openApp(page, {
    state: state0({ accounts: [ING, TR] }),
    bank: { server: SERVER, token: 't', conns: [conn(), conn({ id: 'c_tr', aspsp: { name: 'Trade Republic', country: 'DE' }, accounts: [{ uid: 'tr1', acctId: 'a_tr', name: '' }] })] },
    mock: (u) => {
      if (u.pathname !== '/transactions') return { aspsps: [], features: {} };
      return u.searchParams.get('account') === 'ing1'
        ? { transactions: [bt({ entry_reference: 'i1', booking_date: '2026-10-22', transaction_amount: amt('300.00'), creditor: { name: 'Trade Republic Bank GmbH' }, remittance_information: ['Transferencia emitida'] })] }
        : { transactions: [
          bt({ entry_reference: 't1', booking_date: '2026-10-22', credit_debit_indicator: 'CRDT', transaction_amount: amt('300.00'), debtor: { name: 'AARON' }, remittance_information: ['Ingreso'] }),
          bt({ entry_reference: 't2', booking_date: '2026-10-23', transaction_amount: amt('150.00'), remittance_information: ['Savings plan execution IE00B4L5Y983'] }),
        ] };
    },
  });
  await idle(page);
  await expect.poll(async () => (await txs(page)).map((t) => t.cat)).toEqual(['excluir', 'excluir', 'inversion']);
  const kpis = page.locator('#homeKpis');
  await expect(kpis).toContainText('150 € invertidos');
  await expect(kpis.locator('.kpi').nth(1)).toContainText('0,00 €'); // expenses
});

test('sin referencia del banco, sincronizar otra vez no duplica; tras «demasiadas consultas» la app espera', async ({ page }) => {
  let n = 0, limit = false;
  const { calls } = await openApp(page, {
    state: state0({ accounts: [ING] }),
    bank: { server: SERVER, token: 't', conns: [conn()] },
    mock: (u) => {
      if (u.pathname !== '/transactions') return { aspsps: [], features: {} };
      if (limit) return [429, { error: 'Demasiadas consultas', code: 'ASPSP_RATE_LIMIT_EXCEEDED' }];
      n++;
      return { transactions: [
        bt({ transaction_id: 'tid-' + n + '-a', booking_date: '2026-10-24', transaction_amount: amt('3.20'), remittance_information: ['CAFE CENTRAL'] }),
        bt({ transaction_id: 'tid-' + n + '-b', booking_date: '2026-10-24', transaction_amount: amt('54.30'), remittance_information: ['MERCADONA VALENCIA'] }),
      ] };
    },
  });
  await idle(page);
  await expect.poll(async () => (await txs(page)).length).toBe(2); // automatic sync on opening
  await page.click('#syncBtn');
  await idle(page);
  expect(n).toBe(2);
  expect((await txs(page)).length).toBe(2);

  limit = true;
  await page.click('#syncBtn');
  await idle(page);
  const before = calls.length;
  await page.click('#syncBtn');
  await idle(page);
  expect(calls.length).toBe(before); // paused for 6 hours
  await page.click('.tab[data-tab="ajustes"]');
  await expect(page.locator('#bankStatus')).toContainText('6 horas');
});

test('borrar todos los datos hace que la siguiente sincronización traiga de nuevo el historial', async ({ page }) => {
  const { calls } = await openApp(page, {
    path: 'index.html#ajustes',
    state: state0({ accounts: [ING], tx: [{ id: 'a', date: '2026-01-10', concept: 'X', amount: -10, cat: 'otros_g', src: 'ING', ext: 'eb:a_ing:r:1', acct: 'a_ing' }] }),
    bank: { server: SERVER, token: 't', conns: [conn({ lastSync: iso(NOW - 60e3) })] },
    mock: (u) => (u.pathname === '/transactions' ? { transactions: [bt({ entry_reference: '1', booking_date: '2026-01-10', transaction_amount: amt('10'), remittance_information: ['X'] })] } : { aspsps: [], features: {} }),
  });
  await page.click('#resetBtn');
  await page.click('#resetYes');
  expect((await txs(page)).length).toBe(0);
  await page.click('#syncBtn');
  await idle(page);
  expect(calls.filter((c) => c.path === '/transactions').map((c) => c.q.strategy)).toEqual(['longest']);
  expect((await txs(page)).length).toBe(1);
});

test('copia de seguridad: exportar sin la clave, borrar todo y restaurar', async ({ page }) => {
  const tx = [['2026-10-01', 'NOMINA', 2000], ['2026-10-02', 'Pago en MERCADONA', -40], ['2026-10-03', 'Pago en ZARA', -30]]
    .map(([date, concept, amount], i) => ({ id: 'x' + i, date, concept, amount, cat: null }));
  await openApp(page, { path: 'index.html#ajustes', state: state0({ tx }), bank: { server: SERVER, token: 'TOKEN-SECRETO', conns: [] } });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const file = await dl.path();
  const json = readFileSync(file, 'utf8');
  expect(JSON.parse(json).app).toBe('cuaderno-gastos');
  expect(json).not.toContain('TOKEN-SECRETO');
  expect(dl.suggestedFilename()).toBe('cuaderno-gastos-2026-10-27.json');

  await page.click('#resetBtn');
  await page.click('#resetYes');
  expect((await txs(page)).length).toBe(0);
  await page.setInputFiles('#restoreFile', file);
  await expect(page.locator('#restoreBox')).toContainText('3 movimientos');
  await page.click('#restoreYes');
  expect((await txs(page)).map((t) => t.concept)).toEqual(['NOMINA', 'Pago en MERCADONA', 'Pago en ZARA']);
});

test.describe('sin conexión', () => {
  test.use({ serviceWorkers: 'allow' });
  test('después de la primera visita la app abre sin internet', async ({ page, context }) => {
    await page.goto('index.html');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#homeKpis .kpi').first()).toBeVisible();
    await page.click('.tab[data-tab="ajustes"]');
    await expect(page.locator('#appVersion')).toContainText('Versión');
  });
});
