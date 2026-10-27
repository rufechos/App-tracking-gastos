// The Cloudflare server (servidor/worker.js) with Enable Banking, Yahoo, the push services and the KV store replaced by fakes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, createECDH, createPublicKey, randomBytes } from 'node:crypto';
import ece from 'http_ece';
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
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
let appSeq = 0;
// A different application id each time, so that every test signs its own token.
const env = (o = {}) => ({ EB_APP_ID: 'app-' + ++appSeq, EB_PRIVATE_KEY: PKCS8, SYNC_TOKEN: 'secreto', CG: new KV(), ...o });

const amt = (a) => ({ amount: a, currency: 'EUR' });
const bt = (o) => ({ status: 'BOOK', credit_debit_indicator: 'DBIT', remittance_information: [], ...o });
const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let out, handler;
const realFetch = globalThis.fetch;
beforeEach(() => {
  out = [];
  handler = () => res({});
  globalThis.fetch = async (url, init = {}) => {
    const raw = init.body;
    const call = { url: new URL(url), method: init.method || 'GET', headers: init.headers || {}, raw, body: typeof raw === 'string' ? JSON.parse(raw) : null };
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
  assert.deepEqual(await ok.json(), { ok: true, version: 3, eb: true, features: { kv: true, callback: true, balances: true, backup: true, push: true, quoteCache: true }, cron: null });
  assert.deepEqual((await (await call('/ping', { e: env({ CG: undefined }) })).json()).features, { kv: false, callback: false, balances: true, backup: false, push: false, quoteCache: false });
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

const FT_PAGE = `<html><h1 class="mod-tearsheet-overview__header__name mod-tearsheet-overview__header__name--large">Vanguard Global Stock Index Fund EUR Acc</h1>
<ul class="mod-tearsheet-overview__quote__bar"><li><span class="mod-ui-data-list__label">Price (EUR)</span><span class="mod-ui-data-list__value">63.77</span></li>
<li><span class="mod-ui-data-list__label">Today's Change</span><span class="mod-ui-data-list__value">0.23 / 0.36%</span></li></ul>
<div class="mod-disclaimer">Data delayed at least 15 minutes, as of Oct 24 2026.</div></html>`;

test('precios: se guardan medio día, «fresh» los vuelve a pedir y los fondos que Yahoo no tiene salen del Financial Times', async () => {
  const e = env();
  handler = (c) => {
    if (c.url.hostname === 'markets.ft.com') return c.url.searchParams.get('s') === 'IE00B03HD191:EUR' ? new Response(FT_PAGE, { status: 200 }) : new Response('nada', { status: 404 });
    if (c.url.pathname.endsWith('/search')) return res({ quotes: c.url.searchParams.get('q') === 'IE00B4L5Y983' ? [{ symbol: 'EUNL.DE', exchange: 'GER' }] : [] });
    return res({ chart: { result: [{ meta: { regularMarketPrice: 101.2, currency: 'EUR' } }] } });
  };
  const first = (await (await call('/quotes', { method: 'POST', e, body: { isins: ['IE00B4L5Y983', 'ie00b03hd191', 'no-es-isin'] } })).json()).quotes;
  assert.deepEqual(Object.keys(first).sort(), ['IE00B03HD191', 'IE00B4L5Y983']);
  assert.equal(first.IE00B4L5Y983.priceEur, 101.2);
  assert.equal(first.IE00B4L5Y983.source, 'yahoo');
  assert.deepEqual(first.IE00B03HD191, { symbol: 'IE00B03HD191:EUR', name: 'Vanguard Global Stock Index Fund EUR Acc', price: 63.77, currency: 'EUR', priceEur: 63.77, time: '2026-10-24T00:00:00.000Z', source: 'ft' });
  assert.equal(e.CG.ttl['q:IE00B03HD191'], 12 * 3600);

  out.length = 0;
  const again = (await (await call('/quotes', { method: 'POST', e, body: { isins: ['IE00B4L5Y983', 'IE00B03HD191'] } })).json()).quotes;
  assert.equal(out.length, 0); // from KV
  assert.equal(again.IE00B03HD191.cached, true);
  await call('/quotes', { method: 'POST', e, body: { isins: ['IE00B4L5Y983'], fresh: true } });
  assert.ok(out.length >= 2);
});

test('precios: como mucho 8 por llamada; el resto lo pide la app después', async () => {
  handler = (c) => (c.url.pathname.endsWith('/search') ? res({ quotes: [{ symbol: 'X.DE', exchange: 'GER' }] }) : res({ chart: { result: [{ meta: { regularMarketPrice: 10, currency: 'EUR' } }] } }));
  const isins = ['DE0005557508', 'DE0007164600', 'DE0008404005', 'DE0007100000', 'DE0005140008', 'DE000BASF111', 'DE0007236101', 'DE0008430026', 'DE0005190003', 'DE0006231004'];
  const d = await (await call('/quotes', { method: 'POST', body: { isins } })).json();
  assert.equal(Object.keys(d.quotes).length, 8);
  assert.equal(d.rest.length, 2);
  assert.deepEqual([...Object.keys(d.quotes), ...d.rest].sort(), isins.slice().sort());
});

test('saldos de una cuenta, con las cabeceras de usuario presente', async () => {
  handler = () => res({ balances: [{ balance_type: 'ITAV', balance_amount: { amount: '1234.56', currency: 'EUR' } }] });
  const r = await call('/balances?account=acc-1&psu=1', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  assert.deepEqual(await r.json(), { balances: [{ balance_type: 'ITAV', balance_amount: { amount: '1234.56', currency: 'EUR' } }] });
  assert.equal(out[0].url.pathname, '/accounts/acc-1/balances');
  assert.equal(out[0].headers['Psu-Ip-Address'], '203.0.113.7');
  assert.equal((await call('/balances')).status, 400);
});

test('copia cifrada: se guarda, se recupera y la anterior se conserva', async () => {
  const e = env();
  const copy = (n) => ({ app: 'cuaderno-gastos-cifrada', v: 1, iter: 600000, salt: 'c2FsdA', iv: 'aXY', data: 'ZGF0b3M' + n, at: '2026-10-27T10:00:00.000Z' });
  assert.equal((await call('/backup', { e })).status, 404);
  assert.equal((await call('/backup', { method: 'PUT', e, body: { app: 'otra cosa' } })).status, 400);
  assert.equal((await call('/backup', { method: 'PUT', e, body: { ...copy(1), data: 'no es <base64>' } })).status, 400);
  assert.equal((await call('/backup', { method: 'PUT', e, body: copy(1) })).status, 200);
  assert.equal((await call('/backup', { method: 'PUT', e, body: copy(2) })).status, 200);
  assert.equal((await (await call('/backup', { e })).json()).data, 'ZGF0b3M2');
  assert.equal((await (await call('/backup?prev=1', { e })).json()).data, 'ZGF0b3M1');
  assert.equal((await call('/backup', { method: 'PUT', e, body: { ...copy(3), data: 'A'.repeat(8e6) } })).status, 413);
  assert.equal((await call('/backup', { e: env({ CG: undefined }) })).status, 501);
  assert.equal((await call('/backup', { method: 'PUT', token: 'otra', e, body: copy(4) })).status, 401);
});

// A subscriber like the iPhone: its own keys, to read what the server sends.
function subscriber(host = 'https://web.push.apple.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16).toString('base64url');
  return { ecdh, auth, sub: { endpoint: host + '/QGx' + randomBytes(8).toString('hex'), keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } } };
}
function readPush(call, s, serverKey) {
  const [, jwt, k] = call.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, serverKey);
  const [h, c, sig] = jwt.split('.');
  const pub = Buffer.from(k, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.ok(verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'firma VAPID');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(s.sub.endpoint).origin);
  assert.match(claims.sub, /^(mailto:|https:)/);
  assert.ok(claims.exp - Date.now() / 1000 <= 24 * 3600);
  assert.equal(call.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(Number(call.headers.TTL) > 0);
  const plain = ece.decrypt(Buffer.from(call.raw), { version: 'aes128gcm', privateKey: s.ecdh, authSecret: s.auth });
  return JSON.parse(plain.toString('utf8'));
}

test('avisos: clave del servidor, suscripción, aviso de prueba cifrado y suscripción caducada', async () => {
  const e = env({ PUSH_CONTACT: 'aaron@example.com' });
  const key = (await (await call('/push/key', { e })).json()).key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  assert.equal((await (await call('/push/key', { e })).json()).key, key); // kept in KV

  const s = subscriber();
  assert.equal((await call('/push/subscribe', { method: 'POST', e, body: { sub: { ...s.sub, endpoint: 'https://evil.example/x' } } })).status, 400);
  const r = await call('/push/subscribe', { method: 'POST', e, body: { sub: s.sub, prefs: { big: 100, budget: true, expiry: true }, conns: [{ id: 'c_ing', name: 'ING', valid_until: '2027-01-01T00:00:00Z', accounts: [{ uid: 'ing1' }] }] } });
  const { id } = await r.json();
  assert.match(id, /^[0-9a-f]{32}$/);
  const rec = JSON.parse(await e.CG.get('push:' + id));
  assert.deepEqual(rec.conns, [{ id: 'c_ing', name: 'ING', valid_until: '2027-01-01T00:00:00Z', accounts: [{ uid: 'ing1' }] }]);
  assert.equal(rec.session_id, undefined);

  handler = () => new Response(null, { status: 201 });
  assert.equal((await call('/push/test', { method: 'POST', e, body: { id } })).status, 200);
  const sent = out.find((c) => c.url.hostname === 'web.push.apple.com');
  const msg = readPush(sent, s, key);
  assert.equal(msg.title, 'Avisos activados');
  assert.equal(JSON.parse(Buffer.from(sent.headers.Authorization.split('.')[1], 'base64url')).sub, 'mailto:aaron@example.com');

  handler = () => new Response(null, { status: 410 });
  assert.equal((await call('/push/test', { method: 'POST', e, body: { id } })).status, 410);
  assert.equal(await e.CG.get('push:' + id), null);
  assert.equal((await call('/push/test', { method: 'POST', e, body: { id: '../x' } })).status, 400);
});

test('repaso programado: gasto grande, presupuesto superado y permiso a punto de caducar, sin repetir avisos', async () => {
  const e = env();
  const key = (await (await call('/push/key', { e })).json()).key;
  const s = subscriber('https://fcm.googleapis.com');
  const now = Date.now(), day = (n) => new Date(now - n * 864e5).toISOString().slice(0, 10);
  await call('/push/subscribe', { method: 'POST', e, body: {
    sub: s.sub, prefs: { big: 100, budget: true, expiry: true },
    conns: [{ id: 'c_ing', name: 'ING', valid_until: new Date(now + 3 * 864e5).toISOString(), accounts: [{ uid: 'ing1' }] }],
    own: { ibans: ['ES7921000813610123456789'], names: ['trade republic'] },
    watch: { month: day(0).slice(0, 7), cats: [{ id: 'restaurantes', name: 'Restaurantes y bares', limit: 200, left: 30, kws: ['la pepica', 'glovo'] }] },
  } });
  let txs = [bt({ entry_reference: 'old', booking_date: day(1), transaction_amount: amt('500.00'), remittance_information: ['COMPRA ANTIGUA'] })];
  handler = (c) => (c.url.hostname === 'api.enablebanking.com' ? res({ transactions: txs }) : new Response(null, { status: 201 }));
  const run = async () => {
    out.length = 0;
    let job;
    await worker.scheduled({ cron: '0 7,13,19 * * *' }, e, { waitUntil: (p) => { job = p; } });
    await job;
  };
  const sp = (v) => v.replace(/\s/g, ' '); // Intl puts a no-break space before €
  const pushes = () => out.filter((c) => c.url.hostname === 'fcm.googleapis.com').map((c) => readPush(c, s, key)).map((m) => ({ ...m, title: sp(m.title), body: sp(m.body) }));

  await run();
  let sent = pushes();
  assert.deepEqual(sent.map((m) => m.title), ['Renueva el permiso de ING']); // the old movement is only remembered
  const ebCall = out.find((c) => c.url.hostname === 'api.enablebanking.com');
  assert.equal(ebCall.url.searchParams.get('date_from'), day(4));
  assert.equal(ebCall.headers['Psu-Ip-Address'], undefined); // unattended
  assert.ok(await e.CG.get('cron:last'));

  txs = txs.concat([
    bt({ entry_reference: 'n1', booking_date: day(0), transaction_amount: amt('120.00'), creditor: { name: 'IKEA VALENCIA' } }),
    bt({ entry_reference: 'n2', booking_date: day(0), transaction_amount: amt('300.00'), creditor: { name: 'Trade Republic Bank' }, remittance_information: ['Transferencia'] }),
    bt({ entry_reference: 'n3', booking_date: day(0), transaction_amount: amt('250.00'), creditor_account: { iban: 'ES79 2100 0813 6101 2345 6789' } }),
    bt({ entry_reference: 'n4', booking_date: day(0), transaction_amount: amt('45.00'), remittance_information: ['COMPRA RESTAURANTE LA PEPICA'] }),
    bt({ entry_reference: 'n5', booking_date: day(0), credit_debit_indicator: 'CRDT', transaction_amount: amt('2000.00'), remittance_information: ['NOMINA'] }),
  ]);
  await run();
  sent = pushes();
  assert.deepEqual(sent.map((m) => m.title), ['Gasto de 120,00 € en ING', 'Presupuesto de Restaurantes y bares superado']);
  assert.match(sent[0].body, /IKEA/);
  assert.equal(sent[1].body, 'Llevas 215,00 € de 200,00 € este mes.');

  await run();
  assert.deepEqual(pushes(), []); // nothing new, nothing repeated

  handler = (c) => (c.url.hostname === 'api.enablebanking.com' ? res({ transactions: [bt({ entry_reference: 'n6', booking_date: day(0), transaction_amount: amt('150.00'), creditor: { name: 'ZARA' } })] }) : new Response(null, { status: 404 }));
  await run();
  assert.equal((await e.CG.list({ prefix: 'push:' })).keys.length, 0); // the subscription is gone
});
