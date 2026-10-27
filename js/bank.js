// Bank sync through Enable Banking (via your server): connections, first full download, stable keys,
// pauses after a rate limit, and matching against movements you already imported from files.
import { norm, round2, addDays, localIso, cleanIban, uid } from './util.js';
import { withBankKeys, matchBatch } from './dedup.js';
import { makeAccount, guessAccount } from './accounts.js';

export const AUTO_INTERVAL = 30 * 60e3; // automatic sync when you open the app, per bank
export const COOLDOWN = 6 * 3600e3; // after the bank says "too many requests"
export const EXPIRY_WARN_DAYS = 7;
const MAX_CALLS = 40; // pages of a single account per sync

// One Enable Banking transaction -> fields of a movement, or null (pending, zero, unreadable).
export function ebToTx(t) {
  if (t.status && t.status !== 'BOOK') return null;
  const raw = parseFloat(t.transaction_amount && t.transaction_amount.amount);
  if (!isFinite(raw) || raw === 0) return null;
  const ind = t.credit_debit_indicator;
  const sign = ind === 'DBIT' ? -1 : ind === 'CRDT' ? 1 : Math.sign(raw);
  const amount = round2(sign * Math.abs(raw));
  const pick = (...v) => v.map((x) => String(x || '').slice(0, 10)).find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const date = pick(t.transaction_date, t.value_date, t.booking_date); // operation date, as statements show it
  if (!date) return null;
  const party = sign < 0 ? t.creditor : t.debtor, partyAcct = sign < 0 ? t.creditor_account : t.debtor_account;
  const cpName = (party && party.name) || '';
  const rem = (t.remittance_information || []).join(' ').replace(/\s+/g, ' ').trim();
  const parts = [cpName, rem, t.note].map((v) => (v || '').trim()).filter(Boolean);
  // A part already contained in another one goes ("MERCADONA SA" in "MERCADONA SA VALENCIA").
  const concept = parts.filter((v, i) => !parts.some((p, j) => j !== i && norm(p).includes(norm(v)) && (norm(p) !== norm(v) || j < i))).join(' · ')
    || (t.bank_transaction_code && t.bank_transaction_code.description) || '(sin concepto)';
  const out = { date, concept, amount };
  const bdate = pick(t.booking_date);
  if (bdate && bdate !== date) out.bdate = bdate;
  if (t.entry_reference) out.ref = String(t.entry_reference);
  if (t.merchant_category_code) out.mcc = String(t.merchant_category_code);
  const iban = cleanIban(partyAcct && partyAcct.iban);
  if (iban) out.cpIban = iban;
  if (cpName) out.cpName = cpName;
  return out;
}

const kindFromEb = (a, bankName) => {
  if (a.cash_account_type === 'CARD') return 'tarjeta';
  if (a.cash_account_type === 'SVGS') return 'ahorro';
  const g = guessAccount(bankName);
  return g.kind === 'tarjeta' && a.cash_account_type === 'CACC' ? 'banco' : g.kind;
};

// After authorising: map each bank account to one of «Mis cuentas» (the same one again after a renewal,
// recognised by the bank's stable account hash or the IBAN).
export function linkAccounts(session, aspsp, accounts) {
  return (session.accounts || []).map((a) => {
    const iban = cleanIban(a.account_id && a.account_id.iban);
    const hash = a.identification_hash || '';
    let acc = accounts.find((x) => (hash && x.ebHash === hash) || (iban && x.iban === iban));
    const label = a.name || a.product || a.details || '';
    if (!acc) {
      const g = guessAccount(aspsp.name);
      acc = makeAccount({ name: aspsp.name + (label && norm(label) !== norm(aspsp.name) ? ' · ' + label : ''), kind: kindFromEb(a, aspsp.name), iban, aliases: g.aliases, ebHash: hash || undefined });
      accounts.push(acc);
    } else {
      if (hash && !acc.ebHash) acc.ebHash = hash;
      if (iban && !acc.iban) acc.iban = iban;
    }
    return { uid: a.uid, acctId: acc.id, name: label, iban, hash, currency: a.currency || 'EUR' };
  });
}

export function makeConnection(session, aspsp, accounts, prev) {
  return {
    id: (prev && prev.id) || 'c_' + uid(),
    aspsp: { name: aspsp.name, country: aspsp.country || 'ES' },
    session_id: session.session_id,
    accounts: linkAccounts(session, aspsp, accounts),
    valid_until: (session.access && session.access.valid_until) || null,
    authAt: new Date().toISOString(),
    lastSync: (prev && prev.lastSync) || null,
    firstDone: false,
    cooldownUntil: null,
    error: null,
  };
}

export const expired = (c, now = Date.now()) => !!(c.valid_until && new Date(c.valid_until).getTime() < now);
export const expiresSoon = (c, now = Date.now()) => !!(c.valid_until && !expired(c, now) && new Date(c.valid_until).getTime() - now < EXPIRY_WARN_DAYS * 864e5);
export const coolingDown = (c, now = Date.now()) => !!(c.cooldownUntil && new Date(c.cooldownUntil).getTime() > now);
export const dueForSync = (c, now = Date.now()) => !expired(c, now) && !coolingDown(c, now) && (!c.firstDone || !c.lastSync || now - new Date(c.lastSync).getTime() > AUTO_INTERVAL);

// Downloads one account. First time after authorising: the longest history the bank gives (many only give more
// than 90 days during the first hour). Later: from 7 days before the last sync.
async function fetchAccount(api, c, a, now) {
  const first = !c.firstDone || !c.lastSync;
  let params = first ? { strategy: 'longest' } : { date_from: addDays(localIso(new Date(c.lastSync)), -7) };
  const all = [];
  let key = null, calls = 0, retried = false;
  for (;;) {
    let d;
    try {
      d = await api('/transactions', { query: { account: a.uid, ...params, continuation_key: key, psu: 1 } });
    } catch (e) {
      if (!retried && !key && (e.code === 'WRONG_TRANSACTIONS_PERIOD' || e.status === 422 || e.status === 400)) {
        retried = true;
        params = { date_from: addDays(localIso(new Date(now)), -89) };
        continue;
      }
      throw e;
    }
    all.push(...(d.transactions || []));
    key = d.continuation_key || null;
    if (!key || ++calls >= MAX_CALLS) break;
  }
  return all;
}

// -> { added: [new movements], merged, maybe }  Movements already present (same key) are skipped; a movement
// you imported from a file is recognised and adopts the bank's key; a doubtful match goes to «Por revisar».
export async function syncConnection(api, state, c, now = Date.now()) {
  const res = { added: [], merged: 0, maybe: 0 };
  const have = new Set(state.tx.filter((t) => t.ext).map((t) => t.ext));
  for (const a of c.accounts || []) {
    const raw = await fetchAccount(api, c, a, now);
    const list = withBankKeys(raw.map(ebToTx).filter(Boolean), a.acctId || a.uid)
      .filter((x) => !have.has(x.ext) && have.add(x.ext))
      .map((x) => ({ ...x, acct: a.acctId }));
    const pool = state.tx.filter((t) => !t.ext && (!t.acct || t.acct === a.acctId));
    const twins = matchBatch(list, pool);
    for (const nt of list) {
      const twin = twins.get(nt);
      if (twin && twin.level === 'sure') {
        twin.tx.ext = nt.ext;
        if (!twin.tx.acct) twin.tx.acct = a.acctId;
        for (const k of ['ref', 'mcc', 'cpIban', 'cpName', 'bdate']) if (nt[k] && !twin.tx[k]) twin.tx[k] = nt[k];
        res.merged++;
        continue;
      }
      const t = { id: uid(), ...nt, src: c.aspsp.name + (c.accounts.length > 1 && a.name ? ' · ' + a.name : ''), cat: null };
      if (twin) { t.rv = 'dup'; t.dupOf = twin.tx.id; res.maybe++; }
      res.added.push(t);
    }
  }
  return res;
}

// What to tell the user about a failed sync.
export function syncErrorText(e) {
  if (e.status === 429 || e.code === 'ASPSP_RATE_LIMIT_EXCEEDED') return 'El banco pide esperar: lo intentaré de nuevo dentro de 6 horas.';
  if (e.status === 401) return 'La clave de acceso del servidor no es correcta.';
  if (e.status === 403 || e.code === 'EXPIRED_SESSION' || e.code === 'SESSION_DOES_NOT_EXIST') return 'El banco ha retirado el permiso. Vuelve a autorizarlo.';
  return e.message || String(e);
}
