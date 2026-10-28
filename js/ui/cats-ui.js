// Ajustes › Categorías y reglas aprendidas.
import { app, save } from '../store.js';
import { $, esc } from './dom.js';
import { catName } from './cats.js';
import { classify } from '../classify.js';
import { KINDS, KIND_LABEL } from '../categories.js';
import { uid, money } from '../util.js';

export function renderCats() {
  const s = app.state, counts = {};
  for (const t of s.tx) counts[t.cat] = (counts[t.cat] || 0) + 1;
  $('cats').innerHTML = KINDS.map((k) => `<div><h3>${KIND_LABEL[k]}</h3><ul class="cat-list">` + s.cats.filter((c) => c.kind === k).map((c) => `<li><span>${esc(c.name)} <span class="muted num">(${counts[c.id] || 0})</span></span>${c.custom ? `<button class="x" type="button" data-delcat="${c.id}" aria-label="Eliminar ${esc(c.name)}">×</button>` : ''}</li>`).join('') + '</ul></div>').join('');
  const cond = (r) => [r.sign === 'gasto' ? 'solo gastos' : r.sign === 'ingreso' ? 'solo ingresos' : '', r.min != null ? 'desde ' + money(r.min) : '', r.max != null ? 'hasta ' + money(r.max) : '', r.acct ? 'en ' + ((s.accounts.find((a) => a.id === r.acct) || {}).name || 'una cuenta') : ''].filter(Boolean).join(', ');
  $('rules').innerHTML = s.rules.length ? s.rules.map((r, i) => `<li><span>«${esc(r.kw)}» → ${esc(catName(r.cat))}${cond(r) ? ` <span class="muted">(${esc(cond(r))})</span>` : ''}</span><button class="x" type="button" data-delrule="${i}" aria-label="Eliminar regla">×</button></li>`).join('')
    : '<li class="muted">Todavía no hay reglas. Cambia la categoría de un movimiento para crear una.</li>';
}

export function bindCats() {
  $('addCat').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('newCatName').value.trim();
    if (!n) return;
    app.state.cats.push({ id: 'c_' + uid(), name: n, kind: $('newCatKind').value, custom: true });
    $('newCatName').value = '';
    save();
    app.render();
  });
  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delcat]');
    if (!b) return;
    const s = app.state, id = b.dataset.delcat;
    s.rules = s.rules.filter((r) => r.cat !== id);
    s.cats = s.cats.filter((c) => c.id !== id);
    for (const t of s.tx) if (t.cat === id) { delete t.manual; t.cat = null; }
    classify(s);
    save();
    app.render();
  });
  $('rules').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delrule]');
    if (!b) return;
    app.state.rules.splice(+b.dataset.delrule, 1);
    classify(app.state);
    save();
    app.render();
  });
}
