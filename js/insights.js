// Comparisons: each category against its usual month, a category month by month and the summary of each year.
import { addMonths, monthOf } from './util.js';
import { agg, byMonth } from './aggregate.js';

// Spending of each category in `month` against its average of the 6 months before (only months with movements).
export function vsAverage(state, kindOf, month, n = 6) {
  const per = byMonth(state.tx), sums = {};
  let k = 0;
  for (let i = 1; i <= n; i++) {
    const l = per.get(addMonths(month, -i));
    if (!l) continue;
    k++;
    for (const [id, v] of Object.entries(agg(l, kindOf).e)) sums[id] = (sums[id] || 0) + v;
  }
  const now = agg(per.get(month) || [], kindOf).e, out = {};
  if (!k) return out;
  for (const id of new Set([...Object.keys(now), ...Object.keys(sums)])) {
    const avg = (sums[id] || 0) / k, v = now[id] || 0;
    out[id] = { v, avg, diff: v - avg, pct: avg > 0 ? ((v - avg) / avg) * 100 : null, months: k };
  }
  return out;
}

export function catSeries(state, kindOf, id, months) {
  const per = byMonth(state.tx);
  return months.map((m) => {
    const a = agg(per.get(m) || [], kindOf);
    return a.e[id] || a.inc[id] || 0;
  });
}

// One row per year: income, expenses, savings, savings rate, invested and the months with movements.
export function yearSummary(state, kindOf) {
  const years = new Map();
  for (const [m, l] of byMonth(state.tx)) {
    const y = m.slice(0, 4), a = agg(l, kindOf);
    const r = years.get(y) || { year: y, ti: 0, te: 0, tinv: 0, months: 0 };
    r.ti += a.ti; r.te += a.te; r.tinv += a.tinv; r.months++;
    years.set(y, r);
  }
  return [...years.values()].sort((a, b) => b.year.localeCompare(a.year)).map((r) => ({ ...r, saved: r.ti - r.te, rate: r.ti > 0 ? ((r.ti - r.te) / r.ti) * 100 : null }));
}

export const lastMonths = (today, n = 12) => Array.from({ length: n }, (_, i) => addMonths(monthOf(today), i - n + 1));
