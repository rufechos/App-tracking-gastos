// A refund takes the category of the purchase it reverses, so that it reduces that expense instead of
// counting as income while the purchase still counts as spending.
import { norm, cents, dayDiff } from './util.js';
import { tokens } from './dedup.js';

const REFUND = /(^| )(devolucion|devol|reembolso|refund|anulacion|abono compra|rectificacion|erstattung|gutschrift)( |$)/;
const NOT_MERCHANT = new Set(['devolucion', 'devol', 'reembolso', 'refund', 'anulacion', 'abono', 'rectificacion', 'compra', 'recibo', 'cargo', 'importe', 'parcial']);

export const isRefund = (t) => t.amount > 0 && REFUND.test(norm(t.concept));

// -> { cat, of } with the purchase found, or null.
export function matchRefund(t, txs, kindOf) {
  if (!isRefund(t)) return null;
  const words = [...tokens(t.concept)].filter((w) => !NOT_MERCHANT.has(w));
  if (!words.length) return null;
  let best = null;
  for (const u of txs) {
    if (u.amount >= 0 || u.id === t.id || -cents(u.amount) < cents(t.amount)) continue;
    const dd = dayDiff(u.date, t.date);
    if (dd < 0 || dd > 120 || kindOf(u.cat) !== 'gasto' || u.cat === 'transf_env' || u.cat === 'otros_g') continue;
    const ut = tokens(u.concept);
    if (!words.some((w) => ut.has(w))) continue;
    const score = (cents(u.amount) === -cents(t.amount) ? 1000 : 0) - dd;
    if (!best || score > best.score) best = { cat: u.cat, of: u.id, score };
  }
  return best && { cat: best.cat, of: best.of };
}
