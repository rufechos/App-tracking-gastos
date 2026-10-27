// Net worth: what each of your accounts holds plus your investments, month by month. An account's balance comes
// from the bank, from a statement with a balance column or from you; earlier months are rebuilt backwards from
// it with the account's movements.
import { daysInMonth, localIso, monthOf, round2 } from './util.js';
import { portfolioCosts } from './invest.js';

// Booked balances first: "available" ones may include the credit line.
const ORDER = ['CLBD', 'ITBD', 'XPCD', 'OTHR', 'PRCD', 'ITAV', 'CLAV', 'OPBD', 'FWAV', 'OPAV', 'INFO'];
export function pickBalance(list) {
  const ok = (list || []).filter((b) => b && b.balance_amount && isFinite(parseFloat(b.balance_amount.amount)) && (b.balance_amount.currency || 'EUR') === 'EUR');
  const rank = (b) => (ORDER.includes(b.balance_type) ? ORDER.indexOf(b.balance_type) : ORDER.length) + (b.credit_limit_included ? 100 : 0);
  ok.sort((x, y) => rank(x) - rank(y));
  return ok.length ? { v: round2(parseFloat(ok[0].balance_amount.amount)), type: ok[0].balance_type || null } : null;
}

// The balance after the last movement of the newest day in your statements: the one that no other movement
// of that day starts from (statements list a day's movements newest or oldest first).
export function statementBalance(state, acctId) {
  let d = null;
  for (const t of state.tx) if (t.acct === acctId && t.bal != null && (!d || t.date > d)) d = t.date;
  if (!d) return null;
  const day = state.tx.filter((t) => t.acct === acctId && t.bal != null && t.date === d);
  const starts = new Set(day.map((t) => round2(t.bal - t.amount)));
  const end = day.find((t) => !starts.has(round2(t.bal))) || day[day.length - 1];
  return { v: end.bal, d, src: 'extracto' };
}

// The newest balance known for an account: the bank's or yours (a.bal), or a statement's.
export function accountBalance(state, a) {
  const st = statementBalance(state, a.id), own = a.bal && isFinite(a.bal.v) && a.bal.d ? a.bal : null;
  return own && (!st || own.d >= st.d) ? own : st;
}

// Balance at the end of `day`, from an anchor { v, d } and the account's movements.
export function balanceAt(txs, anchor, day) {
  let v = anchor.v;
  for (const t of txs) {
    if (t.date > anchor.d && t.date <= day) v += t.amount;
    else if (t.date > day && t.date <= anchor.d) v -= t.amount;
  }
  return round2(v);
}

export function worthNow(state, today = localIso()) {
  const rows = state.accounts.map((a) => {
    const anchor = accountBalance(state, a);
    return { a, anchor, v: anchor ? balanceAt(state.tx.filter((t) => t.acct === a.id), anchor, today) : null };
  });
  const cash = round2(rows.reduce((s, r) => s + (r.v || 0), 0));
  const inv = state.inv.positions.length ? round2(portfolioCosts(state.inv, today).net) : 0;
  return { rows, cash, inv, total: round2(cash + inv), missing: rows.filter((r) => r.v == null).length };
}

const valueAt = (history, day) => { let v = null; for (const h of history || []) if (h.d <= day) v = h.v; return v; };

// Month-end totals. An account counts from the month of its first movement (or of its balance).
export function worthSeries(state, months, today = localIso()) {
  const accts = state.accounts.map((a) => {
    const anchor = accountBalance(state, a), txs = state.tx.filter((t) => t.acct === a.id);
    const from = txs.reduce((m, t) => (t.date < m ? t.date : m), anchor ? anchor.d : '9999');
    return { anchor, txs, from: from.slice(0, 7) };
  }).filter((x) => x.anchor);
  return months.map((m) => {
    const end = m === monthOf(today) ? today : m + '-' + daysInMonth(m);
    let cash = 0;
    for (const x of accts) if (x.from <= m) cash += balanceAt(x.txs, x.anchor, end);
    const inv = valueAt(state.inv.history, end);
    return { m, cash: round2(cash), inv, total: round2(cash + (inv || 0)) };
  });
}
