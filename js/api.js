// Calls to your Cloudflare server (servidor/worker.js).
import { app } from './store.js';

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export const serverUrl = () => (app.bank.server || '').trim().replace(/\/+$/, '');
export const hasServer = () => !!(serverUrl() && app.bank.token);

export async function api(path, { body, method, query, timeout = 45000 } = {}) {
  if (!hasServer()) throw new ApiError('Falta la dirección del servidor o la clave de acceso.', 0, 'NO_SERVER');
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')) : '';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(serverUrl() + path + qs, {
      method: method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ Authorization: 'Bearer ' + app.bank.token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: ctl.signal,
    });
  } catch (e) {
    throw new ApiError(ctl.signal.aborted ? 'El servidor no responde.' : 'No hay conexión con el servidor.', 0, 'NETWORK');
  } finally { clearTimeout(timer); }
  let d = {};
  try { d = await r.json(); } catch (e) { /* empty or not JSON */ }
  if (!r.ok) throw new ApiError(d.error || 'Error ' + r.status + ' del servidor', r.status, d.code || null);
  return d;
}
