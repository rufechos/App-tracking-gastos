// Inversiones: your positions by broker, what they are worth after costs, what they cost you a year and their return.
import { app, save } from '../store.js';
import { ui } from './state.js';
import { $, esc } from './dom.js';
import { kindOf } from './cats.js';
import { invChart } from './charts.js';
import { api, hasServer } from '../api.js';
import { agg } from '../aggregate.js';
import { posValue, invTotals, snapshot, leaveSampleInv, importPositionRows, applyQuotes, cleanIsin, positionCosts, portfolioCosts,
  portfolioReturn, breakdown, brokerFees, TER_TABLE, TYPES } from '../invest.js';
import { readPositions } from '../parse/files.js';
import { parseNum } from '../parse/numbers.js';
import { money, signed, pct, fmtD, fmtDT, qtyFmt, plural, localIso, uid, dayDiff } from '../util.js';

const QUOTE_EVERY = 6 * 3600e3;
const OLD_PRICE_DAYS = 7;
const CHUNK = 5; // ISINs per call to the server
const EVERY = [[1, 'cada mes'], [3, 'cada 3 meses'], [6, 'cada 6 meses'], [12, 'cada año']];
const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
const pctOf = (v) => pct(v, v > 0 && v < 1 ? 2 : 1);

function kpis(inv, ps) {
  const t = invTotals(ps), c = portfolioCosts(inv), today = localIso();
  const netGain = c.net - t.c, gp = t.c > 0 ? (netGain / t.c) * 100 : 0;
  const netContrib = agg(app.state.tx, kindOf).tinv;
  const r = ps.length ? portfolioReturn(app.state, kindOf, c.net, today) : { rate: null, reason: 'history' };
  const tir = r.rate != null
    ? `<span class="v ${r.rate >= 0 ? 'pos' : 'neg'}">${r.rate >= 0 ? '+' : '−'}${pct(Math.abs(r.rate) * 100)}</span><span class="d">Al año desde ${fmtD(r.since)}, con lo aportado y los dividendos</span>`
    : `<span class="v">—</span><span class="d">${r.reason === 'short' ? 'Con menos de 3 meses de aportaciones no es fiable' : 'Necesita tus aportaciones (categoría Inversión) desde el principio'}</span>`;
  return `
   <div class="kpi"><span class="eyebrow">Valor de mercado</span><span class="v">${money(t.v)}</span><span class="d">${plural(ps.length, 'posición', 'posiciones')}${t.known ? '' : ' · alguna sin precio'}</span></div>
   <div class="kpi"><span class="eyebrow">Valor neto</span><span class="v">${money(c.net)}</span><span class="d">${c.accrued + c.exit >= 0.005 ? 'Tras ' + money(c.accrued + c.exit) + ' de comisiones pendientes y de venta' : 'Sin comisiones pendientes'}</span></div>
   <div class="kpi"><span class="eyebrow">Ganancia neta</span><span class="v ${netGain >= 0 ? 'pos' : 'neg'}">${signed(netGain)}</span><span class="d ${netGain >= 0 ? 'pos' : 'neg'}">${netGain >= 0 ? '+' : '−'}${pct(Math.abs(gp))} sobre ${money(t.c)} invertidos</span></div>
   <div class="kpi"><span class="eyebrow">Rentabilidad anual (TIR)</span>${tir}</div>
   <div class="kpi"><span class="eyebrow">Coste al año</span><span class="v">${money(c.totalEur)}</span><span class="d">${pctOf(c.totalPct)} de la cartera: fondos ${money(c.fundEur)}, plataformas ${money(c.platformEur)}${c.terMissing ? ` · falta el TER de ${plural(c.terMissing, 'posición', 'posiciones')}` : ''}</span></div>
   <div class="kpi"><span class="eyebrow">Aportado desde tus cuentas</span><span class="v">${money(netContrib)}</span><span class="d">Movimientos en la categoría Inversión</span></div>`;
}

function itemHtml(inv, p, total, today) {
  const pv = posValue(p), g = pv == null ? null : pv - p.cost, c = positionCosts(inv, p);
  const age = p.priceDate ? dayDiff(p.priceDate, today) : null;
  const price = `<span class="${age != null && age > OLD_PRICE_DAYS ? 'warn' : ''}">Precio ${p.price != null ? money(p.price) : '—'}${p.priceDate ? ' del ' + fmtD(p.priceDate) : ''}${age != null && age > OLD_PRICE_DAYS ? ` (hace ${age} días)` : ''}${p.priceSrc === 'ft' ? ' · Financial Times' : ''}</span>`;
  const fund = c.ter != null ? `<span>Gastos del fondo ${pctOf(c.ter)} · ${money(c.terEur)} al año</span>` : '<span class="muted">Sin el TER del fondo: añádelo con «Editar»</span>';
  const platform = c.custodyEur >= 0.005 ? `<span>Custodia de ${esc(p.broker)} ${pctOf(c.custodyPct)} · ${money(c.custodyEur)} al año</span>` : '';
  return `<li class="inv-item"><span class="n">${esc(p.name)}</span><span class="v">${pv != null ? money(pv) : '—'}</span>
    <span class="meta"><span>${esc(p.broker)}</span>${p.isin ? `<span class="num">${esc(p.isin)}</span>` : ''}<span>${qtyFmt(p.qty)} títulos</span><span>Invertido ${money(p.cost)}</span>
    ${price}
    ${g == null ? '' : `<span class="${g >= 0 ? 'pos' : 'neg'}">${signed(g)}${p.cost ? ' · ' + (g >= 0 ? '+' : '−') + pct(Math.abs((g / p.cost) * 100)) : ''}</span>`}
    ${total ? `<span>${pct(((pv ?? p.cost) / total) * 100)} de la cartera</span>` : ''}${fund}${platform}</span>
    <span class="acts"><button class="btn sm" type="button" data-editpos="${p.id}">Editar</button><button class="btn sm danger" type="button" data-delpos="${p.id}" aria-label="Quitar ${esc(p.name)}">Quitar</button></span></li>`;
}

const mixRows = (rows) => (rows.length ? '<tbody>' + rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="bar-cell"><div class="minibar"><i style="width:${r.pct.toFixed(1)}%;background:var(--s1)"></i></div></td>
  <td class="r num">${money(r.value)}</td><td class="r num muted">${pct(r.pct, 0)}</td></tr>`).join('') + '</tbody>' : '');

function feesHtml(inv, ps) {
  const brokers = [...new Set(ps.map((p) => p.broker).filter(Boolean))];
  if (!brokers.length) return '<p class="muted small">Añade alguna posición para poner las comisiones de su bróker.</p>';
  return brokers.map((b, i) => {
    const f = brokerFees(inv, b), id = 'fee' + i;
    return `<form class="form fee-form" data-fees="${esc(b)}">
      <h3>${esc(b)}${f.preset ? ' <span class="muted small">· tarifa publicada</span>' : ''}</h3>
      <div class="fee-grid">
        <div><label for="${id}c">Custodia (% al año)</label><input type="text" id="${id}c" name="custodyPct" inputmode="decimal" value="${dec(f.custodyPct || '')}" placeholder="0"></div>
        <div><label for="${id}e">Se cobra</label><select id="${id}e" name="every">${EVERY.map(([v, l]) => `<option value="${v}"${v === (f.every || 3) ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label for="${id}m">Cuota fija (€ al mes)</label><input type="text" id="${id}m" name="monthlyFee" inputmode="decimal" value="${dec(f.monthlyFee || '')}" placeholder="0"></div>
        <div><label for="${id}t">Por cada venta (€)</label><input type="text" id="${id}t" name="tradeFee" inputmode="decimal" value="${dec(f.tradeFee || '')}" placeholder="0"></div>
      </div>
      <div class="tools" style="margin-top:8px"><label class="check" for="${id}v"><input type="checkbox" id="${id}v" name="vat"${f.vat ? ' checked' : ''}> Más 21 % de IVA</label><button class="btn sm primary" type="submit">Guardar</button></div>
    </form>`;
  }).join('');
}

export function renderInv() {
  const inv = app.state.inv, ps = inv.positions, today = localIso();
  $('invSample').hidden = !inv.sample;
  $('invKpis').innerHTML = kpis(inv, ps);
  $('invCostNote').textContent = ps.length ? 'Los gastos del fondo (TER) ya van descontados en su precio: los ves para saber lo que pagas, pero no se restan otra vez. Las comisiones del bróker se cobran aparte: el valor neto resta lo acumulado desde su último cobro y lo que costaría vender hoy.' : '';
  const t = invTotals(ps);
  const rows = ps.slice().sort((a, b) => (posValue(b) ?? b.cost) - (posValue(a) ?? a.cost));
  $('invList').innerHTML = rows.length ? rows.map((p) => itemHtml(inv, p, t.v, today)).join('')
    : '<li class="empty">Todavía no hay posiciones. Añádelas a mano o importa el informe de tu bróker en «Añadir o importar posiciones».</li>';
  $('invQuoteInfo').textContent = inv.lastQuote ? 'Precios del ' + fmtDT(inv.lastQuote) : '';
  $('invQuoteBtn').hidden = !ps.some((p) => p.isin);
  if (!ps.length) $('invSetup').open = true;
  $('invStatus').innerHTML = ui.invMsg ? `<div class="file-row">${ui.invMsg}</div>` : '';
  if (!document.activeElement || !$('invFees').contains(document.activeElement)) $('invFees').innerHTML = feesHtml(inv, ps);
  const mix = breakdown(ps);
  $('invMixPanel').hidden = ps.length < 2;
  $('invByBroker').innerHTML = mixRows(mix.brokers);
  $('invByType').innerHTML = mixRows(mix.types);
  const h = inv.history || [];
  $('invChartBox').hidden = h.length < 2;
  invChart(h);
}

// Prices in rounds of a few ISINs (the server can only make so many calls each time). fresh: skip its cache.
export async function updateQuotes(prefix = '', { fresh = false } = {}) {
  const inv = app.state.inv;
  let todo = [...new Set(inv.positions.map((p) => p.isin).filter(Boolean))];
  if (!todo.length) return;
  if (!hasServer()) { ui.invMsg = prefix + '<span class="muted">Para actualizar los precios solos, configura el servidor en Ajustes › Bancos conectados.</span>'; renderInv(); return; }
  ui.invMsg = '<span class="muted">Actualizando precios…</span>';
  renderInv();
  try {
    const quotes = {};
    for (let round = 0; todo.length && round < 20; round++) {
      const chunk = todo.slice(0, CHUNK);
      const q = await api('/quotes', { body: { isins: chunk, fresh } });
      Object.assign(quotes, q.quotes || {});
      const rest = (q.rest || []).filter((x) => chunk.includes(x));
      if (rest.length === chunk.length) break; // no progress
      todo = rest.concat(todo.slice(CHUNK));
    }
    const r = applyQuotes(app.state.inv, quotes);
    save();
    const old = inv.positions.filter((p) => p.priceDate && dayDiff(p.priceDate, localIso()) > OLD_PRICE_DAYS).map((p) => p.name);
    ui.invMsg = prefix + `<span class="ok">${r.n} ${r.n === 1 ? 'precio actualizado' : 'precios actualizados'}</span>`
      + (r.miss.length ? `<span class="muted">Sin precio para: ${esc(r.miss.join(', '))}. Puedes ponerlo a mano con «Editar».</span>` : '')
      + (old.length ? `<span class="warn">Precio de hace más de una semana: ${esc(old.join(', '))}.</span>` : '');
  } catch (e) { ui.invMsg = prefix + `<span class="err">${esc(e.message)}</span>`; }
  renderInv();
}

export function maybeAutoQuotes() {
  const inv = app.state.inv, last = inv.lastQuote ? new Date(inv.lastQuote).getTime() : 0;
  if (!inv.sample && inv.positions.some((p) => p.isin) && hasServer() && Date.now() - last > QUOTE_EVERY) updateQuotes();
}

function terHint() {
  const isin = cleanIsin($('invIsin').value), known = isin && TER_TABLE[isin];
  $('invTer').placeholder = known != null ? dec(known) + ' (de su ficha)' : 'p. ej. 0,18';
}

function fillForm(p) {
  $('invId').value = p ? p.id : '';
  $('invBroker').value = p ? p.broker : '';
  $('invName').value = p ? p.name : '';
  $('invIsin').value = p ? p.isin || '' : '';
  $('invQty').value = p ? dec(p.qty) : '';
  $('invCost').value = p ? dec(p.cost) : '';
  $('invPrice').value = p && p.price != null ? dec(p.price) : '';
  $('invTer').value = p && p.ter != null ? dec(p.ter) : '';
  $('invType').value = p && TYPES.includes(p.type) ? p.type : '';
  $('invSubmit').textContent = p ? 'Guardar cambios' : 'Guardar posición';
  $('invCancel').hidden = !p;
  terHint();
}

export function bindInv() {
  $('invIsin').addEventListener('input', terHint);
  $('invForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const qty = parseNum($('invQty').value), cost = parseNum($('invCost').value);
    const price = $('invPrice').value.trim() ? parseNum($('invPrice').value) : null;
    const ter = $('invTer').value.trim() ? parseNum($('invTer').value.replace('%', '')) : null;
    if (qty == null || cost == null) { ui.invMsg = '<span class="err">Revisa los títulos y el total invertido: deben ser números.</span>'; renderInv(); return; }
    if ($('invTer').value.trim() && (ter == null || ter < 0 || ter > 5)) { ui.invMsg = '<span class="err">El TER es un porcentaje al año, por ejemplo 0,18.</span>'; renderInv(); return; }
    const id = $('invId').value, s = app.state;
    if (!id) s.inv = leaveSampleInv(s.inv);
    const rawIsin = $('invIsin').value.trim(), isin = cleanIsin(rawIsin);
    const d = { broker: $('invBroker').value.trim(), name: $('invName').value.trim(), isin, qty: Math.abs(qty), cost: Math.abs(cost), ter, type: $('invType').value || undefined };
    if (price != null) { d.price = Math.abs(price); d.priceDate = localIso(); d.priceSrc = 'manual'; }
    const ex = s.inv.positions.find((p) => p.id === id);
    if (ex) { Object.assign(ex, d); if (ter == null) delete ex.ter; if (!d.type) delete ex.type; }
    else { const np = { id: 'p_' + uid(), price: null, priceDate: null, ...d }; if (ter == null) delete np.ter; if (!d.type) delete np.type; s.inv.positions.push(np); }
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
  $('invFees').addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-fees]');
    if (!f) return;
    e.preventDefault();
    const n = (k) => { const v = parseNum(f.elements[k].value); return v == null ? 0 : Math.abs(v); };
    const inv = app.state.inv;
    inv.fees = inv.fees || {};
    inv.fees[f.dataset.fees] = { custodyPct: Math.min(n('custodyPct'), 5), every: +f.elements.every.value || 3, monthlyFee: n('monthlyFee'), tradeFee: n('tradeFee'), vat: f.elements.vat.checked };
    save();
    ui.invMsg = `<span class="ok">Comisiones de ${esc(f.dataset.fees)} guardadas.</span>`;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    renderInv();
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
  $('invQuoteBtn').addEventListener('click', () => updateQuotes('', { fresh: true }));
}
