// The «Por revisar» list on Inicio.
import { app, save } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { catOptions, catName } from './cats.js';
import { RV_LABEL, reviewItems, confirmDuplicate, settle } from '../review.js';
import { signed, dShort, plural } from '../util.js';
import { learnFrom } from './learn.js';

let showAll = false;

export function reviewCount() { return app.state.tx.reduce((n, t) => n + (t.rv ? 1 : 0), 0); }

export function renderReview() {
  const items = reviewItems(app.state);
  $('reviewPanel').hidden = !items.length;
  if (!items.length) return;
  $('reviewCount').textContent = plural(items.length, 'movimiento', 'movimientos');
  const acct = new Map(app.state.accounts.map((a) => [a.id, a.name]));
  const shown = showAll ? items : items.slice(0, 5);
  $('reviewList').innerHTML = shown.map((t) => {
    const other = t.rv === 'dup' && app.state.tx.find((x) => x.id === t.dupOf);
    const where = [dShort(t.date), acct.get(t.acct) || t.src].filter(Boolean).map(esc).join(' · ');
    let acts;
    if (t.rv === 'dup') {
      acts = `<span class="small muted">${other ? 'Ya tenías «' + esc(other.concept) + '» del ' + dShort(other.date) + (other.src ? ' (' + esc(other.src) + ')' : '') : ''}</span>
        <button class="btn sm primary" type="button" data-rv-same="${t.id}">Es el mismo, quitar este</button>
        <button class="btn sm" type="button" data-rv-ok="${t.id}">Son distintos</button>`;
    } else if (t.rv === 'transfer') {
      acts = `<button class="btn sm primary" type="button" data-rv-ok="${t.id}">Sí, entre mis cuentas</button>
        <select data-rv-cat="${t.id}" aria-label="Otra categoría">${catOptions(t.cat === 'excluir' ? '' : t.cat, t.amount)}<option value="" selected hidden>No, es…</option></select>`;
    } else {
      acts = `<select data-rv-cat="${t.id}" aria-label="Categoría">${catOptions(t.cat, t.amount)}</select><button class="btn sm primary" type="button" data-rv-ok="${t.id}">Correcto</button>`;
    }
    return `<li class="rv-item"><span>${esc(t.concept)}<div class="small muted">${where} · ${esc(catName(t.cat))}</div></span>
      <span class="num ${t.amount >= 0 ? 'pos' : ''}">${signed(t.amount)}</span>
      <span class="why">${RV_LABEL[t.rv] || ''}</span><div class="acts">${acts}</div></li>`;
  }).join('');
  const rest = items.length - shown.length;
  const easy = items.filter((t) => t.rv === 'otros' || t.rv === 'generic').length;
  $('reviewMore').innerHTML = (rest > 0 ? `<button class="btn" type="button" data-rv-all>Ver los ${items.length}</button>` : '')
    + (easy > 1 ? ` <button class="btn" type="button" data-rv-accept>Dar por buenas las ${easy} categorías</button>` : '');
}

export function bindReview(rerender) {
  const list = $('reviewPanel');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv-same],[data-rv-ok],[data-rv-all],[data-rv-accept]');
    if (!b) return;
    if (b.dataset.rvSame) { confirmDuplicate(app.state, b.dataset.rvSame); toast('Duplicado quitado.'); }
    else if (b.dataset.rvOk) settle(app.state, b.dataset.rvOk);
    else if (b.hasAttribute('data-rv-all')) { showAll = true; renderReview(); return; }
    else if (b.hasAttribute('data-rv-accept')) { for (const t of app.state.tx) if (t.rv === 'otros' || t.rv === 'generic') delete t.rv; }
    save();
    rerender();
  });
  list.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-rv-cat]');
    if (!s || !s.value) return;
    const t = app.state.tx.find((x) => x.id === s.dataset.rvCat);
    if (!t) return;
    const wasOther = t.conf === 'none';
    settle(app.state, t.id, s.value);
    const learned = learnFrom(t, wasOther);
    save();
    rerender();
    if (learned) toast(learned.text, learned.undo ? { label: 'Deshacer', run: () => { learned.undo(); save(); rerender(); } } : null);
  });
}
export const resetReviewView = () => { showAll = false; };
