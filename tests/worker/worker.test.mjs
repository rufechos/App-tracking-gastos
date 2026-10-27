// The Cloudflare server (servidor/worker.js) with Enable Banking, Yahoo and the KV store replaced by fakes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import worker from '../../servidor/worker.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PKCS8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PKCS1 = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ORIGIN = 'https://rufechos.github.io';
const APP = ORIGIN + '/App-tracking-gastos/';
const HOST = 'https://cg.test.workers.dev';

class KV {
  constructor() { this.m = new Map(); this.ttl = {}; }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v, o) { this.m.set(k, v); this.ttl[k] = o && o.expirationTtl; }
  async delete(k) { this.m.delete(k); }
}
let appSeq = 0;
// A different application id each time, so that every test signs its own token.
const env = (o = {}) => ({ EB_APP_ID: 'app-' + ++appSeq, EB_PRIVATE_KEY: PKCS8, SYNC_TOKEN: 'secreto', CG: new KV(), ...o });

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let out, handler;
const realFetch = globalThis.fetch;
beforeEach(() => {
  out = [];
  handler = () => res({});
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: new URL(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    out.push(call);
    return handler(call);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function call(path, { method = 'GET', body, token = 'secreto', headers = {}, e = env(), cf } = {}) {
  const req = new Request(HOST + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  return worker.fetch(req, e, {});
}
const b64 = (s) => Buffer.from(s, 'base64url');
function checkJwt(auth, kid) {
  const [h, c, sig] = auth.replace(/^Bearer /, '').split('.');
  assert.ok(verify('RSA-SHA256', Buffer.from(h + '.' + c), publicKey, b64(sig)), 'firma RS256 válida');
  const head = JSON.parse(b64(h)), claims = JSON.parse(b64(c));
  assert.deepEqual(head, { typ: 'JWT', alg: 'RS256', kid });
  assert.equal(claims.iss, 'enablebanking.com');
  assert.equal(claims.aud, 'api.enablebanking.com');
  assert.equal(claims.exp - claims.iat, 3600);
}

test('CORS, clave de acceso y respuestas que no se guardan en caché', async () => {
  const pre = await call('/ping', { method: 'OPTIONS', token: null });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  for (const token of [null, 'otra', 'secret', 'Secreto', 'secreto2']) {
    const r = await call('/ping', { token });
    assert.equal(r.status, 401, String(token));
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
  const ok = await call('/ping');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, version: 2, eb: true, features: { kv: true, callback: true } });
  assert.deepEqual((await (await call('/ping', { e: env({ CG: undefined }) })).json()).features, { kv: false, callback: false });
  assert.equal((await call('/nada')).status, 404);
  const noEb = await call('/aspsps', { e: env({ EB_PRIVATE_KEY: '' }) });
  assert.equal(noEb.status, 500);
  assert.equal(out.length, 0);
});

test('token firmado para Enable Banking, con la clave en PKCS#8 o PKCS#1', async () => {
  handler = () => res({ aspsps: [{ name: 'Trade Republic', country: 'DE' }] });
  for (const pem of [PKCS8, PKCS1, PKCS8.replace(/\n/g, '\\n')]) {
    const e = env({ EB_PRIVATE_KEY: pem });
    const r = await call('/aspsps?country=de', { e });
    assert.equal(r.status, 200);
    const c = out.pop();
    assert.equal(c.url.href, 'https://api.enablebanking.com/aspsps?country=DE&psu_type=personal');
    checkJwt(c.headers.Authorization, e.EB_APP_ID);
  }
});

test('autorizar: la vuelta del banco pasa por el servidor y la app la recoge', async () => {
  const e = env();
  handler = (c) => {
    if (c.url.pathname === '/auth') return res({ url: 'https://bank.example/auth?x=1', authorization_id: 'au1' });
    if (c.url.pathname === '/sessions') return res({ session_id: 'S1', access: { valid_until: '2027-01-25T00:00:00Z' }, aspsp: { name: 'ING', country: 'ES' }, accounts: ['acc-1'] });
    if (c.url.pathname === '/accounts/acc-1/details') return res({ name: 'Cuenta Naranja', account_id: { iban: 'ES9121000418450200051332' } });
    return res({ error: 'x' }, 404);
  };
  const bad = await call('/auth', { method: 'POST', e, body: { name: 'ING', state: 'abcdefgh12', redirect: 'server', app_url: 'https://evil.example/' } });
  assert.equal(bad.status, 400);
  assert.equal((await call('/auth', { method: 'POST', e, body: { name: 'ING', state: 'x', redirect: 'server', app_url: APP } })).status, 400);
  assert.equal(out.length, 0);

  const r = await call('/auth', { method: 'POST', e, body: { name: 'ING', country: 'ES', days: 400, state: 'abcdefgh12', redirect: 'server', app_url: APP } });
  assert.deepEqual(await r.json(), { url: 'https://bank.example/auth?x=1', authorization_id: 'au1', redirect_url: HOST + '/callback', via: 'server' });
  const auth = out[0].body;
  assert.equal(auth.redirect_url, HOST + '/callback');
  assert.equal(auth.psu_type, 'personal');
  assert.ok(Date.parse(auth.access.valid_until) - Date.now() <= 180 * 864e5 + 5000); // at most 180 days
  assert.equal(e.CG.ttl['pending:abcdefgh12'], 3600);

  const before = await call('/claim?state=abcdefgh12', { e });
  assert.equal(before.status, 404);
  assert.deepEqual(await before.json(), { pending: true });

  const back = await call('/callback?state=abcdefgh12&code=CODE1', { token: null, e });
  assert.equal(back.status, 200);
  assert.match(back.headers.get('Content-Type'), /text\/html/);
  assert.match(back.headers.get('Content-Security-Policy'), /default-src 'none'/);
  const html = await back.text();
  assert.match(html, /Banco autorizado/);
  assert.ok(html.includes('href="' + APP + '"'));
  assert.deepEqual(out.find((c) => c.url.pathname === '/sessions').body, { code: 'CODE1' });
  assert.equal(await e.CG.get('pending:abcdefgh12'), null);

  const claim = await call('/claim?state=abcdefgh12', { e });
  assert.equal(claim.status, 200);
  const d = await claim.json();
  assert.equal(d.ok, true);
  assert.equal(d.session.session_id, 'S1');
  assert.deepEqual(d.session.accounts, [{ uid: 'acc-1', name: 'Cuenta Naranja', account_id: { iban: 'ES9121000418450200051332' } }]);
  assert.deepEqual(d.aspsp, { name: 'ING', country: 'ES' });

  const again = await call('/callback?state=abcdefgh12&code=CODE1', { token: null, e });
  assert.equal(again.status, 400); // one use only
});

test('autorizar sin KV: el banco vuelve a la app como antes', async () => {
  const e = env({ CG: undefined });
  handler = () => res({ url: 'https://bank.example/a', authorization_id: 'au2' });
  const r = await call('/auth', { method: 'POST', e, body: { name: 'ING', state: 'abcdefgh12', redirect: 'server', app_url: APP } });
  assert.equal((await r.json()).via, 'app');
  assert.equal(out[0].body.redirect_url, APP);
  assert.equal((await call('/callback?state=abcdefgh12&code=x', { token: null, e })).status, 501);
  assert.equal((await call('/claim?state=abcdefgh12', { e })).status, 501);
});

test('el banco no completa la autorización', async () => {
  const e = env();
  await e.CG.put('pending:zzzzzzzz99', JSON.stringify({ app: APP, aspsp: { name: 'ING', country: 'ES' } }));
  const r = await call('/callback?state=zzzzzzzz99&error=access_denied&error_description=Cancelado%20por%20el%20usuario', { token: null, e });
  assert.match(await r.text(), /no completó/);
  assert.deepEqual(await (await call('/claim?state=zzzzzzzz99', { e })).json(), { ok: false, error: 'Cancelado por el usuario' });
  assert.equal(out.length, 0);
  assert.equal((await call('/callback?state=..%2F..&code=x', { token: null, e })).status, 400);
});

test('movimientos: cabeceras de usuario presente, periodo, estrategia y límite de páginas', async () => {
  let page = 0;
  handler = () => res({ transactions: [{ entry_reference: String(++page) }], continuation_key: 'k' + page });
  const r = await call('/transactions?account=acc%2F1&strategy=longest&psu=1', {
    headers: { 'CF-Connecting-IP': '203.0.113.7', 'User-Agent': 'iPhone Safari', 'Accept-Language': 'es-ES', Origin: ORIGIN }, cf: { latitude: '39.47', longitude: '-0.38' },
  });
  const d = await r.json();
  assert.equal(d.transactions.length, 20);
  assert.equal(d.continuation_key, 'k20'); // the app asks for the rest
  assert.equal(out[0].url.pathname, '/accounts/acc%2F1/transactions');
  assert.equal(out[0].url.search, '?strategy=longest');
  assert.equal(out[1].url.searchParams.get('continuation_key'), 'k1');
  const h = out[0].headers;
  assert.equal(h['Psu-Ip-Address'], '203.0.113.7');
  assert.equal(h['Psu-User-Agent'], 'iPhone Safari');
  assert.equal(h['Psu-Accept-language'], 'es-ES');
  assert.equal(h['Psu-Referer'], ORIGIN);
  assert.equal(h['Psu-Geo-Location'], '39.47,-0.38');

  out.length = 0;
  handler = () => res({ transactions: [], continuation_key: null });
  await call('/transactions?account=a&date_from=2026-10-01&continuation_key=prev');
  assert.equal(out.length, 1);
  assert.equal(out[0].url.search, '?date_from=2026-10-01&continuation_key=prev');
  assert.equal(out[0].headers['Psu-Ip-Address'], undefined); // background sync: no user headers
  assert.equal((await call('/transactions')).status, 400);
});

test('un banco que rechaza las cabeceras de usuario presente: se repite sin ellas', async () => {
  handler = (c) => (c.headers['Psu-Ip-Address'] ? res({ error: 'PSU_HEADER_NOT_PROVIDED', message: 'Falta Psu-Http-Method' }, 422) : res({ transactions: [{ entry_reference: 'a' }] }));
  const r = await call('/transactions?account=a&psu=1', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  assert.equal(r.status, 200);
  assert.equal(out.length, 2);
});

test('errores de Enable Banking: código y estado que la app entiende', async () => {
  const cases = [
    [res({ message: 'Too many requests' }, 429), 429, 'ASPSP_RATE_LIMIT_EXCEEDED'],
    [res({ error: 'WRONG_TRANSACTIONS_PERIOD', message: 'Wrong period' }, 422), 422, 'WRONG_TRANSACTIONS_PERIOD'],
    [res({ error: 'EXPIRED_SESSION', message: 'Session expired' }, 401), 403, 'EXPIRED_SESSION'],
    [new Response('<html>Bad gateway</html>', { status: 500 }), 502, null],
  ];
  for (const [answer, status, code] of cases) {
    handler = () => answer.clone();
    const r = await call('/transactions?account=a');
    assert.equal(r.status, status);
    assert.equal((await r.json()).code, code);
  }
});

test('precios por ISIN, en euros', async () => {
  handler = (c) => {
    if (c.url.pathname.endsWith('/search')) {
      const q = c.url.searchParams.get('q');
      if (q === 'US0378331005') return res({ quotes: [{ symbol: 'AAPL', exchange: 'NMS', longname: 'Apple Inc.' }] });
      if (q === 'IE00B4L5Y983') return res({ quotes: [{ symbol: 'IWDA.L', exchange: 'LSE' }, { symbol: 'EUNL.DE', exchange: 'GER', longname: 'iShares Core MSCI World' }] });
      return res({ quotes: [] });
    }
    const sym = decodeURIComponent(c.url.pathname.split('/').pop());
    const meta = { 'AAPL': { regularMarketPrice: 200, currency: 'USD', regularMarketTime: 1761580800 }, 'USDEUR=X': { regularMarketPrice: 0.9 }, 'EUNL.DE': { regularMarketPrice: 101.2, currency: 'EUR' } }[sym];
    return res({ chart: { result: meta ? [{ meta }] : [] } });
  };
  const r = await call('/quotes', { method: 'POST', body: { isins: ['US0378331005', 'IE00B4L5Y983', 'XX0000000000'] } });
  const { quotes } = await r.json();
  assert.equal(quotes.US0378331005.priceEur, 180);
  assert.equal(quotes.US0378331005.currency, 'USD');
  assert.equal(quotes.IE00B4L5Y983.symbol, 'EUNL.DE'); // the euro listing first
  assert.equal(quotes.IE00B4L5Y983.priceEur, 101.2);
  assert.match(quotes.XX0000000000.error, /no encontrado/);
});
