// Learning from your corrections: a rule "movements with this name go to that category".
import { app } from '../store.js';
import { classify } from '../classify.js';
import { norm, wordMatch, plural } from '../util.js';
import { suggestKw } from '../categories.js';
import { kindOf, catName } from './cats.js';

export const ruleSign = (t, cat) => (['gasto', 'ingreso'].includes(kindOf(cat)) ? (t.amount < 0 ? 'gasto' : 'ingreso') : undefined);

export function countMatches(kw, sign, exceptId) {
  const k = norm(kw);
  if (!k) return 0;
  return app.state.tx.filter((t) => t.id !== exceptId && !t.manual && (!sign || (sign === 'gasto') === (t.amount < 0)) && wordMatch(norm(t.concept), k)).length;
}

// Adds (or replaces) the rule and recategorises. Returns how many movements changed and how to undo it.
export function applyRule(kw, cat, sign) {
  const k = norm(kw);
  if (!k) return null;
  const s = app.state;
  const prevRules = s.rules.slice();
  const before = new Map(s.tx.map((t) => [t.id, t.cat]));
  s.rules = s.rules.filter((r) => !(r.kw === k && (r.sign || null) === (sign || null)));
  s.rules.push(sign ? { kw: k, cat, sign } : { kw: k, cat });
  classify(s);
  const changed = s.tx.filter((t) => before.get(t.id) !== t.cat).length;
  return { kw: k, changed, undo: () => { s.rules = prevRules; classify(s); } };
}

// After you pick a category for a movement that had none: same-name movements follow at once (with undo).
export function learnFrom(t, wasOther) {
  const kw = suggestKw(t.concept);
  if (!wasOther || !kw) return null;
  const r = applyRule(kw, t.cat, ruleSign(t, t.cat));
  if (!r) return null;
  return { text: r.changed ? `También ${plural(r.changed, 'movimiento', 'movimientos')} con «${r.kw}» a ${catName(t.cat)}.` : `Recordaré «${r.kw}» → ${catName(t.cat)}.`, undo: r.undo };
}
