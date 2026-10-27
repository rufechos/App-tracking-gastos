// Category lookups and the category selector.
import { app } from '../store.js';
import { esc } from '../util.js';
import { KINDS, KIND_LABEL } from '../categories.js';

export const catById = (id) => app.state.cats.find((c) => c.id === id) || app.state.cats.find((c) => c.id === 'otros_g');
export const kindOf = (id) => (app.state.cats.find((c) => c.id === id) || {}).kind;
export const catName = (id) => (catById(id) || {}).name || '?';

// For a positive amount the income categories come first; an expense category there means "it reduces that expense".
export function catOptions(sel, amount = -1) {
  const order = amount >= 0 ? ['ingreso', 'inversion', 'excluir', 'gasto'] : ['gasto', 'inversion', 'excluir', 'ingreso'];
  const label = (k) => (amount >= 0 && k === 'gasto' ? 'Resta de un gasto' : amount < 0 && k === 'ingreso' ? 'Ingresos' : KIND_LABEL[k]);
  return order.filter((k) => KINDS.includes(k)).map((k) => `<optgroup label="${label(k)}">` + app.state.cats.filter((c) => c.kind === k)
    .map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>').join('');
}
