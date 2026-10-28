// Your categorisation rules: cleaning what you type in the editor and what a rule would change before you save it.
import { norm } from './util.js';
import { ruleMatches } from './categories.js';

export function cleanRule(r) {
  const kw = norm(r.kw);
  if (!kw || !r.cat) return null;
  const out = { kw, cat: r.cat };
  if (r.sign === 'gasto' || r.sign === 'ingreso') out.sign = r.sign;
  if (r.min != null && isFinite(r.min) && r.min > 0) out.min = Math.abs(r.min);
  if (r.max != null && isFinite(r.max) && r.max > 0) out.max = Math.abs(r.max);
  if (r.acct) out.acct = r.acct;
  return out;
}

// rules: the list as it would be saved; index: the rule to look at (a later rule that also matches wins).
// -> { n: movements it matches, manual: those you set by hand (they keep their category), change: [movements that would move] }
export function rulePreview(state, rules, index) {
  const r = rules[index], later = rules.slice(index + 1);
  let n = 0, manual = 0;
  const change = [];
  for (const t of state.tx) {
    const c = norm(t.concept);
    if (!ruleMatches(r, c, t) || later.some((x) => ruleMatches(x, c, t))) continue;
    n++;
    if (t.manual) manual++;
    else if (t.cat !== r.cat) change.push(t);
  }
  change.sort((a, b) => b.date.localeCompare(a.date));
  return { n, manual, change };
}
