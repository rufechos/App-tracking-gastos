// Puente entre la app y Enable Banking. Guarda la clave privada como secreto de Cloudflare
// y solo atiende peticiones que traen la clave de acceso de la app (SYNC_TOKEN).
//
// Variables y secretos del Worker:
//   EB_APP_ID       ID de la aplicación de Enable Banking
//   EB_PRIVATE_KEY  contenido del archivo .pem descargado de Enable Banking
//   SYNC_TOKEN      contraseña que tú eliges y que pondrás también en la app
//   ALLOWED_ORIGIN  (opcional) por defecto https://rufechos.github.io
// Enlace KV (opcional, recomendado):
//   CG              espacio KV para volver del banco sin copiar códigos y para guardar precios un día

const API = 'https://api.enablebanking.com';
const VERSION = 2;
const MAX_PAGES = 20; // Enable Banking pages per call, well under the 50 outbound requests of the free plan

export default {
  async fetch(req, env, ctx) {
    return handle(req, env, ctx);
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
      return json({ ok: true, version: VERSION, eb: !!(env.EB_APP_ID && env.EB_PRIVATE_KEY), features: { kv: !!env.CG, callback: !!env.CG } });
    }
    if (url.pathname === '/quotes' && req.method === 'POST') {
      const b = await req.json();
      const isins = [...new Set((b.isins || []).map(String))].slice(0, 40);
      const quotes = {};
      await Promise.all(isins.map(async (isin) => {
        try { quotes[isin] = await quoteFor(isin); } catch (e) { quotes[isin] = { error: e.message }; }
      }));
      return json({ quotes });
    }

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
  let priceEur = price;
  if (cur !== 'EUR') priceEur = price * (await lastPrice(cur + 'EUR=X')).price;
  return { symbol: sym.symbol, name: sym.longname || sym.shortname || '', price, currency: cur, priceEur: Math.round(priceEur * 10000) / 10000, time: q.time };
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

