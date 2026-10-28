// Adding the movements of a statement file: exact repeats of what you already have are ignored; the same
// movement synced from the bank or in another overlapping statement is recognised; doubtful cases go to review.
import { uid, cleanIban } from './util.js';
import { fileKey, matchBatch } from './dedup.js';
import { makeAccount, bankFromIban } from './accounts.js';

export function accountForIban(state, iban) {
  const v = cleanIban(iban);
  if (!v) return null;
  let a = state.accounts.find((x) => x.iban === v);
  if (!a) {
    a = makeAccount({ name: bankFromIban(v) || 'Cuenta ' + v.slice(-4), iban: v });
    state.accounts.push(a);
  }
  return a.id;
}

const rangeOf = (list) => {
  let lo = null, hi = null;
  for (const t of list) { if (!lo || t.date < lo) lo = t.date; if (!hi || t.date > hi) hi = t.date; }
  return [lo, hi];
};

// parsed: { tx: [{date, concept, amount, bal?, mcc?, cpName?, cpIban?}], iban }; meta: { name, acct? } -> { entry, fresh }
export function importStatement(state, parsed, meta) {
  const fid = 'f_' + uid();
  const entry = { id: fid, name: meta.name, added: 0, dup: 0, maybe: 0, flipped: false, error: null, at: new Date().toISOString() };
  let rows = parsed.tx.map((r) => ({ ...r }));
  if (!rows.length) throw new Error('No he encontrado movimientos en el archivo.');
  // Card statements often list every charge as a positive number.
  if (rows.length > 3 && rows.every((r) => r.amount > 0)) { rows.forEach((r) => { r.amount = -r.amount; }); entry.flipped = true; }
  const acct = meta.acct || accountForIban(state, parsed.iban) || null;
  entry.acct = acct;

  const have = {};
  for (const t of state.tx) { const k = fileKey(t); have[k] = (have[k] || 0) + 1; }
  const seen = {}, fresh = [];
  for (const r of rows) {
    const k = fileKey(r);
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] <= (have[k] || 0)) { entry.dup++; continue; }
    fresh.push({ ...r, acct });
  }
  // Fuzzy matches: against synced movements, and against other statements covering the same dates.
  const [lo, hi] = rangeOf(fresh);
  const ranges = {};
  for (const t of state.tx) if (t.fid) { const r = ranges[t.fid] || (ranges[t.fid] = [t.date, t.date]); if (t.date < r[0]) r[0] = t.date; if (t.date > r[1]) r[1] = t.date; }
  const pool = state.tx.filter((t) => (t.ext || (t.fid && ranges[t.fid][0] <= hi && ranges[t.fid][1] >= lo)) && (!t.acct || !acct || t.acct === acct));
  const twins = matchBatch(fresh, pool);
  const ids = new Set();
  for (const r of fresh) {
    const twin = twins.get(r);
    if (twin && twin.level === 'sure') { entry.dup++; if (acct && !twin.tx.acct) twin.tx.acct = acct; continue; }
    const t = { id: uid(), date: r.date, concept: r.concept, amount: r.amount, cat: null, src: meta.name, fid, acct: acct || undefined };
    if (r.bal != null) t.bal = r.bal;
    for (const k of ['mcc', 'cpName', 'cpIban']) if (r[k]) t[k] = r[k];
    if (!t.acct) delete t.acct;
    if (twin) { t.rv = 'dup'; t.dupOf = twin.tx.id; entry.maybe++; }
    state.tx.push(t);
    ids.add(t.id);
    entry.added++;
  }
  state.files.push(entry);
  return { entry, fresh: ids };
}

// Assign every movement of a statement to one of «Mis cuentas» (statements without an IBAN).
export function setFileAccount(state, fid, acct) {
  const f = state.files.find((x) => x.id === fid);
  if (f) f.acct = acct || null;
  for (const t of state.tx) if (t.fid === fid) { if (acct) t.acct = acct; else delete t.acct; }
}

export function removeFile(state, fid) {
  state.tx = state.tx.filter((t) => t.fid !== fid);
  state.files = state.files.filter((f) => f.id !== fid);
}
