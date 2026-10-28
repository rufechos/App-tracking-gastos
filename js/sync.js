// Bank connections from the app's side: authorising (and coming back), syncing and the automatic sync.
import { app, save, bankSave, leaveSample, persistStorage } from './store.js';
import { ui } from './ui/state.js';
import { api, hasServer } from './api.js';
import { classify } from './classify.js';
import { makeConnection, syncConnection, dueForSync, expired, coolingDown, syncErrorText, COOLDOWN } from './bank.js';
import { uid, esc, plural } from './util.js';

export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
export const GUIDE = 'https://github.com/rufechos/App-tracking-gastos/blob/main/SINCRONIZAR.md';
export const SERVER_VERSION = 2; // servidor/worker.js that this app expects

export async function loadFeatures() {
  try {
    const d = await api('/ping');
    ui.features = d.features || {};
    ui.serverVersion = d.version || 1;
  } catch (e) { ui.features = null; throw e; }
  return ui.features;
}

// Spanish banks plus the German list, where Trade Republic is.
export async function loadAspsps() {
  const lists = await Promise.all(['ES', 'DE'].map((c) => api('/aspsps', { query: { country: c } }).then((d) => (d.aspsps || []).map((a) => ({ ...a, country: a.country || c }))).catch((e) => (c === 'ES' ? Promise.reject(e) : []))));
  ui.aspsps = lists.flat().filter((a) => !a.psu_types || a.psu_types.includes('personal')).sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name, 'es'));
  return ui.aspsps;
}

export async function connectBank(a, reconnId) {
  if (!ui.features) await loadFeatures().catch(() => {});
  const days = a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86400) : 90;
  const st = uid() + uid();
  const viaServer = !!(ui.features && ui.features.callback);
  app.bank.pendingAuth = { state: st, aspsp: { name: a.name, country: a.country || 'ES' }, at: new Date().toISOString(), via: viaServer ? 'server' : 'app', reconn: reconnId || null };
  bankSave();
  // redirect_url: what servers from before version 2 read.
  const r = await api('/auth', { body: { name: a.name, country: a.country || 'ES', days, state: st, redirect: viaServer ? 'server' : 'app', app_url: appUrl(), redirect_url: appUrl() } });
  app.bank.pendingAuth.via = r.via || app.bank.pendingAuth.via;
  bankSave();
  location.href = r.url;
}

// A new or renewed connection: map its accounts to «Mis cuentas» and download it right away (strategy "longest").
export async function finishConnection(session, aspspHint) {
  const pa = app.bank.pendingAuth;
  const aspsp = (pa && pa.aspsp) || aspspHint || session.aspsp || { name: 'Banco', country: 'ES' };
  leaveSample();
  const conns = app.bank.conns;
  const prev = (pa && pa.reconn && conns.find((c) => c.id === pa.reconn)) || conns.find((c) => c.aspsp.name === aspsp.name);
  const conn = makeConnection(session, aspsp, app.state.accounts, prev);
  app.bank.conns = conns.filter((c) => c !== prev).concat(conn);
  app.bank.pendingAuth = null;
  bankSave();
  classify(app.state);
  save();
  persistStorage();
  ui.bankMsg = `<span class="ok">${esc(aspsp.name)} conectado.</span>`;
  app.render();
  await syncAll({ only: conn.id, manual: true });
}

export async function finishWithCode(code) {
  const s = await api('/session', { body: { code } });
  await finishConnection(s);
}

// Collect an authorisation that came back through the server (/callback): no codes to copy.
export async function checkClaim() {
  const pa = app.bank.pendingAuth;
  if (!pa || pa.via !== 'server' || !hasServer()) return false;
  if (Date.now() - new Date(pa.at).getTime() > 3600e3) { app.bank.pendingAuth = null; bankSave(); app.render(); return false; }
  let d;
  try { d = await api('/claim', { query: { state: pa.state } }); } catch (e) { if (e.status === 404) return false; throw e; }
  if (!d.ok) { app.bank.pendingAuth = null; bankSave(); ui.bankMsg = `<span class="err">El banco no completó la autorización: ${esc(d.error || '')}.</span>`; app.render(); return true; }
  await finishConnection(d.session, d.aspsp);
  return true;
}

export function startClaimPolling() {
  stopClaimPolling();
  let n = 0;
  const tick = async () => {
    if (!app.bank.pendingAuth || document.visibilityState !== 'visible' || ++n > 60) return stopClaimPolling();
    try { if (await checkClaim()) return stopClaimPolling(); } catch (e) { /* try again */ }
    ui.claimTimer = setTimeout(tick, 3000);
  };
  tick();
}
export function stopClaimPolling() { clearTimeout(ui.claimTimer); ui.claimTimer = null; }

// manual: you pressed «Sincronizar» (every bank is fetched); otherwise only the banks that are due.
export async function syncAll({ manual = false, only = null } = {}) {
  if (ui.syncing || !app.bank.conns.length) return;
  ui.syncing = true;
  ui.bankMsg = '';
  app.render();
  const fresh = new Set();
  let added = 0, merged = 0, maybe = 0, failed = 0;
  try {
    for (const c of app.bank.conns) {
      if (only && c.id !== only) continue;
      if (expired(c)) { c.error = 'El permiso ha caducado. Vuelve a autorizar el acceso.'; failed++; continue; }
      if (coolingDown(c)) { if (manual) failed++; continue; }
      if (!manual && !dueForSync(c)) continue;
      try {
        if (app.state.sample) leaveSample();
        const r = await syncConnection(api, app.state, c);
        for (const t of r.added) { app.state.tx.push(t); fresh.add(t.id); }
        added += r.added.length; merged += r.merged; maybe += r.maybe;
        c.lastSync = new Date().toISOString();
        c.firstDone = true;
        c.error = null;
      } catch (e) {
        failed++;
        if (e.status === 429 || e.code === 'ASPSP_RATE_LIMIT_EXCEEDED') c.cooldownUntil = new Date(Date.now() + COOLDOWN).toISOString();
        c.error = syncErrorText(e);
      }
    }
    if (fresh.size || merged) classify(app.state, fresh);
  } finally {
    ui.syncing = false;
    bankSave();
    save();
  }
  const parts = [];
  if (added) parts.push(`<span class="ok">${plural(added, 'movimiento nuevo', 'movimientos nuevos')}</span>`);
  if (merged) parts.push(`<span class="muted">${plural(merged, 'ya estaba importado', 'ya estaban importados')} de un extracto</span>`);
  if (maybe) parts.push(`<span class="warn">${plural(maybe, 'posible duplicado', 'posibles duplicados')} en «Por revisar»</span>`);
  if (!parts.length && !failed) parts.push('<span class="muted">No hay movimientos nuevos</span>');
  ui.bankMsg = parts.join(' · ');
  app.render();
}

export function maybeAutoSync() {
  if (!hasServer() || ui.syncing) return;
  if (app.bank.conns.some((c) => dueForSync(c))) syncAll();
}

// The old way back from the bank (?code=… in the app's address), still used when the server has no KV.
export async function handleReturn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), err = q.get('error');
  if (!code && !err) return null;
  history.replaceState(null, '', appUrl());
  const pa = app.bank.pendingAuth;
  if (err) { app.bank.pendingAuth = null; bankSave(); ui.bankMsg = `<span class="err">El banco no completó la autorización (${esc(q.get('error_description') || err)}).</span>`; return 'error'; }
  if (hasServer() && pa && pa.state === q.get('state')) {
    try { await finishWithCode(code); } catch (e) { ui.bankMsg = `<span class="err">${esc(e.message)}</span>`; }
    return 'done';
  }
  return { code }; // opened in another browser (on the iPhone: Safari instead of the app)
}
