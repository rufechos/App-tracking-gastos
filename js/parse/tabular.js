// Bank statements as rows (CSV or spreadsheet): finds the header row, or infers the columns from the content.
import { norm, round2, findIban } from '../util.js';
import { parseNum, parseDate } from './numbers.js';

const H = {
  concept: /concepto|descrip|detalle|movimiento|observ|beneficiario|comercio|ordenante|referencia|description|payee|texto|establecimiento/,
  debit: /cargo|debe|adeudo|gasto|debit|salida/,
  credit: /abono|haber|ingreso|credit|entrada/,
  balance: /saldo|balance/,
};
// Several date columns: the operation date matches what the bank sync reports, then plain "fecha", then the others.
const DATE_PRIORITY = [/oper|transac|compra/, /^fecha$|^date$|^dia$/, /contable|booking|registro/, /valor|value/];

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const h = rows[i].map((c) => norm(c));
    const find = (re, ex) => h.findIndex((x) => x && re.test(x) && !(ex && ex.test(x)));
    const dates = h.map((x, j) => j).filter((j) => /^(fecha|date|f oper|f valor|f contable|dia\b|booking date|value date)/.test(h[j]));
    if (!dates.length) continue;
    const ai = find(/importe|cantidad|amount|monto/, /saldo|balance|original|divisa/);
    const de = find(H.debit, /saldo|fecha/), cr = find(H.credit, /saldo|fecha/);
    if (ai < 0 && !(de >= 0 && cr >= 0)) continue;
    let di = dates[0];
    for (const re of DATE_PRIORITY) { const j = dates.find((k) => re.test(h[k])); if (j != null) { di = j; break; } }
    const ci = find(H.concept, /fecha|importe/);
    const bi = find(H.balance, /fecha/);
    const extras = h.map((x, j) => j).filter((j) => j !== ci && /mas datos|observ|detalle|descrip|beneficiario|comercio|movimiento/.test(h[j]));
    return { at: i, map: { date: di, amount: ai, debit: de, credit: cr, concept: ci, balance: bi, extras } };
  }
  return null;
}

function inferColumns(rows) {
  const sample = rows.slice(0, 200), nc = Math.max(...sample.map((r) => r.length));
  const score = (fn) => { const out = []; for (let j = 0; j < nc; j++) { let c = 0; sample.forEach((r) => { if (fn(r[j])) c++; }); out.push(c / sample.length); } return out; };
  const ds = score((v) => parseDate(v) != null), di = ds.indexOf(Math.max(...ds));
  if (ds[di] < 0.4) throw new Error('No encuentro una columna de fechas.');
  const ns = score((v) => v !== '' && v != null && parseDate(v) == null && parseNum(v) != null);
  const numCols = ns.map((s, j) => [s, j]).filter((x) => x[0] > 0.4 && x[1] !== di).map((x) => x[1]);
  if (!numCols.length) throw new Error('No encuentro una columna de importes.');
  const ls = [];
  for (let j = 0; j < nc; j++) { let t = 0; sample.forEach((r) => { const v = r[j]; if (typeof v === 'string' && parseNum(v) == null && parseDate(v) == null) t += v.length; }); ls.push(t); }
  return { date: di, amount: numCols[0], debit: -1, credit: -1, concept: ls.indexOf(Math.max(...ls)), balance: numCols.length > 1 ? numCols[numCols.length - 1] : -1, extras: [] };
}

// -> { tx: [{date, concept, amount, bal?}], iban }  (iban: the account's IBAN when the file shows it, validated)
export function rowsToTx(rows) {
  rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  const head = findHeader(rows);
  const map = head ? head.map : inferColumns(rows);
  const body = head ? rows.slice(head.at + 1) : rows;
  const iban = findIban(rows.slice(0, head ? head.at + 1 : 15).map((r) => r.join(' ')).join(' '));
  const tx = [];
  for (const r of body) {
    const date = parseDate(r[map.date]);
    if (!date) continue;
    let amt = map.amount >= 0 ? parseNum(r[map.amount]) : null;
    if ((amt == null || amt === 0) && (map.debit >= 0 || map.credit >= 0)) {
      const de = map.debit >= 0 ? parseNum(r[map.debit]) : null, cr = map.credit >= 0 ? parseNum(r[map.credit]) : null;
      if (de) amt = -Math.abs(de); else if (cr) amt = Math.abs(cr);
    }
    if (amt == null || amt === 0) continue;
    let concept = map.concept >= 0 ? String(r[map.concept] ?? '').trim() : '';
    for (const j of map.extras) { const e = String(r[j] ?? '').trim(); if (e && !concept.includes(e)) concept += (concept ? ' · ' : '') + e; }
    if (!concept) concept = r.filter((c, j) => j !== map.date && typeof c === 'string' && parseNum(c) == null).join(' ').trim() || '(sin concepto)';
    const t = { date, concept: concept.replace(/\s+/g, ' '), amount: round2(amt) };
    const bal = map.balance >= 0 ? parseNum(r[map.balance]) : null;
    if (bal != null && map.balance !== map.amount) t.bal = round2(bal);
    tx.push(t);
  }
  return { tx, iban };
}
