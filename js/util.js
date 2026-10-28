// Shared helpers: text normalisation, dates (always 'YYYY-MM-DD' strings) and number formatting.

export const uid = () => {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
};

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
export const wordMatch = (n, kw) => !!kw && (' ' + n + ' ').includes(' ' + kw + ' ');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = (n) => String(n).padStart(2, '0');
export const round2 = (v) => Math.round(v * 100) / 100;
export const cents = (v) => Math.round(v * 100);

export function ymd(y, m, d) {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31/02 and friends
  return y + '-' + pad(m) + '-' + pad(d);
}
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 864e5); // b - a, in days
export const addDays = (iso, n) => new Date(utc(iso) + n * 864e5).toISOString().slice(0, 10);
export const localIso = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const monthOf = (iso) => iso.slice(0, 7);
export function addMonths(ym, n) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
  return (y + Math.floor(m / 12)) + '-' + pad(((m % 12) + 12) % 12 + 1);
}
export const daysInMonth = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

export const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const fmt0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (v) => fmt.format(v);
export const signed = (v) => (v >= 0 ? '+' : '−') + fmt.format(Math.abs(v));
export const pct = (v, digits = 1) => (isFinite(v) ? v : 0).toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits }) + ' %';
export const qtyFmt = (v) => v.toLocaleString('es-ES', { maximumFractionDigits: 4 });

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = MES;
export const MONTHS_LONG = MESL;
export const mLabel = (m) => MES[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4);
export const mLong = (m) => MESL[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
export const dShort = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4);
export function fmtD(iso) {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtDT(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// IBAN check (ISO 13616 mod 97). Returns the compact IBAN or ''.
export function cleanIban(s) {
  const v = String(s || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return '';
  const r = v.slice(4) + v.slice(0, 4);
  let mod = 0;
  for (const ch of r) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) mod = (mod * 10 + +d) % 97;
  }
  return mod === 1 ? v : '';
}
export const IBAN_RE = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?)\b/g;
// IBAN length per country: the pattern above also swallows the word that follows ("… 1332 TITULAR").
const IBAN_LEN = { ES: 24, DE: 22, FR: 27, IT: 27, PT: 25, NL: 18, BE: 16, LU: 20, IE: 22, GB: 22, AT: 20, CH: 21, LT: 20, MT: 31, AD: 24,
  PL: 28, SE: 24, DK: 18, FI: 18, NO: 15, GR: 27, CZ: 24, SK: 24, SI: 19, HR: 21, RO: 24, HU: 28, BG: 22, EE: 20, LV: 21, CY: 28, MC: 27, LI: 21, IS: 26 };
export function findIban(text) {
  for (const m of String(text || '').toUpperCase().matchAll(IBAN_RE)) {
    const c = m[1].replace(/ /g, ''), len = IBAN_LEN[c.slice(0, 2)];
    const v = cleanIban(len ? c.slice(0, len) : c);
    if (v) return v;
  }
  return '';
}
export const maskIban = (iban) => iban ? iban.slice(0, 4) + ' ···· ' + iban.slice(-4) : '';
