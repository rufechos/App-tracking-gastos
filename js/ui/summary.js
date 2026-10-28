// Figures for the selected period, shared by Inicio and Análisis.
import { app } from '../store.js';
import { ui } from './state.js';
import { kindOf } from './cats.js';
import { agg, monthsOf, byMonth } from '../aggregate.js';
import { inPeriod, periodMonths, periodBounds } from '../period.js';
import { money, fmt0, pct, signed, addMonths, plural } from '../util.js';

let cache = null;
// Computed once per render (main.js clears it before each one).
export function data() {
  const s = app.state;
  const key = JSON.stringify(ui.period);
  if (cache && cache.key === key && cache.state === s) return cache;
  const f = inPeriod(ui.period);
  const list = s.tx.filter((t) => f(t.date));
  const months = monthsOf(s.tx);
  const per = byMonth(s.tx);
  const monthAgg = new Map([...per].map(([m, l]) => [m, agg(l, kindOf)]));
  cache = { key, state: s, list, months, pm: periodMonths(ui.period, months), a: agg(list, kindOf), monthAgg };
  return cache;
}
export const invalidate = () => { cache = null; };

// The 7 biggest expense categories overall keep the same colour in every chart and period.
export function colorMap() {
  const all = agg(app.state.tx, kindOf);
  const m = {};
  Object.entries(all.e).sort((x, y) => y[1] - x[1]).slice(0, 7).forEach(([id], i) => { m[id] = i + 1; });
  return m;
}

export function kpisHtml(a, pm) {
  const multi = ui.period.kind !== 'month';
  const n = Math.max(pm.length, 1);
  const bal = a.ti - a.te, rate = a.ti > 0 ? (bal / a.ti) * 100 : 0;
  const avg = (v) => (multi ? 'Media ' + fmt0.format(v / n) + ' al mes' : '');
  const inv = Math.abs(a.tinv) >= 0.5 ? (a.tinv > 0 ? 'De ello, ' + fmt0.format(a.tinv) + ' invertidos' : 'Has sacado ' + fmt0.format(-a.tinv) + ' de inversiones') : '';
  return `
   <div class="kpi"><span class="eyebrow">Ingresos</span><span class="v">${money(a.ti)}</span><span class="d">${avg(a.ti) || (pm.length ? '' : 'Sin movimientos')}</span></div>
   <div class="kpi"><span class="eyebrow">Gastos</span><span class="v">${money(a.te)}</span><span class="d">${avg(a.te)}</span></div>
   <div class="kpi"><span class="eyebrow">Ahorro</span><span class="v ${bal >= 0 ? 'pos' : 'neg'}">${signed(bal)}</span><span class="d">${inv || (bal >= 0 ? 'Ingresas más de lo que gastas' : 'Gastas más de lo que ingresas')}</span></div>
   <div class="kpi"><span class="eyebrow">Tasa de ahorro</span><span class="v ${rate >= 0 ? 'pos' : 'neg'}">${pct(rate)}</span><span class="d">${multi ? plural(pm.length, 'mes', 'meses') + ' con datos' : 'Del total ingresado'}</span></div>`;
}

// Months shown in the bar charts: the period itself when it spans several months, otherwise the 12 months up to it.
export function chartMonths(d) {
  const [lo, hi] = periodBounds(ui.period);
  if (!d.months.length) return [];
  if (ui.period.kind === 'month') { const from = addMonths(hi, -11); return d.months.filter((m) => m >= from && m <= hi); }
  if (!lo) return d.months.slice(-36);
  return d.months.filter((m) => m >= lo && m <= hi);
}
