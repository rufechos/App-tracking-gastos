// «Mis cuentas»: your accounts, cards and brokers, and the movements between them, which are neither income nor expense.
import { norm, wordMatch, dayDiff, cents, uid, cleanIban } from './util.js';

export const ACCOUNT_KINDS = { banco: 'Cuenta bancaria', tarjeta: 'Tarjeta de crédito', broker: 'Bróker', ahorro: 'Cuenta de ahorro' };

// Names as they show up in the other bank's concepts. Keep them specific: "air europa" alone would catch flights.
const KNOWN = [
  { re: /bankinter consumer|bankintercard|air europa/, name: 'Tarjeta Air Europa', kind: 'tarjeta', aliases: ['bankinter consumer finance', 'bankintercard', 'tarjeta air europa'] },
  { re: /trade ?republic/, name: 'Trade Republic', kind: 'broker', aliases: ['trade republic', 'traderepublic'] },
  { re: /renta ?4/, name: 'Renta 4', kind: 'broker', aliases: ['renta 4', 'renta4', 'renta 4 banco'] },
  { re: /^ing\b|ing bank|ing direct/, name: 'ING', kind: 'banco', aliases: ['ing', 'ing bank', 'ing direct'] },
  { re: /bankinter/, name: 'Bankinter', kind: 'banco', aliases: ['bankinter'] },
  { re: /myinvestor/, name: 'MyInvestor', kind: 'broker', aliases: ['myinvestor'] },
  { re: /indexa/, name: 'Indexa Capital', kind: 'broker', aliases: ['indexa', 'indexa capital'] },
  { re: /revolut/, name: 'Revolut', kind: 'banco', aliases: ['revolut'] },
  { re: /wizink/, name: 'WiZink', kind: 'tarjeta', aliases: ['wizink'] },
];
const BANK_CODES = { 1465: 'ING', '0128': 'Bankinter', '0083': 'Renta 4 Banco', '0049': 'Santander', '0182': 'BBVA', 2100: 'CaixaBank', '0081': 'Sabadell',
  '0073': 'Openbank', 2080: 'Abanca', 2085: 'Ibercaja', 2103: 'Unicaja', 2095: 'Kutxabank', 3058: 'Cajamar', '0239': 'EVO Banco', '0186': 'Mediolanum',
  1491: 'Triodos', '0061': 'Banca March', 3035: 'Laboral Kutxa', '0019': 'Deutsche Bank', 1583: 'Revolut', '0237': 'Cajasur', 2048: 'Liberbank' };

export function guessAccount(name) {
  const n = norm(name);
  const k = KNOWN.find((x) => x.re.test(n));
  return k ? { kind: k.kind, aliases: k.aliases.slice() } : { kind: 'banco', aliases: n && n.length > 3 ? [n] : [] };
}
export const bankFromIban = (iban) => (iban && iban.startsWith('ES') ? BANK_CODES[iban.slice(4, 8)] || '' : '');

export function makeAccount(o) {
  const g = guessAccount(o.name || '');
  return { id: 'a_' + uid(), name: o.name || 'Cuenta', kind: o.kind || g.kind, iban: cleanIban(o.iban) || '', aliases: o.aliases || g.aliases, track: o.track || 'auto', ...(o.ebHash ? { ebHash: o.ebHash } : {}) };
}

// Is this account's own movement list in the app? Then money sent to it is a transfer, not spending or investing.
export function trackedSet(accounts, txs) {
  const has = new Set(txs.map((t) => t.acct).filter(Boolean));
  return new Set(accounts.filter((a) => a.track === 'si' || (a.track !== 'no' && has.has(a.id))).map((a) => a.id));
}

const HINT = /(^| )(traspaso|traspasos|transferencia|transf|trf|ingreso|deposit|einzahlung|uberweisung|auszahlung|withdrawal|top up|recarga|abono|liquidacion|pago recibido|su pago|pago tarjeta|recibo tarjeta|sepa)( |$)/;
const CARD_PAYMENT_IN = /(^| )(pago recibido|su pago|abono recibo|pago tarjeta|liquidacion|recibo|domiciliacion|pago cuota|payment received|gracias)( |$)/;

// -> Map txId -> { cat, rv?, pair?, to? }  for movements that are transfers between your own accounts.
// The other side is found by the other party's IBAN, by the other account's name in the concept, by your own
// name as the other party, or as an equal and opposite movement in another of your accounts within 3 days.
export function detectTransfers(txs, accounts, owners = []) {
  const out = new Map();
  if (!txs.length) return out;
  const tracked = trackedSet(accounts, txs);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const al = accounts.map((a) => ({ a, aliases: (a.aliases || []).map(norm).filter((x) => x.length > 1) }));
  const ownerNames = owners.map(norm).filter((x) => x.split(' ').length >= 2);
  const cards = accounts.filter((a) => a.kind === 'tarjeta');
  const info = new Map();
  for (const t of txs) {
    const n = norm(t.concept + ' ' + (t.cpName || ''));
    let to = null;
    if (t.cpIban) to = accounts.find((a) => a.iban && a.iban === t.cpIban && a.id !== t.acct) || null;
    if (!to) to = (al.find((x) => x.a.id !== t.acct && x.aliases.some((k) => wordMatch(n, k))) || {}).a || null;
    const owner = ownerNames.some((o) => wordMatch(n, o));
    info.set(t.id, { t, n, to, owner, hint: !!to || owner || HINT.test(n) });
  }
  // Pairs: equal and opposite amounts in different accounts (or different files when the account is unknown).
  const byAmount = new Map();
  for (const x of info.values()) {
    const k = cents(x.t.amount);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(x);
  }
  const paired = new Set();
  const sorted = [...info.values()].filter((x) => x.hint).sort((a, b) => (b.to ? 1 : 0) - (a.to ? 1 : 0) || a.t.date.localeCompare(b.t.date));
  for (const x of sorted) {
    if (paired.has(x.t.id)) continue;
    const cands = (byAmount.get(-cents(x.t.amount)) || []).filter((y) => !paired.has(y.t.id) && Math.abs(dayDiff(x.t.date, y.t.date)) <= 3 &&
      (x.t.acct && y.t.acct ? x.t.acct !== y.t.acct : (x.t.fid || x.t.src) !== (y.t.fid || y.t.src)));
    let best = null, bestScore = -1;
    for (const y of cands) {
      const sure = (x.to && x.to.id === y.t.acct) || (y.to && y.to.id === x.t.acct) || x.owner || y.owner;
      if (!sure && !(x.hint && y.hint)) continue;
      const score = (sure ? 100 : 0) + (y.hint ? 10 : 0) - Math.abs(dayDiff(x.t.date, y.t.date));
      if (score > bestScore) { best = { y, sure }; bestScore = score; }
    }
    if (!best) continue;
    paired.add(x.t.id); paired.add(best.y.t.id);
    const rv = best.sure ? undefined : 'transfer';
    out.set(x.t.id, { cat: 'excluir', pair: best.y.t.id, rv, to: best.y.t.acct || null });
    out.set(best.y.t.id, { cat: 'excluir', pair: x.t.id, rv, to: x.t.acct || null });
  }
  const trackedCard = cards.find((c) => tracked.has(c.id));
  for (const x of info.values()) {
    if (out.has(x.t.id)) continue;
    const own = x.t.acct && byId.get(x.t.acct);
    if (own && own.kind === 'tarjeta' && x.t.amount > 0 && CARD_PAYMENT_IN.test(x.n)) { out.set(x.t.id, { cat: 'excluir' }); continue; }
    let to = x.to;
    if (!to && x.t.amount < 0 && x.t.baseCat === 'tarjeta' && cards.length === 1) to = cards[0];
    if (to) {
      if (tracked.has(to.id)) out.set(x.t.id, { cat: 'excluir', to: to.id });
      else if (to.kind === 'broker') out.set(x.t.id, { cat: 'inversion', to: to.id });
      else if (to.kind === 'tarjeta') out.set(x.t.id, { cat: x.t.amount < 0 ? 'tarjeta' : 'excluir', to: to.id });
      else out.set(x.t.id, { cat: 'excluir', to: to.id });
    } else if (x.t.baseCat === 'tarjeta' && trackedCard) out.set(x.t.id, { cat: 'excluir', to: trackedCard.id });
    else if (x.owner && HINT.test(x.n)) out.set(x.t.id, { cat: 'excluir', rv: 'transfer' });
  }
  return out;
}
