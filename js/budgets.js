// Monthly budgets per expense category: proposed from your last 6 months, with how fast this month is going.
import { addMonths, daysInMonth, monthOf, localIso } from './util.js';
import { agg, byMonth } from './aggregate.js';

// Average spending per category over the last 6 complete months that have movements, rounded up to 10 €.
export function averages(state, kindOf, today = localIso(), months = 6) {
  const cur = monthOf(today), per = byMonth(state.tx), sums = {};
  let n = 0;
  for (let i = 1; i <= months; i++) {
    const l = per.get(addMonths(cur, -i));
    if (!l) continue;
    n++;
    for (const [id, v] of Object.entries(agg(l, kindOf).e)) sums[id] = (sums[id] || 0) + v;
  }
  const out = {};
  if (n) for (const [id, v] of Object.entries(sums)) out[id] = v / n;
  return out;
}

export function proposeBudgets(state, kindOf, today = localIso()) {
  const out = {};
  for (const [id, v] of Object.entries(averages(state, kindOf, today))) if (v >= 10) out[id] = Math.ceil(v / 10) * 10;
  return out;
}

// How each budget is going in `month`. pace: share of the month gone (today's day / days of the month).
// 'over' past the limit; 'fast' when the share spent runs well ahead of the share of the month gone.
export function budgetStatus(state, kindOf, month, today = localIso()) {
  const b = state.budgets || {};
  const ids = Object.keys(b).filter((id) => b[id] > 0 && kindOf(id) === 'gasto');
  if (!ids.length) return null;
  const a = agg(state.tx.filter((t) => t.date.startsWith(month)), kindOf);
  const cur = monthOf(today), dim = daysInMonth(month);
  const day = month === cur ? +today.slice(8, 10) : month < cur ? dim : 0;
  const pace = day / dim;
  const rows = ids.map((id) => {
    const limit = b[id], spent = Math.max(0, a.e[id] || 0), used = spent / limit;
    const st = used > 1 ? 'over' : month === cur && used >= 0.25 && used > pace + 0.15 ? 'fast' : 'ok';
    return { id, limit, spent, used, left: limit - spent, state: st };
  }).sort((x, y) => y.used - x.used);
  const limit = rows.reduce((s, r) => s + r.limit, 0), spent = rows.reduce((s, r) => s + r.spent, 0);
  return { month, current: month === cur, day, dim, pace, rows, limit, spent };
}
