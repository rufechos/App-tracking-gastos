// Fixed charges and subscriptions: the same merchant charging every month (or quarter, or year) a similar amount.
import { addDays, dayDiff, localIso, round2 } from './util.js';
import { suggestKw } from './categories.js';

export const PERIODS = [
  { id: 'mensual', label: 'al mes', days: 30.44, tol: 6, perYear: 12, min: 3 },
  { id: 'trimestral', label: 'al trimestre', days: 91.3, tol: 12, perYear: 4, min: 3 },
  { id: 'anual', label: 'al año', days: 365.25, tol: 20, perYear: 1, min: 2 },
];
const median = (v) => { const s = v.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// -> [{ key, name, cat, period, amount, avg, yearly, last, next, n, variable, rise }] most expensive first.
// rise: { from, to, pct } when the last charge is dearer than the usual one.
export function recurring(state, kindOf, today = localIso()) {
  const from = addDays(today, -800), groups = new Map();
  for (const t of state.tx) {
    if (t.amount >= 0 || t.date < from || t.date > today || kindOf(t.cat) !== 'gasto' || t.cat === 'efectivo') continue;
    const key = suggestKw(t.concept);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, all] of groups) {
    const list = all.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (list.length < 2) continue;
    const gaps = list.slice(1).map((t, i) => dayDiff(list[i].date, t.date));
    const g = median(gaps);
    const p = PERIODS.find((x) => Math.abs(g - x.days) <= x.tol);
    if (!p) continue;
    const fit = gaps.filter((d) => Math.abs(d - p.days) <= p.tol).length;
    // Recent charges count most: from the last run of regular gaps.
    let start = list.length - 1;
    while (start > 0 && Math.abs(gaps[start - 1] - p.days) <= p.tol) start--;
    const run = list.slice(start);
    if (run.length < p.min || fit < gaps.length * 0.6) continue;
    const last = run[run.length - 1];
    if (dayDiff(last.date, today) > p.days + 2 * p.tol) continue; // stopped
    const amounts = run.map((t) => -t.amount);
    const spread = (v) => (Math.max(...v) - Math.min(...v)) / median(v);
    if (spread(amounts) > 0.8) continue; // not one charge but different purchases at the same shop
    const amount = amounts[amounts.length - 1], avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    // The charges at the current price, and the ones before: a stable price before and a new one now is a rise.
    let j = amounts.length - 1;
    while (j > 0 && Math.abs(amounts[j - 1] - amount) <= amount * 0.02) j--;
    const before = amounts.slice(0, j), usual = before.length ? median(before) : amount;
    const variable = before.length > 1 && spread(before) > 0.1;
    const rise = !variable && before.length && amount > usual * 1.02 && dayDiff(run[j].date, today) <= 186 ? { from: usual, to: amount, pct: ((amount - usual) / usual) * 100, since: run[j].date } : null;
    out.push({
      key, name: last.concept, cat: last.cat, period: p.id, label: p.label, amount, avg: round2(avg),
      yearly: round2((variable ? avg : amount) * p.perYear), last: last.date, next: addDays(last.date, Math.round(p.days)), n: run.length, variable, rise,
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}
