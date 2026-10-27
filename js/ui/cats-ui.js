// Ajustes › Categorías y reglas: your categories, and the rules with their editor (conditions and what changes).
import { app, save } from '../store.js';
import { $, esc, toast } from './dom.js';
import { catName, catOptions } from './cats.js';
import { classify } from '../classify.js';
import { KINDS, KIND_LABEL } from '../categories.js';
import { cleanRule, rulePreview } from '../rules.js';
import { parseNum } from '../parse/numbers.js';
import { uid, money, signed, dShort, plural } from '../util.js';

const ruleCond = (s, r) => [r.sign === 'gasto' ? 'solo gastos' : r.sign === 'ingreso' ? 'solo ingresos' : '', r.min != null ? 'desde ' + money(r.min) : '', r.max != null ? 'hasta ' + money(r.max) : '',
  r.acct ? 'en ' + ((s.accounts.find((a) => a.id === r.acct) || {}).name || 'una cuenta') : ''].filter(Boolean).join(', ');

export function renderCats() {
  const s = app.state, counts = {};
  for (const t of s.tx) counts[t.cat] = (counts[t.cat] || 0) + 1;
  $('cats').innerHTML = KINDS.map((k) => `<div><h3>${KIND_LABEL[k]}</h3><ul class="cat-list">` + s.cats.filter((c) => c.kind === k).map((c) => `<li><span>${esc(c.name)} <span class="muted num">(${counts[c.id] || 0})</span></span>${c.custom ? `<button class="x" type="button" data-delcat="${c.id}" aria-label="Eliminar ${esc(c.name)}">×</button>` : ''}</li>`).join('') + '</ul></div>').join('');
  $('rules').innerHTML = s.rules.length ? s.rules.map((r, i) => `<li><span>«${esc(r.kw)}» → ${esc(catName(r.cat))}${ruleCond(s, r) ? ` <span class="muted">(${esc(ruleCond(s, r))})</span>` : ''}</span>
      <span class="tools"><button class="btn sm" type="button" data-editrule="${i}">Editar</button><button class="x" type="button" data-delrule="${i}" aria-label="Eliminar la regla «${esc(r.kw)}»">×</button></span></li>`).join('')
    : '<li class="muted">Todavía no hay reglas. Cambia la categoría de un movimiento o pulsa «Nueva regla».</li>';
}

// The rule as typed in the editor, or null with what is wrong.
function formRule() {
  const num = (id) => { const v = $(id).value.trim(); return v ? parseNum(v) : null; };
  const min = num('ruMin'), max = num('ruMax');
  if (($('ruMin').value.trim() && min == null) || ($('ruMax').value.trim() && max == null)) return { error: 'Los importes deben ser números.' };
  if (min != null && max != null && Math.abs(min) > Math.abs(max)) return { error: '«Desde» es mayor que «Hasta».' };
  const r = cleanRule({ kw: $('ruKw').value, cat: $('ruCat').value, sign: $('ruSign').value, min: min == null ? null : Math.abs(min), max: max == null ? null : Math.abs(max), acct: $('ruAcct').value });
  return r ? { rule: r } : { error: 'Escribe el texto que tiene que contener el concepto.' };
}

// The rules as they would be saved, and where the edited one sits.
function draft(rule) {
  const s = app.state, idx = $('ruIdx').value;
  if (idx !== '') { const list = s.rules.slice(); list[+idx] = rule; return { list, at: +idx }; }
  return { list: s.rules.concat(rule), at: s.rules.length };
}

function renderPreview() {
  const f = formRule(), box = $('rulePreview');
  if (f.error) { box.innerHTML = $('ruKw').value.trim() ? `<span class="err">${esc(f.error)}</span>` : ''; return; }
  const { list, at } = draft(f.rule), p = rulePreview(app.state, list, at);
  if (!p.n) { box.innerHTML = '<span class="muted">Ahora no encaja con ningún movimiento; se aplicará a los que lleguen.</span>'; return; }
  box.innerHTML = `<p><strong>${plural(p.n, 'movimiento encaja', 'movimientos encajan')}</strong>${p.change.length ? `; ${plural(p.change.length, 'cambiaría', 'cambiarían')} de categoría` : ' y ya están en esa categoría'}${p.manual ? `. ${plural(p.manual, 'lo pusiste', 'los pusiste')} tú a mano y no se toca${p.manual === 1 ? '' : 'n'}` : ''}.</p>`
    + (p.change.length ? '<ul class="plain-list">' + p.change.slice(0, 6).map((t) => `<li class="pl-item"><span class="n">${esc(t.concept)}</span><span class="num ${t.amount >= 0 ? 'pos' : ''}">${signed(t.amount)}</span>
        <span class="meta">${dShort(t.date)} · ${esc(catName(t.cat))} → <strong>${esc(catName(f.rule.cat))}</strong></span></li>`).join('') + (p.change.length > 6 ? `<li class="muted small">Y ${p.change.length - 6} más.</li>` : '') + '</ul>' : '');
}

function openEditor(i) {
  const s = app.state, r = i == null ? null : s.rules[i];
  $('ruIdx').value = i == null ? '' : String(i);
  $('ruleTitle').textContent = r ? 'Editar regla' : 'Nueva regla';
  $('ruKw').value = r ? r.kw : '';
  $('ruCat').innerHTML = catOptions(r ? r.cat : 'otros_g');
  $('ruSign').value = r && r.sign ? r.sign : '';
  $('ruMin').value = r && r.min != null ? String(r.min).replace('.', ',') : '';
  $('ruMax').value = r && r.max != null ? String(r.max).replace('.', ',') : '';
  $('ruAcct').innerHTML = '<option value="">Cualquiera</option>' + s.accounts.map((a) => `<option value="${a.id}"${r && r.acct === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  $('ruleForm').hidden = false;
  renderPreview();
  $('ruKw').focus();
}
const closeEditor = () => { $('ruleForm').hidden = true; $('rulePreview').innerHTML = ''; };

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
    if (s.budgets) delete s.budgets[id];
    for (const t of s.tx) if (t.cat === id) { delete t.manual; t.cat = null; }
    classify(s);
    save();
    app.render();
  });
  $('rules').addEventListener('click', (e) => {
    const d = e.target.closest('[data-delrule]'), ed = e.target.closest('[data-editrule]');
    if (ed) { openEditor(+ed.dataset.editrule); return; }
    if (!d) return;
    app.state.rules.splice(+d.dataset.delrule, 1);
    closeEditor();
    classify(app.state);
    save();
    app.render();
  });
  $('ruleNew').addEventListener('click', () => openEditor(null));
  $('ruCancel').addEventListener('click', closeEditor);
  for (const ev of ['input', 'change']) $('ruleForm').addEventListener(ev, renderPreview);
  $('ruleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formRule();
    if (f.error) { renderPreview(); return; }
    const s = app.state, prev = s.rules.slice(), before = new Map(s.tx.map((t) => [t.id, t.cat]));
    s.rules = draft(f.rule).list;
    classify(s);
    const changed = s.tx.filter((t) => before.get(t.id) !== t.cat).length;
    closeEditor();
    save();
    app.render();
    toast(changed ? `Regla guardada: ${plural(changed, 'movimiento cambiado', 'movimientos cambiados')}.` : 'Regla guardada.', { label: 'Deshacer', run: () => { s.rules = prev; classify(s); save(); app.render(); } });
  });
}
