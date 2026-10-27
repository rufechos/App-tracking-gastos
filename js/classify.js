// Puts every movement you have not set by hand in its category.
// Order: your choice > your rules > transfers between your accounts > refunds > keywords and merchant code.
import { categorize } from './categories.js';
import { detectTransfers } from './accounts.js';
import { isRefund, matchRefund } from './refunds.js';

const AUTO_REVIEW = { none: 'otros', generic: 'generic' };

// fresh: ids of movements that just arrived; only they get new «Por revisar» flags.
export function classify(state, fresh = null) {
  const kindOf = (id) => (state.cats.find((c) => c.id === id) || {}).kind;
  const ctx = { cats: state.cats, rules: state.rules };
  const base = new Map(state.tx.map((t) => [t.id, categorize(t, ctx)]));
  const lite = state.tx.filter((t) => !t.manual || t.cat === 'excluir').map((t) => ({
    id: t.id, date: t.date, amount: t.amount, concept: t.concept, cpIban: t.cpIban, cpName: t.cpName, acct: t.acct, fid: t.fid, src: t.src, baseCat: base.get(t.id).cat,
  }));
  const transfers = detectTransfers(lite, state.accounts || [], (state.settings && state.settings.owners) || []);
  const later = [];
  for (const t of state.tx) {
    const b = base.get(t.id), tr = transfers.get(t.id);
    if (tr && tr.pair) t.pair = tr.pair; else delete t.pair;
    if (t.manual) { t.conf = 'manual'; continue; }
    let cat = b.cat, conf = b.conf, rv = null;
    if (conf !== 'rule' && tr) { cat = tr.cat; conf = 'transfer'; rv = tr.rv || null; }
    else if (conf !== 'rule' && isRefund(t)) { later.push(t); continue; }
    apply(t, cat, conf, rv, fresh);
  }
  // Refunds look at the purchases' final categories.
  for (const t of later) {
    const m = matchRefund(t, state.tx, kindOf);
    if (m) apply(t, m.cat, 'refund', null, fresh, m.of);
    else apply(t, 'devoluciones', 'kw', 'refund', fresh);
  }
}

function apply(t, cat, conf, rv, fresh, refundOf) {
  t.cat = cat;
  t.conf = conf;
  if (refundOf) t.of = refundOf; else delete t.of;
  const flag = rv || AUTO_REVIEW[conf] || null;
  if (fresh && fresh.has(t.id)) { if (flag && !t.rv) t.rv = flag; }
  else if ((t.rv === 'otros' || t.rv === 'generic') && !AUTO_REVIEW[conf]) delete t.rv;
}
