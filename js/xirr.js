// Money-weighted annual return (as XIRR in a spreadsheet): the rate r with Σ amount / (1 + r)^(days / 365) = 0.
// flows: [{ date: 'YYYY-MM-DD', amount }], money you put in negative, money you get back (or still hold) positive.
import { dayDiff } from './util.js';

export function xirr(flows) {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = flows.reduce((a, f) => (f.date < a ? f.date : a), flows[0].date);
  const cf = flows.map((f) => ({ y: dayDiff(t0, f.date) / 365, a: f.amount }));
  const npv = (r) => cf.reduce((s, f) => s + f.a / Math.pow(1 + r, f.y), 0);
  const d = (r) => cf.reduce((s, f) => s - (f.y * f.a) / Math.pow(1 + r, f.y + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r), dv = d(r);
    if (!isFinite(v) || !isFinite(dv) || dv === 0) break;
    const next = r - v / dv;
    if (next <= -0.9999 || !isFinite(next)) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  // Newton did not settle: bisection between -99.99 % and +1000 %.
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
