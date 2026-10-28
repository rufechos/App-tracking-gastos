// The period header (‹ month ›) and, in Análisis, the picker: shortcuts, year and the 12 months.
import { app } from '../store.js';
import { ui } from './state.js';
import { $ } from './dom.js';
import { periodLabel, shiftMonth, shortcuts, samePeriod } from '../period.js';
import { MONTHS_SHORT, localIso } from '../util.js';
import { monthsOf } from '../aggregate.js';

export function renderPeriod(id, { picker = false } = {}) {
  const p = ui.period;
  const nav = p.kind === 'month' || p.kind === 'year';
  $(id).innerHTML = `${nav ? '<button class="btn sm" type="button" data-period-shift="-1" aria-label="Periodo anterior">‹</button>' : ''}
    <span class="label">${periodLabel(p)}</span>
    ${nav ? '<button class="btn sm" type="button" data-period-shift="1" aria-label="Periodo siguiente">›</button>' : ''}
    ${picker ? `<button class="btn sm" type="button" data-period-toggle aria-expanded="${ui.periodOpen}">${ui.periodOpen ? 'Cerrar' : 'Cambiar periodo'}</button>` : `<button class="btn link small" type="button" data-period-goto>Otro periodo</button>`}`;
}

export function renderPeriodPanel(id) {
  const el = $(id);
  if (!ui.periodOpen) { el.innerHTML = ''; return; }
  const today = localIso();
  const months = new Set(monthsOf(app.state.tx));
  const years = [...new Set([...months].map((m) => m.slice(0, 4)).concat(today.slice(0, 4)))].sort().reverse();
  const p = ui.period;
  const year = p.kind === 'year' ? p.y : p.kind === 'month' ? p.m.slice(0, 4) : today.slice(0, 4);
  el.innerHTML = `<div class="period-panel">
    <div class="chips">${shortcuts(today).map((s, i) => `<button type="button" class="chip" data-period-short="${i}" aria-pressed="${samePeriod(s.p, p)}">${s.label}</button>`).join('')}</div>
    <div class="tools"><label class="muted small" for="periodYear">Año</label><select id="periodYear">${years.map((y) => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
      <button type="button" class="chip" data-period-year="${year}" aria-pressed="${p.kind === 'year' && p.y === year}">Todo ${year}</button></div>
    <div class="months">${MONTHS_SHORT.map((mm, i) => { const m = year + '-' + String(i + 1).padStart(2, '0'); return `<button type="button" class="chip" data-period-month="${m}" aria-pressed="${p.kind === 'month' && p.m === m}"${months.has(m) ? '' : ' disabled'}>${mm}</button>`; }).join('')}</div>
  </div>`;
}

// One listener for every period control on the page.
export function bindPeriod(onChange) {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-period-shift],[data-period-short],[data-period-month],[data-period-year],[data-period-toggle],[data-period-goto]');
    if (!b) return;
    if (b.dataset.periodShift) ui.period = shiftMonth(ui.period, +b.dataset.periodShift);
    else if (b.dataset.periodShort) ui.period = shortcuts()[+b.dataset.periodShort].p;
    else if (b.dataset.periodMonth) ui.period = { kind: 'month', m: b.dataset.periodMonth };
    else if (b.dataset.periodYear) ui.period = { kind: 'year', y: b.dataset.periodYear };
    else if (b.hasAttribute('data-period-toggle')) { ui.periodOpen = !ui.periodOpen; onChange(false); return; }
    else if (b.hasAttribute('data-period-goto')) { ui.periodOpen = true; location.hash = '#analisis'; return; }
    ui.mvLimit = 50;
    onChange(true);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'periodYear') { ui.period = { kind: 'year', y: e.target.value }; onChange(true); }
  });
}
