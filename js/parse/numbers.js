// Amounts and dates as Spanish and other European banks write them.
import { ymd } from '../util.js';

// '1.234,56', '1,234.56', '-12,30', '12,30-', '(12,30)', '−12,30 €' -> number, or null.
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim().replace(/[−–]/g, '-').replace(/[€$£\s ]|EUR/gi, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^[+-]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1); }
  if (!/^[\d.,']+$/.test(s) || !/\d/.test(s)) return null;
  s = s.replace(/'/g, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

export const MONTH_WORDS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12, mrz: 3, okt: 10, dez: 12 };
const MW = Object.keys(MONTH_WORDS).join('|');
export const MONTH_DATE_RE = new RegExp('^(\\d{1,2})[\\s\\-./]?(' + MW + ')[a-z]*\\.?(?:[\\s\\-./,]+(\\d{4}|\\d{2}))?(?![a-z0-9])', 'i');

// Excel serial numbers, Date objects, '2026-10-24', '24/10/2026', '24-10-26', '24 oct 2026' -> 'YYYY-MM-DD', or null.
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 43200000); // SheetJS dates sit at local midnight; noon avoids DST slips
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (typeof v === 'number' && v > 20000 && v < 70000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = s.match(MONTH_DATE_RE);
  if (m && m[3]) return ymd(+m[3], MONTH_WORDS[m[2].toLowerCase()], +m[1]);
  return null;
}
