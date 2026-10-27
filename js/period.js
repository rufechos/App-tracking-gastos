// The period you are looking at: a month, a year, the last 12 months or everything.
import { addMonths, mLong, monthOf, localIso } from './util.js';

export const thisMonth = (today = localIso()) => monthOf(today);
export const defaultPeriod = (today) => ({ kind: 'month', m: thisMonth(today) });

export function periodBounds(p, today = localIso()) {
  if (p.kind === 'month') return [p.m, p.m];
  if (p.kind === 'year') return [p.y + '-01', p.y + '-12'];
  if (p.kind === 'last12') { const end = p.end || thisMonth(today); return [addMonths(end, -11), end]; }
  return [null, null];
}
export function inPeriod(p, today) {
  const [lo, hi] = periodBounds(p, today);
  if (!lo) return () => true;
  return (iso) => { const m = iso.slice(0, 7); return m >= lo && m <= hi; };
}
// Months of the period, limited to those with data for averages.
export function periodMonths(p, dataMonths, today) {
  const f = inPeriod(p, today);
  return dataMonths.filter((m) => f(m + '-01'));
}
export function periodLabel(p, today) {
  if (p.kind === 'month') return mLong(p.m).replace(/^./, (c) => c.toUpperCase());
  if (p.kind === 'year') return 'Año ' + p.y;
  if (p.kind === 'last12') return 'Últimos 12 meses';
  return 'Todos los meses';
}
export function shiftMonth(p, dir, today) {
  if (p.kind === 'month') return { kind: 'month', m: addMonths(p.m, dir) };
  if (p.kind === 'year') return { kind: 'year', y: String(+p.y + dir) };
  return { kind: 'month', m: thisMonth(today) };
}
export function shortcuts(today = localIso()) {
  const m = thisMonth(today);
  return [
    { label: 'Este mes', p: { kind: 'month', m } },
    { label: 'Mes pasado', p: { kind: 'month', m: addMonths(m, -1) } },
    { label: 'Últimos 12 meses', p: { kind: 'last12' } },
    { label: 'Este año', p: { kind: 'year', y: m.slice(0, 4) } },
    { label: 'Todo', p: { kind: 'all' } },
  ];
}
export const samePeriod = (a, b) => a.kind === b.kind && a.m === b.m && a.y === b.y;
