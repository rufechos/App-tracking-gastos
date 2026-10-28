// Inicio: the period at a glance, what needs a look, where the money went.
import { app } from '../store.js';
import { ui } from './state.js';
import { $, esc } from './dom.js';
import { catName } from './cats.js';
import { renderPeriod } from './period-ui.js';
import { renderReview } from './review-ui.js';
import { data, kpisHtml, colorMap, chartMonths } from './summary.js';
import { slotColor, flowChart } from './charts.js';
import { money, pct } from '../util.js';
import { inPeriod } from '../period.js';

export function renderHome() {
  const d = data();
  renderPeriod('homePeriod');
  $('homeKpis').innerHTML = kpisHtml(d.a, d.pm);
  renderReview();
  const rows = Object.entries(d.a.e).sort((x, y) => y[1] - x[1]);
  const cmap = colorMap();
  const top = rows.slice(0, 8), rest = rows.slice(8).reduce((s, [, v]) => s + v, 0);
  $('homeTopNote').textContent = rows.length ? money(d.a.te) + ' en gastos' : '';
  $('homeTop').innerHTML = rows.length ? `<table><tbody>${top.map(([id, v]) => `<tr data-cat="${id}" style="cursor:pointer">
      <td><span class="cat-name"><i class="sw" style="background:${slotColor(cmap, id)}"></i>${esc(catName(id))}</span></td>
      <td class="bar-cell"><div class="minibar"><i style="width:${((v / top[0][1]) * 100).toFixed(1)}%;background:${slotColor(cmap, id)}"></i></div></td>
      <td class="r num">${money(v)}</td><td class="r num muted">${pct((v / d.a.te) * 100, 0)}</td></tr>`).join('')}
      ${rest > 0 ? `<tr><td class="muted">Resto</td><td></td><td class="r num">${money(rest)}</td><td class="r num muted">${pct((rest / d.a.te) * 100, 0)}</td></tr>` : ''}</tbody></table>`
    : '<p class="empty">No hay gastos en este periodo.</p>';
  const ms = chartMonths(d);
  const f = inPeriod(ui.period);
  flowChart(ms, ms.map((m) => (d.monthAgg.get(m) || {}).ti || 0), ms.map((m) => (d.monthAgg.get(m) || {}).te || 0), (m) => f(m + '-01'),
    (m) => { ui.period = { kind: 'month', m }; app.render(); });
}

export function bindHome() {
  $('homeTop').addEventListener('click', (e) => {
    const r = e.target.closest('tr[data-cat]');
    if (!r) return;
    ui.fCat = r.dataset.cat;
    location.hash = '#movimientos';
  });
}
