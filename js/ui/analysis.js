// Análisis: categories, income and how the spending mix changes month by month.
import { ui } from './state.js';
import { $, esc, cssVar } from './dom.js';
import { catName } from './cats.js';
import { renderPeriod, renderPeriodPanel } from './period-ui.js';
import { data, kpisHtml, colorMap, chartMonths } from './summary.js';
import { slotColor, donutChart, shareChart } from './charts.js';
import { money, fmt0, pct } from '../util.js';

export function renderAnalysis() {
  const d = data();
  renderPeriod('anPeriod', { picker: true });
  renderPeriodPanel('anPeriodPanel');
  $('kpis').innerHTML = kpisHtml(d.a, d.pm);
  const cmap = colorMap();
  const a = d.a;
  $('donutTotal').textContent = fmt0.format(a.te);
  const rows = Object.entries(a.e).sort((x, y) => y[1] - x[1]);
  $('catTable').innerHTML = rows.length
    ? '<thead><tr><th>Categoría</th><th class="r">Importe</th><th class="r">%</th></tr></thead><tbody>' + rows.map(([id, v]) => `<tr><td><span class="cat-name"><i class="sw" style="background:${slotColor(cmap, id)}"></i>${esc(catName(id))}</span></td><td class="r num">${money(v)}</td><td class="r num">${pct((v / a.te) * 100)}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="empty">No hay gastos en este periodo.</td></tr></tbody>';
  const slices = [], labels = [], colors = [];
  let rest = 0;
  for (const [id, v] of rows) { if (cmap[id]) { slices.push(v); labels.push(catName(id)); colors.push(slotColor(cmap, id)); } else rest += v; }
  if (rest > 0) { slices.push(rest); labels.push('Resto'); colors.push(cssVar('--rest')); }
  donutChart(slices, labels, colors, a.te);

  const inc = Object.entries(a.inc).sort((x, y) => y[1] - x[1]);
  $('incTable').innerHTML = inc.length
    ? '<thead><tr><th>Categoría</th><th class="bar-cell"></th><th class="r">Importe</th><th class="r">%</th></tr></thead><tbody>' + inc.map(([id, v]) => `<tr><td>${esc(catName(id))}</td><td class="bar-cell"><div class="minibar"><i style="width:${((v / inc[0][1]) * 100).toFixed(1)}%;background:var(--s1)"></i></div></td><td class="r num">${money(v)}</td><td class="r num">${pct((v / a.ti) * 100, 0)}</td></tr>`).join('')
      + `</tbody><tfoot><tr><td><strong>Total</strong></td><td></td><td class="r num"><strong>${money(a.ti)}</strong></td><td class="r num">100 %</td></tr></tfoot>`
    : '<tbody><tr><td class="empty">No hay ingresos en este periodo.</td></tr></tbody>';

  const ms = chartMonths(d);
  const ids = Object.keys(cmap).sort((x, y) => cmap[x] - cmap[y]);
  const per = ms.map((m) => d.monthAgg.get(m) || { e: {}, te: 0 });
  const series = ids.map((id) => ({ name: catName(id), color: slotColor(cmap, id), data: per.map((p) => (p.te ? ((p.e[id] || 0) / p.te) * 100 : 0)), abs: per.map((p) => p.e[id] || 0) }));
  const restData = per.map((p) => { const s = Object.entries(p.e).filter(([k]) => !cmap[k]).reduce((x, [, v]) => x + v, 0); return { pct: p.te ? (s / p.te) * 100 : 0, abs: s }; });
  if (restData.some((r) => r.abs > 0)) series.push({ name: 'Resto', color: cssVar('--rest'), data: restData.map((r) => r.pct), abs: restData.map((r) => r.abs) });
  $('shareLegend').innerHTML = series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  shareChart(ms, series);
}
