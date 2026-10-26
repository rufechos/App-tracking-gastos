// Puente entre la app y Enable Banking. Guarda la clave privada como secreto de Cloudflare
// y solo atiende peticiones que traen la clave de acceso de la app (SYNC_TOKEN).
//
// Variables y secretos del Worker:
//   EB_APP_ID       ID de la aplicación de Enable Banking
//   EB_PRIVATE_KEY  contenido del archivo .pem descargado de Enable Banking
//   SYNC_TOKEN      contraseña que tú eliges y que pondrás también en la app
//   ALLOWED_ORIGIN  (opcional) por defecto https://rufechos.github.io

const API = 'https://api.enablebanking.com';

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://rufechos.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.SYNC_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.SYNC_TOKEN)
      return json({ error: 'Clave de acceso incorrecta.' }, 401);
    if (!env.EB_APP_ID || !env.EB_PRIVATE_KEY)
      return json({ error: 'Faltan EB_APP_ID o EB_PRIVATE_KEY en el servidor.' }, 500);

    const url = new URL(req.url);
    try {
      const eb = await ebClient(env);
      if (url.pathname === '/ping') return json({ ok: true });

      if (url.pathname === '/quotes' && req.method === 'POST') {
        const b = await req.json();
        const isins = [...new Set((b.isins || []).map(String))].slice(0, 40);
        const quotes = {};
        await Promise.all(isins.map(async (isin) => {
          try { quotes[isin] = await quoteFor(isin); } catch (e) { quotes[isin] = { error: e.message }; }
        }));
        return json({ quotes });
      }

      if (url.pathname === '/aspsps' && req.method === 'GET') {
        const country = url.searchParams.get('country') || 'ES';
        return json(await eb('GET', '/aspsps?country=' + encodeURIComponent(country)));
      }

      if (url.pathname === '/auth' && req.method === 'POST') {
        const b = await req.json();
        const days = Math.max(1, Math.min(180, Number(b.days) || 90));
        const validUntil = new Date(Date.now() + days * 86400000).toISOString();
        return json(await eb('POST', '/auth', {
          access: { valid_until: validUntil },
          aspsp: { name: b.name, country: b.country || 'ES' },
          state: b.state,
          redirect_url: b.redirect_url,
          psu_type: 'personal',
        }));
      }

      if (url.pathname === '/session' && req.method === 'POST') {
        const b = await req.json();
        const s = await eb('POST', '/sessions', { code: b.code });
        // Some API versions return only account ids; fetch details so the app can show names.
        const accounts = [];
        for (const a of s.accounts || []) {
          if (typeof a === 'string') {
            let d = {};
            try { d = await eb('GET', '/accounts/' + a + '/details'); } catch (e) {}
            accounts.push({ uid: a, ...d });
          } else accounts.push(a);
        }
        return json({ session_id: s.session_id, access: s.access, aspsp: s.aspsp, accounts });
      }

      if (url.pathname === '/transactions' && req.method === 'GET') {
        const account = url.searchParams.get('account');
        const from = url.searchParams.get('date_from');
        if (!account) return json({ error: 'Falta la cuenta.' }, 400);
        const all = [];
        let key = null, pages = 0;
        do {
          const q = new URLSearchParams();
          if (from) q.set('date_from', from);
          if (key) q.set('continuation_key', key);
          const r = await eb('GET', '/accounts/' + encodeURIComponent(account) + '/transactions?' + q);
          all.push(...(r.transactions || []));
          key = r.continuation_key || null;
        } while (key && ++pages < 50);
        return json({ transactions: all });
      }

      return json({ error: 'Ruta desconocida.' }, 404);
    } catch (e) {
      return json({ error: e.message || String(e), status: e.status || 500 }, e.status === 401 || e.status === 403 ? 403 : 502);
    }
  },
};

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
    try { q = await lastPrice(c.symbol); sym = c; break; } catch (e) {}
  }
  if (!q) throw new Error('Sin precio');
  let price = q.price, cur = q.currency;
  if (cur === 'GBp' || cur === 'GBX') { price = price / 100; cur = 'GBP'; }
  let priceEur = price;
  if (cur !== 'EUR') priceEur = price * (await lastPrice(cur + 'EUR=X')).price;
  return { symbol: sym.symbol, name: sym.longname || sym.shortname || '', price, currency: cur, priceEur: Math.round(priceEur * 10000) / 10000, time: q.time };
}

async function ebClient(env) {
  const token = await makeJwt(env.EB_APP_ID, env.EB_PRIVATE_KEY);
  return async (method, path, body) => {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { message: text }; }
    if (!r.ok) {
      const err = new Error(data.message || data.detail || data.error || ('Error ' + r.status + ' de Enable Banking'));
      err.status = r.status;
      throw err;
    }
    return data;
  };
}

const b64url = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function makeJwt(kid, pem) {
  const now = Math.floor(Date.now() / 1000);
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
