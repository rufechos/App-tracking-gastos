// Trade Republic's «Exportar transacciones» CSV (Ajustes › Extractos): every movement of the cash account and of the
// securities, one per row. Read as movements, or as the positions that its buys and sells leave.
import { norm, round2 } from '../util.js';
import { parseNum } from './numbers.js';
import { validIsin } from './positions.js';

const NEED = ['transaction_id', 'category', 'type', 'amount', 'shares'];

function header(rows) {
  const i = rows.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (i < 0) return null;
  const h = rows[i].map((c) => norm(c).replace(/[\s_]+/g, '_')); // norm() turns the underscores into spaces
  if (!NEED.every((k) => h.includes(k))) return null;
  const col = Object.fromEntries(h.map((k, j) => [k, j]));
  const get = (r, k) => (col[k] == null ? '' : String(r[col[k]] ?? '').trim());
  return { at: i, get };
}

export const isTrExport = (rows) => !!header(rows);

// Plain numbers ("-1260.00", "1.0504201681"); a file saved again by a Spanish Excel has decimal commas.
const num = (s) => (s === '' ? null : /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : parseNum(s));

function entries(rows) {
  const h = header(rows);
  if (!h) throw new Error('No es la exportación de transacciones de Trade Republic.');
  const out = [];
  for (const r of rows.slice(h.at + 1)) {
    const g = (k) => h.get(r, k);
    const date = (g('date') || g('datetime')).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      at: g('datetime') || date, date, cat: g('category').toUpperCase(), type: g('type').toUpperCase(), cls: g('asset_class'),
      name: g('name'), isin: g('symbol').toUpperCase(), shares: num(g('shares')), amount: num(g('amount')),
      fee: num(g('fee')), tax: num(g('tax')), desc: g('description'), id: g('transaction_id'),
      cpName: g('counterparty_name'), cpIban: g('counterparty_iban').replace(/\s+/g, '').toUpperCase(), mcc: g('mcc_code'),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const isBuy = (e) => (e.type === 'BUY' ? true : e.type === 'SELL' ? false : (e.amount || 0) < 0);

function conceptOf(e) {
  const t = e.type;
  if (e.cat === 'TRADING') return (isBuy(e) ? 'Compra de valores ' : 'Venta de valores ') + (e.name || e.isin);
  if (/CARD/.test(t)) return e.name || e.desc || 'Pago con tarjeta';
  if (/DIVIDEND|DISTRIBUTION/.test(t)) return 'Dividendo ' + (e.name || e.isin);
  if (/INTEREST/.test(t)) return 'Intereses';
  if (/SAVEBACK/.test(t)) return 'Saveback';
  if (/TRANSFER/.test(t)) return e.cpName || e.desc || (/OUT/.test(t) ? 'Transferencia enviada' : 'Transferencia recibida');
  return e.desc || e.name || t || '(sin concepto)';
}

// -> { tx: [{date, concept, amount, mcc?, cpName?, cpIban?}], iban }. Its transaction ids are not the bank sync's
// references, so they are left out: the avisos match movements by reference when there is one.
export function trRowsToTx(rows) {
  const tx = [];
  for (const e of entries(rows)) {
    if (e.amount == null) continue; // a security moving in or out: no money
    const amount = round2(e.amount - Math.abs(e.fee || 0) + (e.tax || 0));
    if (!amount) continue;
    const t = { date: e.date, concept: conceptOf(e).replace(/\s+/g, ' ').trim(), amount };
    if (/^\d{4}$/.test(e.mcc)) t.mcc = e.mcc;
    if (e.cpName) t.cpName = e.cpName;
    if (e.cpIban) t.cpIban = e.cpIban;
    tx.push(t);
  }
  if (!tx.length) throw new Error('No he encontrado movimientos en la exportación de Trade Republic.');
  return { tx, iban: '' };
}

// What the buys and sells leave, at average cost (fees included). The price is that of the last trade, until the
// prices are updated. -> [{name, isin, qty, cost, price, priceDate, costGuess}], with .note when something was left out.
export function trPositions(rows) {
  const by = new Map();
  let skipped = 0;
  for (const e of entries(rows)) {
    const trade = e.cat === 'TRADING', moved = e.cat === 'DELIVERY' || /RECEIPT|DELIVERY/.test(e.type);
    if (!trade && !moved) { if (e.cat !== 'CASH' && e.shares && validIsin(e.isin)) skipped++; continue; } // a dividend also says how many you had
    const q = Math.abs(e.shares || 0);
    if (!q || !validIsin(e.isin)) { skipped++; continue; }
    const p = by.get(e.isin) || { name: e.name || e.isin, isin: e.isin, qty: 0, cost: 0, price: null, priceDate: null, costGuess: false };
    if (e.name) p.name = e.name;
    const into = trade ? isBuy(e) : /RECEIPT|INBOUND/.test(e.type) || (e.shares > 0 && !/OUT/.test(e.type));
    if (into) {
      p.qty += q;
      if (trade && e.amount != null) p.cost += Math.abs(e.amount) + Math.abs(e.fee || 0) + Math.abs(Math.min(e.tax || 0, 0));
      else p.costGuess = true; // received from another broker: what it cost is not in the file
    } else {
      const sold = Math.min(q, p.qty);
      if (p.qty > 0) p.cost -= p.cost * (sold / p.qty);
      p.qty -= sold;
    }
    if (trade && e.amount) { p.price = Math.abs(e.amount) / q; p.priceDate = e.date; }
    by.set(e.isin, p);
  }
  const out = [...by.values()].filter((p) => p.qty > 1e-7)
    .map((p) => ({ ...p, qty: Math.round(p.qty * 1e8) / 1e8, cost: round2(Math.max(p.cost, 0)), price: p.price != null ? Math.round(p.price * 1e4) / 1e4 : null }));
  if (!out.length) throw new Error('La exportación de Trade Republic no deja ninguna posición abierta.');
  if (skipped) out.note = `${skipped === 1 ? 'Un movimiento de valores' : skipped + ' movimientos de valores'} (como un desdoblamiento) no se ha${skipped === 1 ? '' : 'n'} podido tener en cuenta: revisa los títulos con «Editar».`;
  return out;
}
