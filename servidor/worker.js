// Puente entre la app y Enable Banking. Guarda la clave privada como secreto de Cloudflare
// y solo atiende peticiones que traen la clave de acceso de la app (SYNC_TOKEN).
//
// Variables y secretos del Worker:
//   EB_APP_ID       ID de la aplicación de Enable Banking
//   EB_PRIVATE_KEY  contenido del archivo .pem descargado de Enable Banking
//   SYNC_TOKEN      contraseña que tú eliges y que pondrás también en la app
//   ALLOWED_ORIGIN  (opcional) por defecto https://rufechos.github.io
//   PUSH_CONTACT    (opcional) tu correo, para los servicios de avisos de Apple y Google
// Enlace KV (opcional, recomendado):
//   CG              espacio KV: la vuelta del banco sin copiar códigos, los precios del día, la copia cifrada y los avisos
// Disparador (opcional, para los avisos): Settings › Triggers › Cron Triggers, «0 7,13,19 * * *»

const API = 'https://api.enablebanking.com';
const VERSION = 3;
const MAX_PAGES = 20; // Enable Banking pages per call, well under the 50 outbound requests of the free plan
const QUOTES_PER_CALL = 8; // prices fetched per call (each one takes 2 to 6 outbound requests)
const QUOTE_TTL = 12 * 3600; // seconds a price is kept in KV
const MAX_BACKUP = 8e6; // characters of an encrypted backup

export default {
  async fetch(req, env, ctx) {
    return handle(req, env, ctx);
  },
  // The cron trigger: looks for new movements and permissions about to expire, and sends the notifications.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAll(env));
  },
};

async function handle(req, env) {
  const url = new URL(req.url);
  const origin = env.ALLOWED_ORIGIN || 'https://rufechos.github.io';
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // The bank sends the browser here after you authorise: no key, the one-time state identifies the request.
  if (url.pathname === '/callback' && req.method === 'GET') return callback(url, env, origin);
  if (!env.SYNC_TOKEN || !(await sameSecret(req.headers.get('Authorization') || '', 'Bearer ' + env.SYNC_TOKEN)))
    return json({ error: 'Clave de acceso incorrecta.' }, 401);

  try {
    if (url.pathname === '/ping') {
      const kv = !!env.CG;
      return json({
        ok: true, version: VERSION, eb: !!(env.EB_APP_ID && env.EB_PRIVATE_KEY),
        features: { kv, callback: kv, balances: true, backup: kv, push: kv, quoteCache: kv },
        cron: kv ? await env.CG.get('cron:last') : null,
      });
    }
    if (url.pathname === '/quotes' && req.method === 'POST') {
      const b = await req.json();
      const isins = [...new Set((b.isins || []).map((v) => String(v).toUpperCase()))].filter((v) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v));
      const quotes = {}, rest = [];
      let fetched = 0;
      // Cached prices cost nothing; at most QUOTES_PER_CALL are looked up, the rest the app asks for in the next call.
      await Promise.all(isins.map(async (isin) => {
        const hit = b.fresh ? null : await cachedQuote(env, isin);
        if (hit) { quotes[isin] = hit; return; }
        if (++fetched > QUOTES_PER_CALL) { rest.push(isin); return; }
        quotes[isin] = await freshQuote(env, isin);
      }));
      return json({ quotes, rest });
    }
    if (url.pathname === '/backup') return await backup(req, url, env, json);
    if (url.pathname.startsWith('/push/')) return await pushRoute(req, url, env, json);

    if (!env.EB_APP_ID || !env.EB_PRIVATE_KEY) return json({ error: 'Faltan EB_APP_ID o EB_PRIVATE_KEY en el servidor.' }, 500);
    const eb = await ebClient(env);

    if (url.pathname === '/aspsps' && req.method === 'GET') {
      const country = (url.searchParams.get('country') || 'ES').toUpperCase().slice(0, 2);
      return json(await eb('GET', '/aspsps?country=' + encodeURIComponent(country) + '&psu_type=personal'));
    }

    if (url.pathname === '/auth' && req.method === 'POST') {
      const b = await req.json();
      const days = Math.max(1, Math.min(180, Number(b.days) || 90));
      const viaServer = b.redirect === 'server' && !!env.CG;
      const appUrl = String(b.app_url || b.redirect_url || '');
      if (!appUrl.startsWith(origin)) return json({ error: 'La dirección de la app no coincide con ALLOWED_ORIGIN.' }, 400);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(b.state || ''))) return json({ error: 'Falta el identificador de la autorización.' }, 400);
      const redirectUrl = viaServer ? url.origin + '/callback' : appUrl;
      const r = await eb('POST', '/auth', {
        access: { valid_until: new Date(Date.now() + days * 86400000).toISOString() },
        aspsp: { name: b.name, country: b.country || 'ES' },
        state: b.state,
        redirect_url: redirectUrl,
        psu_type: 'personal',
      });
      if (viaServer) await env.CG.put('pending:' + b.state, JSON.stringify({ app: appUrl, aspsp: { name: b.name, country: b.country || 'ES' } }), { expirationTtl: 3600 });
      return json({ url: r.url, authorization_id: r.authorization_id, redirect_url: redirectUrl, via: viaServer ? 'server' : 'app' });
    }

    if (url.pathname === '/claim' && req.method === 'GET') {
      if (!env.CG) return json({ error: 'El servidor no tiene el espacio KV «CG».' }, 501);
      const st = url.searchParams.get('state') || '';
      const v = await env.CG.get('claim:' + st);
      if (!v) return json({ pending: !!(await env.CG.get('pending:' + st)) }, 404);
      return json(JSON.parse(v));
    }

    if (url.pathname === '/session' && req.method === 'POST') {
      const b = await req.json();
      return json(await createSession(eb, b.code));
    }

    if (url.pathname === '/balances' && req.method === 'GET') {
      const account = url.searchParams.get('account');
      if (!account) return json({ error: 'Falta la cuenta.' }, 400);
      const psu = url.searchParams.get('psu') === '1' ? psuHeaders(req) : null;
      const r = await ebWithPsu(eb, 'GET', '/accounts/' + encodeURIComponent(account) + '/balances', null, psu);
      return json({ balances: r.balances || [] });
    }

    if (url.pathname === '/transactions' && req.method === 'GET') {
      const p = url.searchParams;
      const account = p.get('account');
      if (!account) return json({ error: 'Falta la cuenta.' }, 400);
      const psu = p.get('psu') === '1' ? psuHeaders(req) : null;
      const all = [];
      let key = p.get('continuation_key') || null, pages = 0;
      do {
        const q = new URLSearchParams();
        if (p.get('date_from')) q.set('date_from', p.get('date_from'));
        if (p.get('strategy')) q.set('strategy', p.get('strategy'));
        if (key) q.set('continuation_key', key);
        const r = await ebWithPsu(eb, 'GET', '/accounts/' + encodeURIComponent(account) + '/transactions?' + q, null, psu);
        all.push(...(r.transactions || []));
        key = r.continuation_key || null;
      } while (key && ++pages < MAX_PAGES);
      return json({ transactions: all, continuation_key: key });
    }

    return json({ error: 'Ruta desconocida.' }, 404);
  } catch (e) {
    const s = e.status || 500;
    const status = s === 401 || s === 403 ? 403 : s === 429 ? 429 : s === 400 || s === 404 || s === 409 || s === 422 ? s : 502;
    return json({ error: e.message || String(e), code: e.code || null, status: s }, status);
  }
}

// Exchanges the bank's one-time code right away and keeps the result for an hour; the app collects it.
async function callback(url, env, origin) {
  if (!env.CG) return page('Falta configurar el servidor', 'Añade el espacio KV «CG» al Worker (mira la guía SINCRONIZAR.md).', null, 501);
  const st = url.searchParams.get('state') || '';
  const pendingRaw = /^[A-Za-z0-9_-]{8,128}$/.test(st) ? await env.CG.get('pending:' + st) : null;
  if (!pendingRaw) return page('Enlace caducado', 'Esta autorización ya se usó o ha caducado. Vuelve a la app y conecta el banco de nuevo.', null, 400);
  const pending = JSON.parse(pendingRaw);
  const back = pending.app && pending.app.startsWith(origin) ? pending.app : null;
  const err = url.searchParams.get('error');
  let result;
  if (err) result = { ok: false, error: url.searchParams.get('error_description') || err };
  else {
    try {
      const eb = await ebClient(env);
      result = { ok: true, session: await createSession(eb, url.searchParams.get('code') || ''), aspsp: pending.aspsp };
    } catch (e) { result = { ok: false, error: e.message || String(e) }; }
  }
  await env.CG.put('claim:' + st, JSON.stringify(result), { expirationTtl: 3600 });
  await env.CG.delete('pending:' + st);
  return result.ok
    ? page('Banco autorizado', 'Ya puedes cerrar esta página y volver a la app desde la pantalla de inicio: la conexión aparecerá sola en unos segundos.', back)
    : page('El banco no completó la autorización', 'Motivo: ' + result.error + '. Vuelve a la app e inténtalo de nuevo.', back);
}

function page(title, text, back, status = 200) {
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title><style>body{font:17px/1.5 system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px;color:#18211e;background:#f4f6f3}
h1{font-size:24px}a{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:8px;background:#2b4c7e;color:#fff;text-decoration:none}</style>
<h1>${e(title)}</h1><p>${e(text)}</p>${back ? `<a href="${e(back)}">Abrir la app en este navegador</a>` : ''}</html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' } });
}

async function createSession(eb, code) {
  const s = await eb('POST', '/sessions', { code });
  // Some API versions return only account ids; fetch details so the app can show names.
  const accounts = [];
  for (const a of s.accounts || []) {
    if (typeof a === 'string') {
      let d = {};
      try { d = await eb('GET', '/accounts/' + a + '/details'); } catch (e) { /* names are optional */ }
      accounts.push({ uid: a, ...d });
    } else accounts.push(a);
  }
  return { session_id: s.session_id, access: s.access, aspsp: s.aspsp, accounts };
}

// "The user is present" headers, as Enable Banking recommends for syncs you start yourself: many banks only
// allow 4 background requests a day per account without them.
function psuHeaders(req) {
  const h = {}, g = (n) => req.headers.get(n);
  if (g('CF-Connecting-IP')) h['Psu-Ip-Address'] = g('CF-Connecting-IP');
  if (g('User-Agent')) h['Psu-User-Agent'] = g('User-Agent');
  if (g('Referer') || g('Origin')) h['Psu-Referer'] = g('Referer') || g('Origin');
  h['Psu-Accept'] = g('Accept') || 'application/json';
  h['Psu-Accept-Charset'] = 'utf-8';
  if (g('Accept-Encoding')) h['Psu-Accept-Encoding'] = g('Accept-Encoding');
  if (g('Accept-Language')) h['Psu-Accept-language'] = g('Accept-Language');
  const cf = req.cf || {};
  if (cf.latitude && cf.longitude) h['Psu-Geo-Location'] = cf.latitude + ',' + cf.longitude;
  return h;
}
async function ebWithPsu(eb, method, path, body, psu) {
  if (!psu) return eb(method, path, body);
  try { return await eb(method, path, body, psu); }
  catch (e) {
    // A bank that wants a header we cannot provide: Enable Banking asks for all of them or none.
    if (e.status === 422 && /PSU/i.test(e.code || '')) return eb(method, path, body);
    throw e;
  }
}

// Prices for an ISIN from Yahoo Finance, converted to euros. Listings on euro exchanges are preferred.
const EUR_EXCHANGES = ['AMS', 'GER', 'FRA', 'MIL', 'PAR', 'MCE', 'BRU', 'VIE', 'LIS', 'DUB', 'HEL', 'EBS', 'STU', 'MUN', 'DUS', 'BER', 'HAM', 'XETRA'];
const YH = { 'User-Agent': 'Mozilla/5.0 (compatible; cuaderno-gastos)' };
async function yjson(u) {
  const r = await fetch(u, { headers: YH });
  if (!r.ok) throw new Error('Yahoo ' + r.status);
  return r.json();
}
async function lastPrice(symbol) {
  const d = await yjson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=5d&interval=1d');
  const m = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
  if (!m || m.regularMarketPrice == null) throw new Error('Sin precio');
  return { price: m.regularMarketPrice, currency: m.currency || 'EUR', time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null };
}
const toEur = async (price, cur) => (cur === 'EUR' ? price : price * (await lastPrice(cur + 'EUR=X')).price);
const r4 = (v) => Math.round(v * 10000) / 10000;

async function cachedQuote(env, isin) {
  if (!env.CG) return null;
  try { const v = await env.CG.get('q:' + isin); return v ? { ...JSON.parse(v), cached: true } : null; } catch (e) { return null; }
}
// Yahoo first; for funds it does not list (many Spanish and Irish ones), the Financial Times fund page.
async function freshQuote(env, isin) {
  let q;
  try { q = await quoteFor(isin); }
  catch (e) {
    try { q = await ftQuote(isin); } catch (e2) { return { error: e.message }; }
  }
  if (env.CG) await env.CG.put('q:' + isin, JSON.stringify(q), { expirationTtl: QUOTE_TTL });
  return q;
}

async function quoteFor(isin) {
  const s = await yjson('https://query2.finance.yahoo.com/v1/finance/search?quotesCount=10&newsCount=0&q=' + encodeURIComponent(isin));
  const list = (s.quotes || []).filter((q) => q.symbol);
  if (!list.length) throw new Error('ISIN no encontrado');
  list.sort((a, b) => (EUR_EXCHANGES.includes(b.exchange) ? 1 : 0) - (EUR_EXCHANGES.includes(a.exchange) ? 1 : 0));
  let q = null, sym = null;
  for (const c of list.slice(0, 4)) {
    try { q = await lastPrice(c.symbol); sym = c; break; } catch (e) { /* next listing */ }
  }
  if (!q) throw new Error('Sin precio');
  let price = q.price, cur = q.currency;
  if (cur === 'GBp' || cur === 'GBX') { price = price / 100; cur = 'GBP'; }
  return { symbol: sym.symbol, name: sym.longname || sym.shortname || '', price, currency: cur, priceEur: r4(await toEur(price, cur)), time: q.time, source: 'yahoo' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function ftQuote(isin) {
  let err = new Error('Sin precio');
  for (const c of ['EUR', 'USD', 'GBP']) {
    const r = await fetch('https://markets.ft.com/data/funds/tearsheet/summary?s=' + encodeURIComponent(isin + ':' + c), { headers: YH });
    if (!r.ok) { err = new Error('FT ' + r.status); continue; }
    const html = await r.text();
    // <span class="mod-ui-data-list__label">Price (EUR)</span><span class="mod-ui-data-list__value">63.77</span>
    const m = html.match(/Price \(([A-Za-z]{3})\)\s*<\/span>\s*<span[^>]*mod-ui-data-list__value[^>]*>\s*([\d,]+(?:\.\d+)?)\s*</);
    if (!m) continue;
    let price = parseFloat(m[2].replace(/,/g, '')), cur = m[1].toUpperCase();
    if (!(price > 0)) continue;
    if (cur === 'GBX') { price = price / 100; cur = 'GBP'; }
    const d = html.match(/as of ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/);
    const mi = d ? MONTHS.indexOf(d[1]) : -1;
    const time = mi >= 0 ? new Date(Date.UTC(+d[3], mi, +d[2])).toISOString() : null;
    const name = ((html.match(/<h1[^>]*mod-tearsheet-overview__header__name[^>]*>([^<]+)</) || [])[1] || '').trim();
    return { symbol: isin + ':' + c, name, price, currency: cur, priceEur: r4(await toEur(price, cur)), time, source: 'ft' };
  }
  throw err;
}

let tokenCache = null;
async function ebClient(env) {
  const now = Math.floor(Date.now() / 1000);
  if (!tokenCache || tokenCache.kid !== env.EB_APP_ID || tokenCache.pem !== env.EB_PRIVATE_KEY || tokenCache.exp - now < 300) {
    tokenCache = { kid: env.EB_APP_ID, pem: env.EB_PRIVATE_KEY, exp: now + 3600, token: await makeJwt(env.EB_APP_ID, env.EB_PRIVATE_KEY, now) };
  }
  const token = tokenCache.token;
  return async (method, path, body, extraHeaders) => {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(extraHeaders || {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { message: text }; }
    if (!r.ok) {
      const code = [data.error, data.code].find((v) => typeof v === 'string' && /^[A-Z0-9_]{3,}$/.test(v)) || null;
      const err = new Error(data.message || data.detail || (typeof data.error === 'string' ? data.error : '') || ('Error ' + r.status + ' de Enable Banking'));
      err.status = r.status;
      err.code = code || (r.status === 429 ? 'ASPSP_RATE_LIMIT_EXCEEDED' : null);
      throw err;
    }
    return data;
  };
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

const b64url = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function makeJwt(kid, pem, now = Math.floor(Date.now() / 1000)) {
  const head = enc({ typ: 'JWT', alg: 'RS256', kid });
  const claims = enc({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 });
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claims));
  return head + '.' + claims + '.' + b64url(sig);
}

// Accepts both "BEGIN PRIVATE KEY" (PKCS#8) and "BEGIN RSA PRIVATE KEY" (PKCS#1) files.
function pemToPkcs8(pem) {
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const b64 = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (!isPkcs1) return der.buffer;
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(der.length), ...der];
  const inner = [0x02, 0x01, 0x00, ...algId, ...octet];
  return new Uint8Array([0x30, ...derLen(inner.length), ...inner]).buffer;
}
function derLen(n) {
  if (n < 128) return [n];
  const out = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}


// Encrypted backup: the app encrypts it with your passphrase before sending it, so the server never sees your data.
// The previous copy is kept as «backup:prev».
async function backup(req, url, env, json) {
  if (!env.CG) return json({ error: 'El servidor no tiene el espacio KV «CG».' }, 501);
  if (req.method === 'GET') {
    const v = await env.CG.get(url.searchParams.get('prev') === '1' ? 'backup:prev' : 'backup');
    return v ? json(JSON.parse(v)) : json({ error: 'Todavía no hay ninguna copia en el servidor.' }, 404);
  }
  if (req.method !== 'PUT') return json({ error: 'Ruta desconocida.' }, 404);
  const text = await req.text();
  if (text.length > MAX_BACKUP) return json({ error: 'La copia es demasiado grande para el servidor.' }, 413);
  let b = null;
  try { b = JSON.parse(text); } catch (e) { /* checked below */ }
  if (!b || b.app !== 'cuaderno-gastos-cifrada' || ![b.data, b.iv, b.salt].every((v) => typeof v === 'string' && /^[\w-]+$/.test(v)))
    return json({ error: 'La copia no tiene el formato esperado.' }, 400);
  const cur = await env.CG.get('backup');
  if (cur) await env.CG.put('backup:prev', cur);
  await env.CG.put('backup', text);
  return json({ ok: true, at: b.at || null, size: text.length });
}

// Notifications (Web Push). The server makes its own VAPID keys the first time and keeps them in KV.
// What it keeps for each iPhone: the push address, your choices, the bank accounts to look at (no movements),
// your own IBANs and names (a transfer to yourself is not an expense) and how much budget you have left.
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
const str = (v, n) => String(v ?? '').slice(0, n);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const SAFE = /^[\w.:-]{1,100}$/;

async function pushRoute(req, url, env, json) {
  if (!env.CG) return json({ error: 'El servidor no tiene el espacio KV «CG».' }, 501);
  const p = url.pathname;
  if (p === '/push/key' && req.method === 'GET') return json({ key: (await vapidKeys(env)).pub });
  if (req.method !== 'POST') return json({ error: 'Ruta desconocida.' }, 404);
  const b = await req.json();
  if (p === '/push/subscribe') {
    const sub = b.sub || {}, keys = sub.keys || {};
    if (!PUSH_HOSTS.test(String(sub.endpoint || '')) || !/^[\w-]{80,100}=*$/.test(keys.p256dh || '') || !/^[\w-]{16,32}=*$/.test(keys.auth || ''))
      return json({ error: 'La suscripción a los avisos no es válida.' }, 400);
    const id = await shortHash(sub.endpoint);
    const prev = JSON.parse((await env.CG.get('push:' + id)) || 'null') || {};
    const rec = {
      sub: { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      prefs: { big: Math.max(0, num(b.prefs && b.prefs.big)), budget: !!(b.prefs && b.prefs.budget), expiry: !!(b.prefs && b.prefs.expiry) },
      conns: (Array.isArray(b.conns) ? b.conns : []).slice(0, 12).map((c) => ({
        id: str(c.id, 80), name: str(c.name, 60), valid_until: c.valid_until ? str(c.valid_until, 30) : null,
        accounts: (Array.isArray(c.accounts) ? c.accounts : []).slice(0, 8).map((a) => ({ uid: str(a.uid, 100) })).filter((a) => SAFE.test(a.uid)),
      })),
      own: { ibans: (b.own && Array.isArray(b.own.ibans) ? b.own.ibans : []).slice(0, 20).map((v) => str(v, 34)),
        names: (b.own && Array.isArray(b.own.names) ? b.own.names : []).slice(0, 40).map((v) => norm(str(v, 60))).filter((v) => v.length > 2) },
      watch: cleanWatch(b.watch),
      seen: prev.seen || {}, primed: prev.primed || {}, sent: prev.sent || {}, lastRun: prev.lastRun || null, at: new Date().toISOString(),
    };
    // A budget you are already over when the app sends it: you know it, no notification.
    if (rec.watch) for (const c of rec.watch.cats) if (c.left < 0) rec.sent['b|' + rec.watch.month + '|' + c.id] = rec.at.slice(0, 10);
    await env.CG.put('push:' + id, JSON.stringify(rec));
    return json({ ok: true, id });
  }
  const id = str(b.id, 40), key = 'push:' + id;
  if (!/^[0-9a-f]{32}$/.test(id)) return json({ error: 'Falta la suscripción.' }, 400);
  if (p === '/push/unsubscribe') { await env.CG.delete(key); return json({ ok: true }); }
  if (p === '/push/test') {
    const rec = JSON.parse((await env.CG.get(key)) || 'null');
    if (!rec) return json({ error: 'El servidor no tiene esta suscripción. Vuelve a activar los avisos.' }, 404);
    const status = await sendPush(env, rec.sub, { title: 'Avisos activados', body: 'Así te llegarán los avisos del Cuaderno de gastos.', url: '#inicio', tag: 'test' });
    if (status === 404 || status === 410) { await env.CG.delete(key); return json({ error: 'El iPhone ya no acepta avisos de esta suscripción. Vuelve a activarlos.' }, 410); }
    return status < 300 ? json({ ok: true }) : json({ error: 'El servicio de avisos respondió ' + status + '.' }, 502);
  }
  return json({ error: 'Ruta desconocida.' }, 404);
}

function cleanWatch(w) {
  if (!w || !/^\d{4}-\d{2}$/.test(String(w.month)) || !Array.isArray(w.cats)) return null;
  return {
    month: w.month,
    cats: w.cats.slice(0, 30).map((c) => ({ id: str(c.id, 80), name: str(c.name, 60), limit: num(c.limit), left: num(c.left),
      kws: (Array.isArray(c.kws) ? c.kws : []).slice(0, 80).map((k) => norm(str(k, 40))).filter((k) => k.length > 1) })),
  };
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const has = (n, k) => (' ' + n + ' ').includes(' ' + k + ' ');
const eur = (v) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
async function shortHash(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d.slice(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
}

// One booked bank movement, reduced to what the notifications need.
function txLite(t) {
  if (t.status && t.status !== 'BOOK') return null;
  const raw = parseFloat(t.transaction_amount && t.transaction_amount.amount);
  if (!isFinite(raw) || raw === 0) return null;
  const ind = t.credit_debit_indicator;
  const amount = Math.round((ind === 'DBIT' ? -1 : ind === 'CRDT' ? 1 : Math.sign(raw)) * Math.abs(raw) * 100) / 100;
  const party = amount < 0 ? t.creditor : t.debtor, acct = amount < 0 ? t.creditor_account : t.debtor_account;
  const concept = [party && party.name, (t.remittance_information || []).join(' ')].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim()
    || (t.bank_transaction_code && t.bank_transaction_code.description) || 'Sin concepto';
  const date = String(t.transaction_date || t.value_date || t.booking_date || '').slice(0, 10);
  const key = t.entry_reference ? 'r:' + t.entry_reference : String(t.booking_date || date) + '|' + amount.toFixed(2) + '|' + norm(concept);
  return { amount, concept, date, key, iban: String((acct && acct.iban) || '').replace(/\s/g, '').toUpperCase() };
}

async function checkAll(env) {
  if (!env.CG) return;
  const eb = env.EB_APP_ID && env.EB_PRIVATE_KEY ? await ebClient(env) : null;
  const list = await env.CG.list({ prefix: 'push:' });
  for (const k of list.keys) {
    let rec = null;
    try { rec = JSON.parse(await env.CG.get(k.name)); } catch (e) { /* skipped */ }
    if (!rec) continue;
    let r = null;
    try { r = await checkOne(env, eb, rec, new Date()); } catch (e) { console.log('avisos: ' + (e.message || e)); }
    if (r === 'gone') await env.CG.delete(k.name); else await env.CG.put(k.name, JSON.stringify(rec));
  }
  await env.CG.put('cron:last', new Date().toISOString());
}

// Looks at the last 4 days of each account (without you present: banks allow 4 such requests a day, the
// trigger uses 3). The first time an account is seen, its movements are only remembered, not notified.
async function checkOne(env, eb, rec, now) {
  const today = now.toISOString().slice(0, 10), notes = [], big = [], over = [];
  const from = new Date(now.getTime() - 4 * 864e5).toISOString().slice(0, 10);
  for (const c of rec.conns) {
    if (!c.valid_until) continue;
    const left = Date.parse(c.valid_until) - now.getTime(), key = 'e|' + c.id + '|' + c.valid_until.slice(0, 10);
    if (rec.prefs.expiry && left > 0 && left < 7 * 864e5 && !rec.sent[key]) {
      rec.sent[key] = today;
      notes.push({ title: 'Renueva el permiso de ' + c.name, body: 'Caduca el ' + dmy(c.valid_until) + '. Abre la app y pulsa «Renovar».', url: '#ajustes', tag: 'perm-' + c.id });
    }
  }
  if (eb && (rec.prefs.big > 0 || (rec.prefs.budget && rec.watch))) {
    for (const c of rec.conns) {
      if (c.valid_until && Date.parse(c.valid_until) < now.getTime()) continue;
      for (const a of c.accounts) {
        let raw;
        try { raw = await recent(eb, a.uid, from); }
        catch (e) {
          const key = 'x|' + c.id;
          if ((e.status === 401 || e.status === 403) && rec.prefs.expiry && !rec.sent[key]) {
            rec.sent[key] = today;
            notes.push({ title: c.name + ' ha retirado el permiso', body: 'Abre la app y vuelve a autorizar el acceso para que siga sincronizando.', url: '#ajustes', tag: 'perm-' + c.id });
          }
          continue;
        }
        const first = !rec.primed[a.uid], count = {};
        for (const x of raw.map(txLite).filter(Boolean)) {
          count[x.key] = (count[x.key] || 0) + 1;
          const h = (await shortHash(a.uid + '|' + x.key + '#' + count[x.key])).slice(0, 12);
          if (rec.seen[h]) continue;
          rec.seen[h] = today;
          if (first || x.amount >= 0) continue;
          const n = norm(x.concept);
          if (rec.own.ibans.includes(x.iban) || rec.own.names.some((o) => has(n, o))) continue; // between your accounts
          if (rec.prefs.big > 0 && -x.amount >= rec.prefs.big) big.push({ ...x, where: c.name });
          const w = rec.watch;
          if (rec.prefs.budget && w && x.date.slice(0, 7) === w.month) {
            const b = w.cats.find((y) => y.kws.some((k) => has(n, k)));
            if (b) {
              const before = b.left;
              b.left = Math.round((b.left + x.amount) * 100) / 100;
              const key = 'b|' + w.month + '|' + b.id;
              if (before >= 0 && b.left < 0 && !rec.sent[key]) { rec.sent[key] = today; over.push(b); }
            }
          }
        }
        rec.primed[a.uid] = true;
      }
    }
  }
  if (big.length === 1) notes.unshift({ title: 'Gasto de ' + eur(-big[0].amount) + ' en ' + big[0].where, body: big[0].concept.slice(0, 140), url: '#movimientos', tag: 'big' });
  else if (big.length > 1) notes.unshift({ title: big.length + ' gastos grandes', body: big.slice(0, 4).map((x) => eur(-x.amount) + ' ' + x.concept.slice(0, 40)).join(' · '), url: '#movimientos', tag: 'big' });
  for (const b of over) notes.push({ title: 'Presupuesto de ' + b.name + ' superado', body: 'Llevas ' + eur(b.limit - b.left) + ' de ' + eur(b.limit) + ' este mes.', url: '#inicio', tag: 'budget-' + b.id });
  const oldSeen = new Date(now.getTime() - 10 * 864e5).toISOString().slice(0, 10), oldSent = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(rec.seen)) if (rec.seen[k] < oldSeen) delete rec.seen[k];
  for (const k of Object.keys(rec.sent)) if (rec.sent[k] < oldSent) delete rec.sent[k];
  rec.lastRun = now.toISOString();
  for (const msg of notes.slice(0, 3)) {
    const status = await sendPush(env, rec.sub, msg);
    if (status === 404 || status === 410) return 'gone'; // the iPhone dropped the subscription
  }
  return notes.length;
}

async function recent(eb, uid, from) {
  const all = [];
  let key = null, pages = 0;
  do {
    const q = new URLSearchParams({ date_from: from });
    if (key) q.set('continuation_key', key);
    const r = await eb('GET', '/accounts/' + encodeURIComponent(uid) + '/transactions?' + q);
    all.push(...(r.transactions || []));
    key = r.continuation_key || null;
  } while (key && ++pages < 3);
  return all;
}

let vapidCache = null;
async function vapidKeys(env) {
  if (vapidCache && vapidCache.kv === env.CG) return vapidCache;
  const raw = await env.CG.get('vapid');
  let v = raw ? JSON.parse(raw) : null;
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await env.CG.put('vapid', JSON.stringify(v));
  }
  vapidCache = { pub: v.pub, key: await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']), kv: env.CG };
  return vapidCache;
}

// RFC 8292: a token signed with the server's key, for the push service of that address.
async function vapidAuth(env, endpoint) {
  const v = await vapidKeys(env);
  const now = Math.floor(Date.now() / 1000);
  const contact = env.PUSH_CONTACT ? (/^(mailto:|https:)/.test(env.PUSH_CONTACT) ? env.PUSH_CONTACT : 'mailto:' + env.PUSH_CONTACT) : (env.ALLOWED_ORIGIN || 'https://rufechos.github.io');
  const head = enc({ typ: 'JWT', alg: 'ES256' }), claims = enc({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: contact });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, new TextEncoder().encode(head + '.' + claims));
  return 'vapid t=' + head + '.' + claims + '.' + b64url(sig) + ', k=' + v.pub;
}

const unb64 = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
const utf8 = (s) => new TextEncoder().encode(s);
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// RFC 8291 (aes128gcm): only the iPhone that subscribed can read the message.
async function encryptPush(sub, text) {
  const ua = unb64(sub.keys.p256dh), auth = unb64(sub.keys.auth);
  const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, mine.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['encrypt']);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cek, concat(utf8(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return concat(head, asPub, body);
}

async function sendPush(env, sub, msg) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body: await encryptPush(sub, JSON.stringify(msg)),
  });
  return r.status;
}
