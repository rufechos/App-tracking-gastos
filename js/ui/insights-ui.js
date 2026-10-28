// Análisis: fixed charges and subscriptions, each year at a glance and one category month by month.
import { app } from '../store.js';
import { ui } from './state.js';
import { $, esc } from './dom.js';
import { kindOf, catName } from './cats.js';
import { recurring } from '../recurring.js';
import { yearSummary, catSeries } from '../insights.js';
import { catChart, kill } from './charts.js';
import { money, signed, pct, plural, mLong } from '../util.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

export function renderFixed() {
  const r = recurring(app.state, kindOf);
  const total = r.reduce((s, x) => s + x.yearly, 0);
  $('fixedNote').textContent = r.length ? plural(r.length, 'cargo', 'cargos') + ' · ' + money(total) + ' al año' : '';
  $('fixedList').innerHTML = r.length ? r.slice(0, 40).map((x) => `<li class="pl-item"><span class="n" title="${esc(x.name)}">${esc(cap(x.key))}</span>
      <span class="num">${x.variable ? '≈ ' : ''}${money(x.variable ? x.avg : x.amount)} <span class="muted">${x.label}</span></span>
      <span class="meta">${esc(catName(x.cat))} · ${money(x.yearly)} al año · próximo hacia el ${dm(x.next)}${x.variable ? ' · importe variable' : ''}${x.rise ? ` · <span class="warn">Ha subido un ${pct(x.rise.pct, 0)}: antes ${money(x.rise.from)}</span>` : ''}</span></li>`).join('')
    : '<li class="empty">Todavía no hay cargos que se repitan. Hacen falta al menos 3 meses de movimientos.</li>';
}

export function renderYears() {
  const ys = yearSummary(app.state, kindOf);
  $('yearList').innerHTML = ys.length ? ys.map((y) => `<li class="pl-item"><span class="n">${y.year} <span class="muted small">· ${plural(y.months, 'mes', 'meses')} con datos</span></span>
      <span class="num ${y.saved >= 0 ? 'pos' : 'neg'}">${signed(y.saved)}</span>
      <span class="meta">Ingresos ${money(y.ti)} · Gastos ${money(y.te)} · Tasa de ahorro ${y.rate == null ? '—' : pct(y.rate)}${Math.abs(y.tinv) >= 0.5 ? ' · Invertido ' + money(y.tinv) : ''}</span></li>`).join('')
    : '<li class="empty">Todavía no hay movimientos.</li>';
}

// The category you tapped in the table, month by month, against its average.
export function renderCatEvo(months) {
  const id = ui.anCat, panel = $('catEvoPanel');
  if (!id || !app.state.cats.some((c) => c.id === id)) { panel.hidden = true; kill('cat'); return; }
  panel.hidden = false;
  const vals = catSeries(app.state, kindOf, id, months);
  const cur = ui.period.kind === 'month' ? ui.period.m : null;
  const past = months.map((m, i) => [m, vals[i]]).filter(([m]) => m !== cur && (!cur || m < cur));
  const withData = past.filter(([, v]) => v > 0);
  const avg = withData.length ? withData.reduce((s, [, v]) => s + v, 0) / withData.length : 0;
  $('catEvoTitle').textContent = catName(id);
  const now = cur ? vals[months.indexOf(cur)] || 0 : null;
  $('catEvoNote').textContent = !withData.length ? 'Sin meses anteriores con los que comparar.'
    : `Media de ${money(avg)} al mes en ${plural(withData.length, 'mes', 'meses')} con gasto.` + (cur ? ` En ${mLong(cur)}: ${money(now)}${avg ? ' (' + (now >= avg ? '+' : '−') + pct((Math.abs(now - avg) / avg) * 100, 0) + ')' : ''}.` : '');
  catChart(months, vals, avg, cur);
}
