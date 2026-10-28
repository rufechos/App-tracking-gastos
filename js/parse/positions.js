// Broker position reports (Renta 4, Trade Republic and others): spreadsheet rows or PDF text lines.
import { norm, round2 } from '../util.js';
import { parseNum } from './numbers.js';

export const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;

// ISO 6166 check digit, so that random 12-character codes are not taken for ISINs.
export function validIsin(s) {
  const v = String(s || '').toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v)) return false;
  const digits = v.slice(0, 11).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let n = +digits[i];
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return (10 - (sum % 10)) % 10 === +v[11];
}
const isinIn = (text) => { const m = String(text || '').toUpperCase().match(new RegExp(ISIN_RE.source, 'g')) || []; return m.find(validIsin) || ''; };

// -> [{name, isin, qty, cost, price, costGuess}]
export function rowsToPositions(rows) {
  rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const h = rows[i].map((c) => norm(c));
    const f = (re, ex) => h.findIndex((x) => x && re.test(x) && !(ex && ex.test(x)));
    const qi = f(/titulos|cantidad|participaciones|acciones|unidades|\buds\b|shares|quantity|nominal|stuck/, /importe|valor/);
    const ni = f(/nombre|producto|instrumento|descripcion|activo|security|denominacion|^valor$|^fondo|^titulo$|name|emisora/, /isin|valoracion|cotizacion/);
    const ii = f(/isin/);
    if (qi < 0 || (ni < 0 && ii < 0)) continue;
    const pmi = f(/precio medio|pm compra|coste medio|precio de compra|avg|average|cambio medio/);
    const ci = f(/coste|costo|importe invertido|invertido|cost|efectivo compra|importe compra/, /medio|unit/);
    const pi = f(/cotizacion|precio actual|ultimo|valor liquidativo|^precio$|price|last|^vl$/, /medio|compra/);
    const vi = f(/valoracion|valor de mercado|valor actual|importe actual|market value|valor efectivo|^valor total|^importe$|^saldo/);
    const out = [];
    for (const r of rows.slice(i + 1)) {
      const qty = parseNum(r[qi]);
      if (qty == null || qty === 0) continue;
      let isin = ii >= 0 ? String(r[ii] || '').trim().toUpperCase() : '';
      if (!validIsin(isin)) isin = isinIn(r.join(' '));
      const name = String((ni >= 0 ? r[ni] : '') || isin).trim();
      if (!name || /^total/i.test(name)) continue;
      let cost = ci >= 0 ? parseNum(r[ci]) : null;
      if (cost == null && pmi >= 0) { const pm = parseNum(r[pmi]); if (pm != null) cost = pm * qty; }
      let price = pi >= 0 ? parseNum(r[pi]) : null;
      const val = vi >= 0 ? parseNum(r[vi]) : null;
      if (price == null && val != null) price = val / qty;
      out.push({ name, isin, qty: Math.abs(qty), cost: round2(cost != null ? Math.abs(cost) : val != null ? Math.abs(val) : 0), price: price != null ? Math.abs(price) : null, costGuess: cost == null });
    }
    if (out.length) return out;
  }
  const titles = headerGuess(rows);
  throw new Error('No encuentro columnas de títulos y nombre o ISIN en el archivo.' + (titles.length ? ' Columnas que veo: ' + titles.join(' · ') + '.' : ''));
}

// The first row that reads like column titles (text, not figures): shown when a report is not understood, so that
// the titles alone, without any of your figures, are enough to teach the app a new format.
function headerGuess(rows) {
  for (const r of rows.slice(0, 60)) {
    const cells = r.map((c) => String(c ?? '').trim()).filter(Boolean);
    const words = cells.filter((c) => parseNum(c) == null && !validIsin(c) && c.length <= 40);
    if (cells.length >= 3 && words.length === cells.length) return words.slice(0, 15);
  }
  return [];
}

// PDF statements list one position per ISIN; the figures sit on the ISIN line or on the name line next to it.
export function linesToPositions(lines) {
  const out = [];
  const NUM = /-?\d{1,3}(?:\.\d{3})*,\d+|-?\d+,\d+|\b\d+\b/g;
  const hasNums = (t) => ((t || '').replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, ' ').match(NUM) || []).length >= 2;
  lines.forEach((l, i) => {
    const isin = isinIn(l);
    if (!isin) return;
    const own = l.replace(isin, ' ').replace(/ISIN:?/i, ' ');
    const src = hasNums(own) ? own : hasNums(lines[i - 1]) && !isinIn(lines[i - 1]) ? lines[i - 1] : (lines[i + 1] && !isinIn(lines[i + 1]) ? lines[i + 1] : '');
    const nums = (src.replace(isin, ' ').replace(/ISIN:?/i, ' ').replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, ' ').match(NUM) || [])
      .map(parseNum).filter((n) => n != null && n > 0);
    if (nums.length < 2) return;
    const qty = nums[0], value = nums[nums.length - 1];
    const clean = (t) => (t || '').replace(isin, ' ').replace(/ISIN:?/i, ' ').replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, ' ').replace(NUM, ' ')
      .replace(/\b(Stk|uds|titulos|títulos|participaciones|acciones|shares|pcs)\b\.?/gi, ' ').replace(/[€%]/g, ' ').replace(/\s+/g, ' ').trim();
    const name = clean(own) || clean(src) || isin;
    out.push({ name: name.slice(0, 80), isin, qty, cost: value, price: value / qty, costGuess: true });
  });
  if (!out.length) throw new Error('No he encontrado posiciones con ISIN en el PDF.');
  return out;
}
