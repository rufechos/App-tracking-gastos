// Opening the app with saved data, a fixed date and a fake bank server.
export const SERVER = 'https://cuaderno.test.workers.dev'; // must match the page's connect-src (*.workers.dev)
export const NOW = Date.parse('2026-10-27T10:00:00+01:00');
export const iso = (ms) => new Date(ms).toISOString();
export const amt = (a) => ({ amount: a, currency: 'EUR' });
export const bt = (o) => ({ status: 'BOOK', credit_debit_indicator: 'DBIT', remittance_information: [], ...o });

export const state0 = (o = {}) => ({
  v: 2, tx: [], cats: [], rules: [], accounts: [], files: [], sample: false,
  inv: { positions: [], history: [], lastQuote: null }, settings: { owners: [], lastBackup: iso(NOW - 864e5) }, ...o,
});
export const conn = (o = {}) => ({
  id: 'c_ing', aspsp: { name: 'ING', country: 'ES' }, session_id: 's0', accounts: [{ uid: 'ing1', acctId: 'a_ing', name: '' }],
  valid_until: iso(NOW + 90 * 864e5), lastSync: iso(NOW - 864e5), firstDone: true, cooldownUntil: null, error: null, ...o,
});

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' };

// mock(url, request) -> body, or [status, body]. Every call is recorded in `calls`.
export async function openApp(page, { state, bank, mock, path = 'index.html', now = NOW } = {}) {
  const errors = [], calls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(now);
  await page.route(SERVER + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), body: req.postDataJSON() });
    let r = mock ? await mock(u, req) : [404, { error: 'Ruta desconocida.' }];
    if (!Array.isArray(r)) r = [200, r];
    return route.fulfill({ status: r[0], contentType: 'application/json', headers: CORS, body: JSON.stringify(r[1]) });
  });
  if (state || bank) {
    await page.addInitScript(([s, b]) => {
      if (sessionStorage.getItem('seeded')) return; // only before the first load, not on reloads
      if (s) localStorage.setItem('cuaderno-gastos-v1', s);
      if (b) localStorage.setItem('cuaderno-gastos-banco', b);
      sessionStorage.setItem('seeded', '1');
    }, [state ? JSON.stringify(state) : null, bank ? JSON.stringify(bank) : null]);
  }
  await page.goto(path);
  await page.evaluate(() => window.__cg.ready);
  return { errors, calls };
}

export const txs = (page) => page.evaluate(() => window.__cg.state().tx);
export const idle = (page) => page.waitForFunction(() => !window.__cg.ui.syncing);
