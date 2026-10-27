// Notifications on the iPhone, sent by your server when it looks at your banks (three times a day).
// The server gets only what it needs for that: the bank accounts to look at, your own IBANs and names
// (a transfer to yourself is not an expense), what is left of each budget with words that recognise its
// movements, and the recent movements the app already has (not news, and already counted).
import { budgetStatus } from './budgets.js';
import { suggestKw, strongKw, STOP } from './categories.js';
import { norm, round2, addDays, monthOf, localIso } from './util.js';

export const PUSH_DEFAULTS = { big: 100, budget: true, expiry: true };

// Words that recognise a category's movements: your rules, the shops you actually use, then the usual names.
export function catKeywords(state, id, today = localIso(), max = 80) {
  const from = addDays(today, -183), freq = new Map();
  for (const t of state.tx) {
    if (t.cat !== id || t.date < from) continue;
    const k = suggestKw(t.concept);
    if (k.length > 2 && !STOP.has(k)) freq.set(k, (freq.get(k) || 0) + 1);
  }
  const mine = [...freq].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const rules = state.rules.filter((r) => r.cat === id && r.sign !== 'ingreso').map((r) => norm(r.kw));
  return [...new Set([...rules, ...mine, ...strongKw(id)])].filter((k) => k.length > 1 && k.length <= 40).slice(0, max);
}

export function pushPayload(state, bank, prefs, today = localIso()) {
  const kindOf = (id) => (state.cats.find((c) => c.id === id) || {}).kind;
  const name = (id) => (state.cats.find((c) => c.id === id) || {}).name || id;
  const accounts = state.accounts || [];
  const own = {
    ibans: accounts.map((a) => a.iban).filter(Boolean),
    names: [...new Set([...accounts.flatMap((a) => a.aliases || []), ...(state.settings.owners || [])].map(norm))]
      .filter((n) => n.length > 3 || n.includes(' ')),
  };
  const st = prefs.budget ? budgetStatus(state, kindOf, monthOf(today), today) : null;
  const watch = st ? { month: st.month, cats: st.rows.map((r) => ({ id: r.id, name: name(r.id), limit: r.limit, left: round2(r.left), kws: catKeywords(state, r.id, today) })) } : null;
  const from = addDays(today, -5);
  const known = state.tx.filter((t) => t.amount < 0 && t.date >= from && t.date <= today).slice(-300).map((t) => ({ d: t.date, a: t.amount, r: t.ref || '' }));
  return {
    prefs: { big: prefs.big > 0 ? prefs.big : 0, budget: !!prefs.budget, expiry: !!prefs.expiry },
    conns: bank.conns.map((c) => ({ id: c.id, name: c.aspsp.name, valid_until: c.valid_until || null, accounts: c.accounts.map((a) => ({ uid: a.uid })) })),
    own, watch, known,
  };
}

// To tell whether the server already has the latest (FNV-1a, 32 bits).
export function payloadHash(p) {
  let h = 0x811c9dc5;
  const s = JSON.stringify(p);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
