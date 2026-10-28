// Presupuestos: how each category is going this month (Inicio) and the monthly limits (Ajustes).
import { app, save } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { kindOf, catName } from './cats.js';
import { budgetStatus, proposeBudgets, averages } from '../budgets.js';
import { monthsOf } from '../aggregate.js';
import { parseNum } from '../parse/numbers.js';
import { money, pct, fmt0 } from '../util.js';
import { refreshPush } from './push-ui.js';

let proposal = null; // what «Proponer» offered, until you save it

export function renderBudgets() {
  const panel = $('budgetPanel'), p = ui.period, s = app.state;
  if (p.kind !== 'month' || s.sample) { panel.hidden = true; return; }
  const st = budgetStatus(s, kindOf, p.m);
  if (!st) {
    // An invitation, once there are a couple of months to propose from.
    panel.hidden = s.settings.budgetHint === false || monthsOf(s.tx).filter((m) => m < p.m).length < 2;
    $('budgetNote').textContent = '';
    $('budgetList').innerHTML = '<li class="muted small">Pon un límite al mes a las categorías que quieras vigilar y verás aquí cómo vas. Te propongo uno con tu media de los últimos 6 meses.</li>';
    $('budgetMore').innerHTML = '<button class="btn sm primary" type="button" data-bud="propose">Proponer presupuestos</button><button class="btn sm" type="button" data-bud="nohint">Ahora no</button>';
    return;
  }
  panel.hidden = false;
  $('budgetNote').textContent = money(st.spent) + ' de ' + money(st.limit);
  $('budgetList').innerHTML = st.rows.map((r) => {
    let note;
    if (r.state === 'over') note = `<span class="neg">${st.current ? 'Te has pasado' : 'Te pasaste'} ${money(-r.left)}</span>`;
    else if (r.state === 'fast') note = `<span class="warn">A día ${st.day} llevas el ${pct(r.used * 100, 0)}: vas por delante del mes (${pct(st.pace * 100, 0)})</span>`;
    else if (r.left < 0.005) note = `<span class="muted">${st.current ? 'Has llegado al límite' : 'Justo en el límite'}</span>`;
    else note = `<span class="muted">${st.current ? 'Te quedan' : 'Sobraron'} ${money(r.left)}</span>`;
    return `<li class="bud" data-st="${r.state}" data-cat="${r.id}"><div class="bud-top"><span class="n">${esc(catName(r.id))}</span><span class="num">${money(r.spent)} <span class="muted">de ${fmt0.format(r.limit)}</span></span></div>
      <div class="bud-bar" role="img" aria-label="${pct(r.used * 100, 0)} del presupuesto"><i style="width:${(Math.min(r.used, 1) * 100).toFixed(1)}%"></i>${st.current ? `<b style="left:${(st.pace * 100).toFixed(1)}%" title="Parte del mes que ha pasado"></b>` : ''}</div>
      <div class="small">${note}</div></li>`;
  }).join('');
  $('budgetMore').innerHTML = '<button class="btn link small" type="button" data-bud="edit">Cambiar presupuestos</button>';
}

export function renderBudgetSettings() {
  const box = $('budgetFields');
  if (box.contains(document.activeElement)) return; // do not redraw what you are typing
  const s = app.state, avg = averages(s, kindOf), b = proposal || s.budgets || {};
  const cats = s.cats.filter((c) => c.kind === 'gasto').sort((x, y) => (avg[y.id] || 0) - (avg[x.id] || 0) || x.name.localeCompare(y.name, 'es'));
  box.innerHTML = cats.map((c, i) => `<div class="bud-row"><label for="bud${i}">${esc(c.name)}${avg[c.id] >= 1 ? ` <span class="muted small">· media ${fmt0.format(avg[c.id])}</span>` : ''}</label>
    <input type="text" id="bud${i}" data-budcat="${c.id}" inputmode="decimal" placeholder="Sin límite" value="${b[c.id] ? String(b[c.id]).replace('.', ',') : ''}"></div>`).join('');
}

function goToSettings() {
  ui.scrollTo = 'budgetSetPanel';
  if (location.hash === '#ajustes') app.render(); else location.hash = '#ajustes';
}

export function bindBudgets() {
  $('budgetPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bud]'), row = e.target.closest('li[data-cat]');
    if (b) {
      if (b.dataset.bud === 'propose') { proposal = proposeBudgets(app.state, kindOf); goToSettings(); }
      else if (b.dataset.bud === 'edit') goToSettings();
      else if (b.dataset.bud === 'nohint') { app.state.settings.budgetHint = false; save(); app.render(); }
      return;
    }
    if (row) { ui.fCat = row.dataset.cat; location.hash = '#movimientos'; }
  });
  $('budgetPropose').addEventListener('click', () => {
    proposal = proposeBudgets(app.state, kindOf);
    renderBudgetSettings();
    toast(Object.keys(proposal).length ? 'Revisa los importes y pulsa «Guardar presupuestos».' : 'Todavía no hay meses completos para proponer nada.');
  });
  $('budgetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const out = {};
    let bad = false;
    for (const i of $('budgetFields').querySelectorAll('input[data-budcat]')) {
      if (!i.value.trim()) continue;
      const v = parseNum(i.value);
      if (v == null || v <= 0) { bad = true; continue; }
      out[i.dataset.budcat] = Math.round(Math.abs(v) * 100) / 100;
    }
    if (bad) { toast('Algún importe no es un número: revísalo.'); return; }
    app.state.budgets = out;
    proposal = null;
    document.activeElement.blur();
    save();
    app.render();
    toast(Object.keys(out).length ? 'Presupuestos guardados.' : 'Presupuestos quitados.');
    refreshPush();
  });
}
