// Patrimonio: what each of your accounts holds plus your investments, and how it has changed month by month.
import { app, save } from '../store.js';
import { ui } from './state.js';
import { $, esc } from './dom.js';
import { worthNow, worthSeries } from '../worth.js';
import { lastMonths } from '../insights.js';
import { ACCOUNT_KINDS } from '../accounts.js';
import { worthChart } from './charts.js';
import { parseNum } from '../parse/numbers.js';
import { money, signed, fmtD, localIso, plural, mLabel } from '../util.js';

const SRC = { banco: 'del banco', extracto: 'de un extracto', manual: 'puesto a mano' };

export function renderWorth() {
  const s = app.state, today = localIso(), w = worthNow(s, today);
  const series = worthSeries(s, lastMonths(today, 12), today).filter((x) => x.total !== 0 || x.inv != null);
  const year = series.length > 1 ? series[0] : null;
  $('worthKpis').innerHTML = `
    <div class="kpi"><span class="eyebrow">Patrimonio neto</span><span class="v">${money(w.total)}</span><span class="d">${year ? signed(w.total - year.total) + ' desde ' + mLabel(year.m) : 'Cuentas e inversiones'}</span></div>
    <div class="kpi"><span class="eyebrow">En tus cuentas</span><span class="v">${money(w.cash)}</span><span class="d">${w.missing ? plural(w.missing, 'cuenta', 'cuentas') + ' sin saldo' : plural(w.rows.length, 'cuenta', 'cuentas')}</span></div>
    <div class="kpi"><span class="eyebrow">Inversiones</span><span class="v">${money(w.inv)}</span><span class="d">Valor neto de la cartera</span></div>`;
  $('worthNote').textContent = '';
  const rows = w.rows.map(({ a, anchor, v }) => {
    const editing = ui.worthEdit === a.id;
    const how = anchor ? `${SRC[anchor.src] || ''}, ${anchor.d === today ? 'hoy' : fmtD(anchor.d)}${anchor.d !== today && v !== anchor.v ? ' y movimientos posteriores' : ''}` : 'Sin saldo: ponlo para contarla';
    return `<li class="pl-item"><span class="n">${esc(a.name)} <span class="muted small">· ${ACCOUNT_KINDS[a.kind] || ''}</span></span><span class="num ${v != null && v < 0 ? 'neg' : ''}">${v != null ? money(v) : '—'}</span>
      <span class="meta">${how}${editing ? '' : ` <button class="btn link small" type="button" data-baledit="${a.id}">${anchor ? 'Cambiar' : 'Poner saldo'}</button>`}</span>
      ${editing ? `<form class="inline-form" data-balform="${a.id}"><input type="text" inputmode="decimal" id="balInput" aria-label="Saldo de ${esc(a.name)} hoy" value="${v != null ? String(v).replace('.', ',') : ''}" placeholder="Saldo hoy"><button class="btn sm primary" type="submit">Guardar</button><button class="btn sm" type="button" data-balcancel>Cancelar</button></form>` : ''}</li>`;
  });
  if (s.inv.positions.length) rows.push(`<li class="pl-item"><span class="n">Cartera de inversión</span><span class="num">${money(w.inv)}</span><span class="meta">Valor neto, tras comisiones · <a href="#inversiones" data-scroll="invPanel">ver posiciones</a></span></li>`);
  $('worthList').innerHTML = rows.join('') || '<li class="muted small">Añade tus cuentas en Ajustes › Mis cuentas para ver aquí cuánto tienes en cada una.</li>';
  $('worthChartBox').hidden = series.length < 2;
  worthChart(series);
}

export function bindWorth() {
  $('worthList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-baledit]'), cancel = e.target.closest('[data-balcancel]'), sc = e.target.closest('[data-scroll]');
    if (ed) { ui.worthEdit = ed.dataset.baledit; renderWorth(); const i = $('balInput'); if (i) { i.focus(); i.select(); } }
    if (cancel) { ui.worthEdit = null; renderWorth(); }
    if (sc) { e.preventDefault(); $(sc.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); }
  });
  $('worthList').addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-balform]');
    if (!f) return;
    e.preventDefault();
    const v = parseNum($('balInput').value);
    const a = app.state.accounts.find((x) => x.id === f.dataset.balform);
    if (v == null || !a) return;
    a.bal = { v, d: localIso(), src: 'manual', at: new Date().toISOString() };
    ui.worthEdit = null;
    save();
    renderWorth();
  });
}
