// Portfolio maths: value, cost and history of your positions.
import { uid, norm, round2, localIso } from './util.js';
import { validIsin } from './parse/positions.js';

export const posValue = (p) => (p.price != null && isFinite(p.price) ? p.qty * p.price : null);

export function invTotals(positions) {
  let v = 0, c = 0, known = true;
  for (const p of positions) {
    const pv = posValue(p);
    c += p.cost || 0;
    if (pv == null) { known = false; v += p.cost || 0; } else v += pv;
  }
  return { v, c, g: v - c, known };
}

export function snapshot(inv, today = localIso()) {
  if (!inv.positions.length) return;
  const t = invTotals(inv.positions);
  inv.history = (inv.history || []).filter((h) => h.d !== today);
  inv.history.push({ d: today, v: round2(t.v), c: round2(t.c) });
  inv.history.sort((a, b) => a.d.localeCompare(b.d));
}

export function leaveSampleInv(inv) {
  if (!inv.sample) return inv;
  return { positions: [], history: [], lastQuote: null };
}

// A broker report replaces that broker's positions; a report without the invested amount keeps the one you had.
export function importPositionRows(inv, rows, broker, today = localIso()) {
  const old = inv.positions.filter((p) => p.broker === broker);
  inv.positions = inv.positions.filter((p) => p.broker !== broker);
  for (const r of rows) {
    const prev = old.find((o) => (r.isin && o.isin === r.isin) || norm(o.name) === norm(r.name));
    const cost = r.costGuess && prev ? prev.cost : r.cost;
    inv.positions.push({ ...(prev || {}), id: prev ? prev.id : uid(), broker, name: r.name, isin: r.isin, qty: r.qty, cost, price: r.price, priceDate: r.price != null ? today : null });
  }
  snapshot(inv, today);
}

export function applyQuotes(inv, quotes, now = new Date()) {
  let n = 0;
  const miss = [];
  for (const p of inv.positions) {
    const r = p.isin && quotes && quotes[p.isin];
    if (r && r.priceEur != null) { p.price = r.priceEur; p.priceDate = (r.time || now.toISOString()).slice(0, 10); n++; }
    else if (p.isin) miss.push(p.name);
  }
  inv.lastQuote = now.toISOString();
  snapshot(inv, localIso(now));
  return { n, miss };
}

export const cleanIsin = (s) => { const v = String(s || '').trim().toUpperCase().replace(/\s+/g, ''); return validIsin(v) ? v : ''; };
