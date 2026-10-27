// Recognising the same movement twice: in two overlapping statements, or in a statement and in the bank sync.
import { norm, cents, dayDiff } from './util.js';
import { STOP } from './categories.js';

export function tokens(concept) {
  return new Set(norm(concept).split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/\d/.test(w)));
}
// Share of the shorter concept's words found in the other one (1 = all of them).
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export const fileKey = (t) => t.date + '|' + t.amount.toFixed(2) + '|' + norm(t.concept);

// Stable key for a synced movement: the bank's own reference (immutable per account) or, without one, date, amount
// and concept plus the position among identical movements of that day. Never transaction_id, which can change.
export function withBankKeys(list, acctId) {
  const seen = {};
  for (const t of list) {
    if (t.ref) { t.ext = 'eb:' + acctId + ':r:' + t.ref; continue; }
    const base = 'eb:' + acctId + ':' + (t.bdate || t.date) + '|' + t.amount.toFixed(2) + '|' + norm(t.concept);
    seen[base] = (seen[base] || 0) + 1;
    t.ext = base + '#' + seen[base];
  }
  return list;
}

// Same amount within maxDays in a compatible account. 'sure' when the dates agree and so do the concepts or
// the account; otherwise 'maybe', which goes to «Por revisar» instead of being dropped.
export function findTwin(nt, pool, used, maxDays = 3) {
  let best = null;
  for (const e of pool) {
    if (used.has(e.id) || cents(e.amount) !== cents(nt.amount)) continue;
    const dd = Math.abs(dayDiff(e.date, nt.date));
    if (dd > maxDays) continue;
    if (e.acct && nt.acct && e.acct !== nt.acct) continue;
    const sim = similarity(e.concept, nt.concept);
    const sameAcct = !!(e.acct && nt.acct && e.acct === nt.acct);
    const level = (dd === 0 && (sim >= 0.5 || sameAcct)) || (dd === 1 && sim >= 0.5) ? 'sure' : 'maybe';
    const score = (level === 'sure' ? 100 : 0) - dd * 10 + sim * 5;
    if (!best || score > best.score) best = { tx: e, level, score };
  }
  return best;
}

// Pairs each new movement with at most one existing one: same-day matches first, then up to 3 days apart.
export function matchBatch(items, pool) {
  const used = new Set(), out = new Map();
  for (const maxDays of [0, 3]) {
    for (const it of items) {
      if (out.has(it)) continue;
      const m = findTwin(it, pool, used, maxDays);
      if (m) { used.add(m.tx.id); out.set(it, m); }
    }
  }
  return out;
}
