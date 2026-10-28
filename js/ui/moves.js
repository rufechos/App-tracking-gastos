// Movimientos: search, filters and the list, two lines per movement so that it fits an iPhone screen.
import { app, save } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { catOptions, catName } from './cats.js';
import { renderPeriod } from './period-ui.js';
import { data } from './summary.js';
import { RV_LABEL } from '../review.js';
import { norm, signed, dShort, plural } from '../util.js';
import { suggestKw } from '../categories.js';
import { applyRule, countMatches, ruleSign } from './learn.js';

function filtered() {
  const d = data();
  const q = norm(ui.q), qn = ui.q.trim().replace(/[€\s]/g, '').replace(/^[-−+]/, '');
  return d.list.filter((t) => (!ui.fCat || t.cat === ui.fCat) && (!ui.fAcct || (ui.fAcct === '-' ? !t.acct : t.acct === ui.fAcct))
      && (!q || norm(t.concept).includes(q) || (qn && /\d/.test(qn) && Math.abs(t.amount).toFixed(2).replace('.', ',').includes(qn.replace('.', ','))))
  ).sort((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);
}

export function renderMoves() {
  renderPeriod('mvPeriod');
  const s = app.state;
  $('fCat').innerHTML = '<option value="">Todas las categorías</option>' + catOptions(ui.fCat);
  $('fCat').value = ui.fCat;
  $('fAcct').hidden = !s.accounts.length;
  $('fAcct').innerHTML = '<option value="">Todas las cuentas</option>' + s.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('') + '<option value="-">Sin cuenta asignada</option>';
  $('fAcct').value = ui.fAcct;
  if ($('q').value !== ui.q) $('q').value = ui.q;
  const rows = filtered();
  $('mvCount').textContent = plural(rows.length, 'movimiento', 'movimientos');
  const acct = new Map(s.accounts.map((a) => [a.id, a.name]));
  const p = ui.pending;
  $('mvList').innerHTML = rows.length ? rows.slice(0, ui.mvLimit).map((t) => {
    const meta = esc([dShort(t.date), acct.get(t.acct) || t.src].filter(Boolean).join(' · '));
    const flags = (t.rv ? `<span class="tag rv" title="${esc(RV_LABEL[t.rv] || '')}">Por revisar</span>` : '') + (t.pair ? '<span class="tag" title="Traspaso entre tus cuentas">↔</span>' : '');
    let learn = '';
    if (p && p.id === t.id) {
      learn = p.auto
        ? `<div class="learn"><span>${p.changed ? `He pasado también <strong>${p.changed}</strong> ${p.changed === 1 ? 'movimiento' : 'movimientos'} con el nombre` : 'Recordaré el nombre'}</span><input type="text" id="learnKw" value="${esc(p.kw)}" aria-label="Nombre a reconocer"><span>a <strong>${esc(catName(p.cat))}</strong>.</span><button class="btn sm" type="button" data-learn="retext">Usar este nombre</button><button class="btn sm" type="button" data-learn="undo">Deshacer</button><button class="btn sm primary" type="button" data-learn="ok">Vale</button></div>`
        : `<div class="learn"><span>¿Poner en <strong>${esc(catName(p.cat))}</strong> todos los movimientos que contengan</span><input type="text" id="learnKw" value="${esc(p.kw)}" aria-label="Texto a buscar"><span class="muted" id="learnN">${countMatches(p.kw, p.sign, t.id)} más</span><button class="btn sm primary" type="button" data-learn="yes">Aplicar y recordar</button><button class="btn sm" type="button" data-learn="no">Solo este</button></div>`;
    }
    return `<li class="mv-row" data-id="${t.id}"><span class="c">${esc(t.concept)}</span><span class="a ${t.amount >= 0 ? 'pos' : ''}">${signed(t.amount)}</span>
      <span class="r2"><span class="meta">${flags}<span class="m-txt">${meta}</span></span><span class="sel"><select data-tx="${t.id}" aria-label="Categoría de ${esc(t.concept)}">${catOptions(t.cat, t.amount)}</select></span></span>${learn}</li>`;
  }).join('') : '<li class="empty">No hay movimientos que mostrar.</li>';
  $('moreBox').innerHTML = rows.length > ui.mvLimit ? `<button class="btn" type="button" id="moreBtn">Mostrar ${Math.min(200, rows.length - ui.mvLimit)} más</button>` : '';
}

export function bindMoves() {
  $('q').addEventListener('input', () => { ui.q = $('q').value; ui.mvLimit = 50; renderMoves(); });
  $('fCat').addEventListener('change', () => { ui.fCat = $('fCat').value; ui.mvLimit = 50; renderMoves(); });
  $('fAcct').addEventListener('change', () => { ui.fAcct = $('fAcct').value; ui.mvLimit = 50; renderMoves(); });
  $('moreBox').addEventListener('click', (e) => { if (e.target.id === 'moreBtn') { ui.mvLimit += 200; renderMoves(); } });
  const list = $('mvList');
  list.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-tx]');
    if (!sel) return;
    const t = app.state.tx.find((x) => x.id === sel.dataset.tx);
    if (!t) return;
    const wasOther = t.conf === 'none' || t.cat === 'otros_g' || t.cat === 'otros_i';
    t.cat = sel.value;
    t.manual = true;
    delete t.rv;
    const kw = suggestKw(t.concept), sign = ruleSign(t, t.cat);
    ui.pending = { id: t.id, cat: t.cat, kw, sign };
    // Leaving "Otros": every movement with the same name follows straight away (with undo).
    if (wasOther && kw) { const r = applyRule(kw, t.cat, sign); ui.pending.auto = true; ui.pending.undo = r && r.undo; ui.pending.changed = r ? r.changed : 0; }
    save();
    app.render();
  });
  list.addEventListener('input', (e) => {
    if (e.target.id === 'learnKw' && ui.pending && !ui.pending.auto) { ui.pending.kw = e.target.value; $('learnN').textContent = countMatches(ui.pending.kw, ui.pending.sign, ui.pending.id) + ' más'; }
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-learn]');
    if (!b || !ui.pending) return;
    const p = ui.pending, a = b.dataset.learn;
    if (a === 'yes') { const r = applyRule(p.kw, p.cat, p.sign); if (r) toast(r.changed ? `Regla guardada: ${plural(r.changed, 'movimiento cambiado', 'movimientos cambiados')}.` : 'Regla guardada.'); }
    else if (a === 'undo' && p.undo) p.undo();
    else if (a === 'retext') {
      if (p.undo) p.undo();
      p.kw = $('learnKw').value;
      const r = applyRule(p.kw, p.cat, p.sign);
      p.undo = r && r.undo; p.changed = r ? r.changed : 0;
      save(); app.render();
      return;
    }
    ui.pending = null;
    save();
    app.render();
  });
}
