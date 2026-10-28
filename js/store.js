// Everything the app keeps, in this device's storage. The bank settings (with the server key) live apart,
// so that a backup never carries the key.
import { DEFAULT_CATS, defaultCatsLite, KINDS } from './categories.js';
import { ACCOUNT_KINDS } from './accounts.js';
import { migrateV1 } from './migrate.js';
import { classify } from './classify.js';
import { sampleTx, sampleInv } from './sample.js';
import { uid } from './util.js';
import { DEFAULT_PAYDAY, usePayday } from './aggregate.js';

export const LS = 'cuaderno-gastos-v1';
export const LSB = 'cuaderno-gastos-banco';
export const VERSION = 2;

export const emptyInv = () => ({ positions: [], history: [], lastQuote: null });
export const emptyState = () => ({ v: VERSION, tx: [], cats: defaultCatsLite(), rules: [], accounts: [], files: [], sample: false, inv: emptyInv(), settings: { owners: [], lastBackup: null, payday: { ...DEFAULT_PAYDAY } } });
export const emptyBank = () => ({ server: '', token: '', conns: [], pendingAuth: null });

export const app = {
  state: emptyState(),
  bank: emptyBank(),
  saveError: null,
  render: () => {}, // set by main.js
  onSaveError: () => {},
};

// Ids end up inside the page's HTML: anything unusual (e.g. from an edited backup) gets a new one.
const SAFE_ID = /^[\w.:-]{1,80}$/;
export const safeId = (id) => typeof id === 'string' && SAFE_ID.test(id);
function safeIds(list, prefix, refs) {
  for (const x of list) {
    if (x.id && SAFE_ID.test(x.id)) continue;
    const old = x.id;
    x.id = prefix + uid();
    if (old) refs(old, x.id);
  }
}

export function normalizeState(s) {
  const st = Object.assign(emptyState(), s);
  st.settings = Object.assign({ owners: [], lastBackup: null }, s.settings || {});
  st.settings.payday = Object.assign({}, DEFAULT_PAYDAY, st.settings.payday || {});
  for (const t of st.tx) if (t.mm != null && !/^\d{4}-\d{2}$/.test(t.mm)) delete t.mm;
  st.inv = Object.assign(emptyInv(), s.inv || {});
  for (const d of DEFAULT_CATS) if (!st.cats.some((c) => c.id === d.id)) st.cats.push({ id: d.id, name: d.name, kind: d.kind });
  st.accounts = st.accounts || [];
  st.files = st.files || [];
  safeIds(st.tx, '', () => {});
  safeIds(st.cats, 'c_', (a, b) => { for (const t of st.tx) if (t.cat === a) t.cat = b; for (const r of st.rules) if (r.cat === a) r.cat = b; });
  safeIds(st.accounts, 'a_', (a, b) => { for (const t of st.tx) if (t.acct === a) t.acct = b; for (const f of st.files) if (f.acct === a) f.acct = b; });
  safeIds(st.files, 'f_', (a, b) => { for (const t of st.tx) if (t.fid === a) t.fid = b; });
  safeIds(st.inv.positions, 'p_', () => {});
  for (const c of st.cats) if (!KINDS.includes(c.kind)) c.kind = 'gasto';
  for (const a of st.accounts) if (!ACCOUNT_KINDS[a.kind]) a.kind = 'banco';
  return st;
}

usePayday(() => app.state.settings.payday || DEFAULT_PAYDAY);

export function upgrade(raw) {
  let s = raw;
  if (!s.v || s.v < 2) {
    s = migrateV1(Object.assign({}, s, { tx: (s.tx || []).map((t) => ({ ...t })) }));
    s = normalizeState(s);
    s.v = VERSION;
    classify(s);
    return s;
  }
  return normalizeState(s);
}

export function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.tx)) { app.state = upgrade(s); return true; }
    }
  } catch (e) { /* unreadable data: start with the example */ }
  return false;
}

export function loadSample() {
  const s = emptyState();
  s.sample = true;
  s.tx = sampleTx();
  s.inv = sampleInv();
  classify(s);
  app.state = s;
}

export function save() {
  try {
    localStorage.setItem(LS, JSON.stringify(app.state));
    if (app.saveError) { app.saveError = null; app.onSaveError(null); }
    return true;
  } catch (e) {
    app.saveError = e;
    app.onSaveError(e);
    return false;
  }
}

export function bankLoad() {
  try {
    const b = JSON.parse(localStorage.getItem(LSB) || 'null');
    if (b) app.bank = Object.assign(emptyBank(), b);
  } catch (e) { /* keep defaults */ }
  for (const c of app.bank.conns) if (!safeId(c.id)) c.id = 'c_' + uid();
}
export function bankSave() {
  try { localStorage.setItem(LSB, JSON.stringify(app.bank)); return true; }
  catch (e) { app.saveError = e; app.onSaveError(e); return false; }
}

// Leave the example: the first real statement or bank replaces it.
export function leaveSample() {
  if (!app.state.sample) return;
  const s = emptyState();
  s.rules = app.state.rules;
  s.cats = app.state.cats;
  app.state = s;
}

// «Borrar todos los datos»: also forget the sync position, so the next sync brings the history back.
export function resetAll() {
  app.state = emptyState();
  for (const c of app.bank.conns) { c.lastSync = null; c.firstDone = false; c.error = null; }
  bankSave();
  save();
}

// Ask the browser not to evict this app's data under storage pressure (Safari grants it to home-screen apps).
export async function persistStorage() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist(); }
  catch (e) { /* not supported */ }
  return null;
}
