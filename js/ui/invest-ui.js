// Inversiones: your positions by broker, their value and the prices from your server.
import { app, save } from '../store.js';
import { ui } from './state.js';
import { $, esc } from './dom.js';
import { kindOf } from './cats.js';
import { invChart } from './charts.js';
import { api, hasServer } from '../api.js';
import { agg } from '../aggregate.js';
import { posValue, invTotals, snapshot, leaveSampleInv, importPositionRows, applyQuotes, cleanIsin } from '../invest.js';
import { readPositions } from '../parse/files.js';
import { parseNum } from '../parse/numbers.js';
import { money, signed, pct, fmtD, fmtDT, qtyFmt, plural, localIso, uid } from '../util.js';

const QUOTE_EVERY = 6 * 3600e3;

export function renderInv() {
  const inv = app.state.inv;
  $('invSample').hidden = !inv.sample;
  const t = invTotals(inv.positions), ps = inv.positions;
  const netContrib = agg(app.state.tx, kindOf).tinv;
  const gp = t.c > 0 ? (t.g / t.c) * 100 : 0;
  $('invKpis').innerHTML = `
   <div class="kpi"><span class="eyebrow">Valor de la cartera</span><span class="v">${money(t.v)}</span><span class="d">${plural(ps.length, 'posición', 'posiciones')}${t.known ? '' : ' · alguna sin precio'}</span></div>
   <div class="kpi"><span class="eyebrow">Invertido</span><span class="v">${money(t.c)}</span><span class="d">Coste de las posiciones</span></div>
   <div class="kpi"><span class="eyebrow">Ganancia</span><span class="v ${t.g >= 0 ? 'pos' : 'neg'}">${signed(t.g)}</span><span class="d ${t.g >= 0 ? 'pos' : 'neg'}">${t.g >= 0 ? '+' : '−'}${pct(Math.abs(gp))}</span></div>
   <div class="kpi"><span class="eyebrow">Aportado desde tus cuentas</span><span class="v">${money(netContrib)}</span><span class="d">Movimientos en la categoría Inversión</span></div>`;
  const rows = ps.slice().sort((a, b) => (posValue(b) ?? b.cost) - (posValue(a) ?? a.cost));
  $('invList').innerHTML = rows.length ? rows.map((p) => {
    const pv = posValue(p), g = pv == null ? null : pv - p.cost;
    return `<li class="inv-item"><span class="n">${esc(p.name)}</span><span class="v">${pv != null ? money(pv) : '—'}</span>
      <span class="meta"><span>${esc(p.broker)}</span>${p.isin ? `<span class="num">${esc(p.isin)}</span>` : ''}<span>${qtyFmt(p.qty)} títulos</span><span>Invertido ${money(p.cost)}</span>
      <span>Precio ${p.price != null ? money(p.price) : '—'}${p.priceDate ? ' (' + fmtD(p.priceDate) + ')' : ''}</span>
      ${g == null ? '' : `<span class="${g >= 0 ? 'pos' : 'neg'}">${signed(g)}${p.cost ? ' · ' + (g >= 0 ? '+' : '−') + pct(Math.abs((g / p.cost) * 100)) : ''}</span>`}
      ${t.v ? `<span>${pct(((pv ?? p.cost) / t.v) * 100)} de la cartera</span>` : ''}</span>
      <span class="acts"><button class="btn sm" type="button" data-editpos="${p.id}">Editar</button><button class="btn sm danger" type="button" data-delpos="${p.id}" aria-label="Quitar ${esc(p.name)}">Quitar</button></span></li>`;
  }).join('') : '<li class="empty">Todavía no hay posiciones. Añádelas a mano o importa el informe de tu bróker en «Añadir o importar posiciones».</li>';
  $('invQuoteInfo').textContent = inv.lastQuote ? 'Precios del ' + fmtDT(inv.lastQuote) : '';
  $('invQuoteBtn').hidden = !ps.some((p) => p.isin);
  if (!ps.length) $('invSetup').open = true;
  $('invStatus').innerHTML = ui.invMsg ? `<div class="file-row">${ui.invMsg}</div>` : '';
  const h = inv.history || [];
  $('invChartBox').hidden = h.length < 2;
  invChart(h);
}

export async function updateQuotes(prefix = '') {
  const inv = app.state.inv;
  const isins = [...new Set(inv.positions.map((p) => p.isin).filter(Boolean))];
  if (!isins.length) return;
  if (!hasServer()) { ui.invMsg = prefix + '<span class="muted">Para actualizar los precios solos, configura el servidor en Ajustes › Bancos conectados.</span>'; renderInv(); return; }
  ui.invMsg = '<span class="muted">Actualizando precios…</span>';
  renderInv();
  try {
    const q = await api('/quotes', { body: { isins } });
    const r = applyQuotes(app.state.inv, q.quotes || {});
    save();
    ui.invMsg = prefix + `<span class="ok">${r.n} ${r.n === 1 ? 'precio actualizado' : 'precios actualizados'}</span>` + (r.miss.length ? `<span class="muted">Sin precio para: ${esc(r.miss.join(', '))}. Puedes ponerlo a mano con «Editar».</span>` : '');
  } catch (e) { ui.invMsg = prefix + `<span class="err">${esc(e.message)}</span>`; }
  renderInv();
}

export function maybeAutoQuotes() {
  const inv = app.state.inv, last = inv.lastQuote ? new Date(inv.lastQuote).getTime() : 0;
  if (!inv.sample && inv.positions.some((p) => p.isin) && hasServer() && Date.now() - last > QUOTE_EVERY) updateQuotes();
}

function fillForm(p) {
  $('invId').value = p ? p.id : '';
  $('invBroker').value = p ? p.broker : '';
  $('invName').value = p ? p.name : '';
  $('invIsin').value = p ? p.isin || '' : '';
  $('invQty').value = p ? String(p.qty).replace('.', ',') : '';
  $('invCost').value = p ? String(p.cost).replace('.', ',') : '';
  $('invPrice').value = p && p.price != null ? String(p.price).replace('.', ',') : '';
  $('invSubmit').textContent = p ? 'Guardar cambios' : 'Guardar posición';
  $('invCancel').hidden = !p;
}

export function bindInv() {
  $('invForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const qty = parseNum($('invQty').value), cost = parseNum($('invCost').value);
    const price = $('invPrice').value.trim() ? parseNum($('invPrice').value) : null;
    if (qty == null || cost == null) { ui.invMsg = '<span class="err">Revisa los títulos y el total invertido: deben ser números.</span>'; renderInv(); return; }
    const id = $('invId').value, s = app.state;
    if (!id) s.inv = leaveSampleInv(s.inv);
    const rawIsin = $('invIsin').value.trim(), isin = cleanIsin(rawIsin);
    const d = { broker: $('invBroker').value.trim(), name: $('invName').value.trim(), isin, qty: Math.abs(qty), cost: Math.abs(cost) };
    if (price != null) { d.price = Math.abs(price); d.priceDate = localIso(); }
    const ex = s.inv.positions.find((p) => p.id === id);
    if (ex) Object.assign(ex, d); else s.inv.positions.push({ id: 'p_' + uid(), price: null, priceDate: null, ...d });
    ui.invMsg = rawIsin && !isin ? '<span class="err">El ISIN no parece válido; la posición se ha guardado sin él.</span>' : '<span class="ok">Posición guardada.</span>';
    fillForm(null);
    snapshot(s.inv);
    save();
    renderInv();
    if (d.isin && price == null) updateQuotes();
  });
  $('invCancel').addEventListener('click', () => fillForm(null));
  $('invList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-editpos]'), dl = e.target.closest('[data-delpos]');
    const inv = app.state.inv;
    if (ed) { fillForm(inv.positions.find((p) => p.id === ed.dataset.editpos)); $('invSetup').open = true; $('invName').focus(); }
    if (dl) { inv.positions = inv.positions.filter((p) => p.id !== dl.dataset.delpos); snapshot(inv); save(); renderInv(); }
  });
  $('invFile').addEventListener('change', async () => {
    const f = $('invFile').files[0];
    if (!f) return;
    const broker = $('invImpBroker').value.trim() || 'Bróker';
    try {
      const rows = await readPositions(f);
      app.state.inv = leaveSampleInv(app.state.inv);
      importPositionRows(app.state.inv, rows, broker);
      save();
      ui.invMsg = `<span class="ok">${plural(rows.length, 'posición importada', 'posiciones importadas')} de ${esc(broker)}.</span>` + (rows.some((r) => r.costGuess) ? '<span class="muted">El informe no trae lo invertido en alguna posición: revísalo con «Editar».</span>' : '');
      renderInv();
      await updateQuotes(ui.invMsg + '</div><div class="file-row">');
    } catch (err) { ui.invMsg = `<span class="err">${esc(err.message || String(err))}</span>`; renderInv(); }
    $('invFile').value = '';
  });
  $('invQuoteBtn').addEventListener('click', () => updateQuotes());
}
