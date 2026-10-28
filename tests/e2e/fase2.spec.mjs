import { test, expect } from '@playwright/test';
import { openApp, SERVER, NOW, iso, state0, txs } from './helpers.mjs';

const PING = { ok: true, version: 3, eb: true, features: { kv: true, callback: true, balances: true, backup: true, push: true, quoteCache: true }, cron: null };
const tx3 = () => [['2026-10-01', 'NOMINA ACME', 2000], ['2026-10-02', 'COMPRA TARJ. 4512 MERCADONA', -40], ['2026-10-03', 'COMPRA TARJ. 4512 AMAZON.ES', -30]]
  .map(([date, concept, amount], i) => ({ id: 'x' + i, date, concept, amount, cat: null }));

// A server that keeps the encrypted copy like servidor/worker.js does.
function vaultServer() {
  const srv = { copy: null, puts: 0 };
  srv.mock = (u, req) => {
    if (u.pathname === '/ping') return PING;
    if (u.pathname === '/aspsps') return { aspsps: [] };
    if (u.pathname === '/backup' && req.method() === 'PUT') { srv.copy = req.postDataJSON(); srv.puts++; return { ok: true, at: srv.copy.at, size: req.postData().length }; }
    if (u.pathname === '/backup') return srv.copy || [404, { error: 'Todavía no hay ninguna copia en el servidor.' }];
    return [404, { error: 'Ruta desconocida.' }];
  };
  return srv;
}

test('copia cifrada: se guarda sin que el servidor pueda leerla, se recupera aquí y en un iPhone nuevo, y se repite cada día', async ({ page, browser }) => {
  const srv = vaultServer(), bank = { server: SERVER, token: 'TOKEN-SECRETO', conns: [] };
  const { errors } = await openApp(page, { path: 'index.html#ajustes', state: state0({ tx: tx3() }), bank, mock: srv.mock });
  await page.fill('#vaultPass', 'corta');
  await page.fill('#vaultPass2', 'corta');
  await page.click('#vaultForm [type=submit]');
  await expect(page.locator('#vaultMsg')).toContainText('al menos 10 caracteres');
  await page.fill('#vaultPass', 'pimiento tranvía nublado');
  await page.fill('#vaultPass2', 'pimiento tranvía nublado');
  await page.click('#vaultForm [type=submit]');
  await expect(page.locator('#vaultMsg')).toContainText('Copia cifrada guardada', { timeout: 15000 });
  expect(srv.copy.app).toBe('cuaderno-gastos-cifrada');
  const raw = JSON.stringify(srv.copy);
  for (const secret of ['MERCADONA', 'NOMINA', 'TOKEN-SECRETO']) expect(raw).not.toContain(secret);
  await expect(page.locator('#vaultBody')).toContainText('Última copia en el servidor: 27/10, 10:00');
  await expect(page.locator('#lastBackup')).toContainText('27/10, 10:00');

  // Same iPhone: the key is kept here, so no passphrase
  await page.click('#resetBtn');
  await page.click('#resetYes');
  expect((await txs(page)).length).toBe(0);
  await page.click('#vaultGet');
  await expect(page.locator('#restoreBox')).toContainText('3 movimientos');
  await page.click('#restoreYes');
  expect((await txs(page)).map((t) => t.concept)).toEqual(['NOMINA ACME', 'COMPRA TARJ. 4512 MERCADONA', 'COMPRA TARJ. 4512 AMAZON.ES']);

  // The next day, opening the app saves a new copy by itself
  await page.evaluate((day) => {
    const b = window.__cg.bank();
    b.vault.last = new Date(day).toISOString();
    localStorage.setItem('cuaderno-gastos-banco', JSON.stringify(b));
  }, NOW - 2 * 864e5);
  await page.reload();
  await page.evaluate(() => window.__cg.ready);
  await expect.poll(() => srv.puts).toBe(2);
  expect(errors).toEqual([]);

  // A new iPhone with only the server's address and key: the passphrase opens the copy
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block', baseURL: test.info().project.use.baseURL });
  const p2 = await ctx2.newPage();
  await openApp(p2, { path: 'index.html#ajustes', state: state0(), bank, mock: srv.mock });
  await p2.click('#vaultGet');
  await p2.fill('#vaultOpenPass', 'pimiento tranvía nublado.');
  await p2.click('#vaultOpen [type=submit]');
  await expect(p2.locator('#vaultMsg')).toContainText('La frase no es la correcta', { timeout: 15000 });
  await p2.fill('#vaultOpenPass', 'pimiento tranvía nublado');
  await p2.click('#vaultOpen [type=submit]');
  await expect(p2.locator('#restoreBox')).toContainText('3 movimientos', { timeout: 15000 });
  await p2.click('#restoreYes');
  expect((await txs(p2)).length).toBe(3);
  await expect(p2.locator('#vaultAuto')).toBeChecked();
  await ctx2.close();
});

test('copia cifrada: un iPhone sin datos no sustituye la copia buena', async ({ page }) => {
  const srv = vaultServer();
  await openApp(page, { path: 'index.html#ajustes', state: state0(), bank: { server: SERVER, token: 'T', conns: [] }, mock: srv.mock });
  await page.fill('#vaultPass', 'pimiento tranvía nublado');
  await page.fill('#vaultPass2', 'pimiento tranvía nublado');
  await page.click('#vaultForm [type=submit]');
  await expect(page.locator('#vaultMsg')).toContainText('todavía no tiene datos');
  expect(srv.puts).toBe(0);
});

test('editor de reglas: condiciones, vista previa de lo que cambia y deshacer', async ({ page }) => {
  const tx = [-36, -12, -89].map((amount, i) => ({ id: 'a' + i, date: '2026-10-0' + (i + 1), concept: 'COMPRA TARJ. 4512 AMAZON.ES AMZN MKTP', amount, cat: 'compras' }));
  const { errors } = await openApp(page, { path: 'index.html#ajustes', state: state0({ tx }) });
  const cats = () => page.evaluate(() => window.__cg.state().tx.map((t) => t.cat));
  expect(await cats()).toEqual(['compras', 'compras', 'compras']);
  await page.click('#ruleNew');
  await page.fill('#ruKw', 'Amazon');
  await page.selectOption('#ruCat', 'ocio');
  await expect(page.locator('#rulePreview')).toContainText('3 movimientos encajan; 3 cambiarían de categoría');
  await page.fill('#ruMin', '20');
  await expect(page.locator('#rulePreview')).toContainText('2 movimientos encajan; 2 cambiarían');
  await page.fill('#ruMax', '10');
  await expect(page.locator('#rulePreview')).toContainText('«Desde» es mayor que «Hasta»');
  await page.fill('#ruMax', '');
  await page.click('#ruSave');
  expect(await cats()).toEqual(['ocio', 'compras', 'ocio']);
  await expect(page.locator('#rules')).toContainText('«amazon» → Ocio y deporte (desde 20,00 €)');
  await expect(page.locator('#toast')).toContainText('2 movimientos cambiados');
  await page.click('#toast button');
  expect(await cats()).toEqual(['compras', 'compras', 'compras']);

  // Editing keeps its place in the list
  await page.click('#ruleNew');
  await page.fill('#ruKw', 'amazon');
  await page.selectOption('#ruCat', 'ocio');
  await page.click('#ruSave');
  await page.click('[data-editrule="0"]');
  await expect(page.locator('#ruleTitle')).toHaveText('Editar regla');
  await page.selectOption('#ruSign', 'ingreso');
  await expect(page.locator('#rulePreview')).toContainText('Ahora no encaja con ningún movimiento');
  await page.click('#ruSave');
  expect(await page.evaluate(() => window.__cg.state().rules)).toEqual([{ kw: 'amazon', cat: 'ocio', sign: 'ingreso' }]);
  expect(await cats()).toEqual(['compras', 'compras', 'compras']);
  expect(errors).toEqual([]);
});

// WebAuthn needs a name, not an IP: this test opens the app at localhost with a virtual Face ID.
test('bloqueo con Face ID: pide la llave al abrir, y el código de recuperación sirve si falla', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const url = test.info().project.use.baseURL.replace('127.0.0.1', 'localhost');
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { window.lockedAtStart = document.documentElement.classList.contains('locked'); }));
  const { errors } = await openApp(page, { path: url + 'index.html#ajustes', state: state0({ tx: tx3() }) });
  const locked = () => page.evaluate(() => document.documentElement.classList.contains('locked'));
  await page.click('#lockOn');
  await expect(page.locator('#lockBody')).toContainText('Tu código de recuperación es');
  const code = (await page.locator('#lockBody strong').textContent()).trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.click('#lockCodeDone');
  await expect(page.locator('#lockBody')).toContainText('Activado');

  // Opening the app again: hidden until Face ID
  await page.reload();
  expect(await page.evaluate(() => window.lockedAtStart)).toBe(true);
  await expect.poll(locked).toBe(false); // the virtual Face ID answers by itself
  await expect(page.locator('.wrap')).toBeVisible();

  // Face ID fails (e.g. the passkey was deleted): the recovery code still gets you in
  await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
  await page.reload();
  await expect(page.locator('#lockScreen')).toBeVisible();
  await page.click('#lockBtn');
  await expect(page.locator('#lockMsg')).not.toBeEmpty();
  expect(await locked()).toBe(true);
  await page.click('#lockAlt summary');
  await page.fill('#lockCode', 'AAAA-BBBB-CCCC');
  await page.click('#lockCodeForm [type=submit]');
  await expect(page.locator('#lockMsg')).toContainText('no es el correcto');
  await page.fill('#lockCode', code.toLowerCase().replace(/-/g, ' '));
  await page.click('#lockCodeForm [type=submit]');
  await expect.poll(locked).toBe(false);
  await page.click('#lockOff');
  await page.reload();
  expect(await locked()).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('avisos en el iPhone', () => {
  test.use({ serviceWorkers: 'allow' });
  test('activarlos manda al servidor la suscripción y lo justo; cambiar las preferencias lo actualiza', async ({ page }) => {
    // The push service and the permission prompt are out of reach in a headless browser: a fake subscription, already allowed
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
      Notification.requestPermission = async () => 'granted';
      let current = null;
      const fake = { endpoint: 'https://web.push.apple.com/QGx1', options: {}, toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }; }, unsubscribe: async () => { current = null; return true; } };
      PushManager.prototype.subscribe = async function (o) { fake.options = o; current = fake; return fake; };
      PushManager.prototype.getSubscription = async function () { return current; };
    });
    const bodies = [];
    const mock = (u, req) => {
      if (u.pathname === '/ping') return { ...PING, cron: iso(NOW - 3 * 3600e3) };
      if (u.pathname === '/aspsps') return { aspsps: [] };
      if (u.pathname === '/push/key') return { key: 'B' + 'A'.repeat(86) };
      if (u.pathname.startsWith('/push/')) { bodies.push([u.pathname, req.postDataJSON()]); return { ok: true, id: 'f'.repeat(32) }; }
      return [404, { error: 'Ruta desconocida.' }];
    };
    const cat = { x0: 'nomina', x1: 'supermercado', x2: 'compras' };
    const state = state0({ tx: tx3().map((t) => ({ ...t, cat: cat[t.id] })), budgets: { supermercado: 300 } });
    const { errors } = await openApp(page, { path: 'index.html#ajustes', state, bank: { server: SERVER, token: 'T', conns: [] }, mock });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect(page.locator('#pushBody')).toContainText('puede avisarte de');
    const small = await page.evaluate(() => [...document.querySelectorAll('#pushBody input[type=text]')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length);
    expect(small).toBe(0);
    await page.click('#pushOn');
    await expect(page.locator('#pushBody')).toContainText('Activados');
    await expect(page.locator('#pushBody')).toContainText('Último repaso del servidor: 27/10, 07:00');
    const [path, body] = bodies[0];
    expect(path).toBe('/push/subscribe');
    expect(body.sub.endpoint).toBe('https://web.push.apple.com/QGx1');
    expect(body.prefs).toEqual({ big: 100, budget: true, expiry: true });
    expect(body.watch.cats.map((c) => [c.id, c.left])).toEqual([['supermercado', 260]]);
    expect(body.known.map((k) => k.a)).toEqual([]); // nothing in the last 5 days
    expect(JSON.stringify(body)).not.toContain('NOMINA');

    await page.fill('#puBig', '250');
    await page.locator('#puBig').blur();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1][1].prefs.big).toBe(250);
    await page.click('#pushTest');
    await expect(page.locator('#pushMsg')).toContainText('Enviado');
    expect(bodies[2]).toEqual(['/push/test', { id: 'f'.repeat(32) }]);
    await page.click('#pushOff');
    await expect(page.locator('#pushOn')).toBeVisible();
    expect(bodies[3][0]).toBe('/push/unsubscribe');
    expect(errors).toEqual([]);
  });
});

test('presupuestos: la propuesta sale de tu media, se guarda y en Inicio se ve cómo vas', async ({ page }) => {
  const tx = [];
  for (const m of ['2026-07', '2026-08', '2026-09']) {
    tx.push({ id: 'r' + m, date: m + '-05', concept: 'COMPRA TARJ. 4512 RESTAURANTE LA PEPICA', amount: -150, cat: 'restaurantes' });
    tx.push({ id: 's' + m, date: m + '-09', concept: 'COMPRA TARJ. 4512 MERCADONA', amount: -301, cat: 'supermercado' });
  }
  tx.push({ id: 'r10', date: '2026-10-04', concept: 'COMPRA TARJ. 4512 RESTAURANTE LA PEPICA', amount: -175, cat: 'restaurantes' });
  tx.push({ id: 's10', date: '2026-10-08', concept: 'COMPRA TARJ. 4512 MERCADONA', amount: -120, cat: 'supermercado' });
  const { errors } = await openApp(page, { state: state0({ tx }) });
  await expect(page.locator('#budgetPanel')).toBeVisible();
  await page.click('[data-bud="propose"]');
  await expect(page).toHaveURL(/#ajustes$/);
  const field = (cat) => page.locator(`[data-budcat="${cat}"]`);
  await expect(field('restaurantes')).toHaveValue('150');
  await expect(field('supermercado')).toHaveValue('310');
  await field('restaurantes').fill('160');
  await page.click('#budgetForm [type=submit]');
  expect(await page.evaluate(() => window.__cg.state().budgets)).toEqual({ restaurantes: 160, supermercado: 310 });

  await page.click('.tab[data-tab="inicio"]');
  const rows = page.locator('#budgetList li.bud');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-st', 'over');
  await expect(rows.nth(0)).toContainText(/Te has pasado 15,00\s€/);
  await expect(rows.nth(1)).toHaveAttribute('data-st', 'ok');
  await expect(rows.nth(1)).toContainText(/Te quedan 190,00\s€/);
  await rows.nth(0).click();
  await expect(page).toHaveURL(/#movimientos$/);
  expect(errors).toEqual([]);
});

test('inversiones: el valor neto descuenta la custodia de Renta 4 y la venta en Trade Republic; el TER se ve pero no se resta', async ({ page }) => {
  const positions = [
    { id: 'p1', broker: 'Renta 4', name: 'Vanguard Global Stock Index Fund EUR Acc', isin: 'IE00B03HD191', qty: 100, cost: 4000, price: 50, priceDate: '2026-10-26' },
    { id: 'p2', broker: 'Trade Republic', name: 'iShares Core MSCI World UCITS ETF', isin: 'IE00B4L5Y983', qty: 10, cost: 900, price: 100, priceDate: '2026-10-26' },
  ];
  const { errors } = await openApp(page, { path: 'index.html#inversiones', state: state0({ inv: { positions, history: [], lastQuote: null } }) });
  const kpi = (name) => page.locator('#invKpis .kpi', { hasText: name });
  await expect(kpi('Valor de mercado')).toContainText(/6000,00\s€/);
  // 0,19 % a year of 5000 € for the 26 days since 1 October, plus 1 € to sell at Trade Republic
  await expect(kpi('Valor neto')).toContainText(/5998,32\s€/);
  await expect(kpi('Valor neto')).toContainText(/Tras 1,68\s€ de comisiones/);
  await expect(kpi('Coste al año')).toContainText(/20,50\s€/);
  await expect(kpi('Coste al año')).toContainText(/fondos 11,00\s€, plataformas 9,50\s€/);
  await expect(page.locator('#invList')).toContainText(/Gastos del fondo 0,18\s%/);

  await page.click('#invFeesBox summary');
  const r4 = page.locator('form[data-fees="Renta 4"]');
  await r4.locator('[name=custodyPct]').fill('0,25');
  await r4.locator('[type=submit]').click();
  await expect(kpi('Coste al año')).toContainText(/plataformas 12,50\s€/);
  expect(await page.evaluate(() => window.__cg.state().inv.fees['Renta 4'].custodyPct)).toBe(0.25);
  expect(errors).toEqual([]);
});
