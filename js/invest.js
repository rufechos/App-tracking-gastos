// Portfolio maths: value, cost and history of your positions, what they cost you every year and their return.
import { uid, norm, round2, localIso, dayDiff, pad } from './util.js';
import { validIsin } from './parse/positions.js';
import { xirr } from './xirr.js';

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
    if (r && r.priceEur != null) { p.price = r.priceEur; p.priceDate = (r.time || now.toISOString()).slice(0, 10); p.priceSrc = r.source || 'yahoo'; n++; }
    else if (p.isin) miss.push(p.name);
  }
  inv.lastQuote = now.toISOString();
  snapshot(inv, localIso(now));
  return { n, miss };
}

export const cleanIsin = (s) => { const v = String(s || '').trim().toUpperCase().replace(/\s+/g, ''); return validIsin(v) ? v : ''; };

// Ongoing charges (TER/OGC, % a year) of common funds, from their fund sheets (Aug.–Sept. 2026). The fund takes them
// from its own assets every day, so the price already has them deducted: they are shown as a cost, never subtracted.
export const TER_TABLE = {
  IE00B03HD191: 0.18, // Vanguard Global Stock Index Fund EUR Acc
  IE0032126645: 0.10, // Vanguard U.S. 500 Stock Index Fund EUR Acc
  IE0007987708: 0.12, // Vanguard European Stock Index Fund EUR Acc
  IE0031786696: 0.23, // Vanguard Emerging Markets Stock Index Fund EUR Acc
  IE00B4L5Y983: 0.20, // iShares Core MSCI World UCITS ETF (Acc)
  IE00BK5BQT80: 0.14, // Vanguard FTSE All-World UCITS ETF (Acc)
};
export const terOf = (p) => (p.ter != null ? p.ter : TER_TABLE[p.isin] != null ? TER_TABLE[p.isin] : null);

// What the platform charges on top: custody (% a year on the value, charged every `every` months), a fixed monthly fee
// and a fee per sale. Published tariffs (Oct. 2026) as a starting point; you can change them in the app.
export const NO_FEES = { custodyPct: 0, vat: false, monthlyFee: 0, tradeFee: 0, every: 3 };
const KNOWN_FEES = [
  { re: /renta ?4/, fees: { custodyPct: 0.19 } }, // index funds (Vanguard, Amundi); most other funds have no custody fee
  { re: /trade ?republic/, fees: { tradeFee: 1 } },
];
export function brokerFees(inv, broker) {
  const own = inv.fees && inv.fees[broker];
  if (own) return { ...NO_FEES, ...own };
  const k = KNOWN_FEES.find((x) => x.re.test(norm(broker)));
  return { ...NO_FEES, ...(k ? k.fees : {}), preset: !!k };
}

// Days since the platform last charged its fees (periods of `every` months from 1 January).
function daysCharged(today, every) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7), start = Math.floor((m - 1) / every) * every + 1;
  return dayDiff(y + '-' + pad(start) + '-01', today);
}

export function positionCosts(inv, p) {
  const f = brokerFees(inv, p.broker);
  const value = posValue(p) ?? p.cost ?? 0;
  const ter = terOf(p);
  const custodyPct = (p.custodyPct != null ? p.custodyPct : f.custodyPct) * (f.vat ? 1.21 : 1);
  return { value, ter, terEur: ter != null ? (value * ter) / 100 : null, custodyPct, custodyEur: (value * custodyPct) / 100, fees: f };
}

// Yearly cost of the portfolio (fund + platform) and its value net of the fees accrued since the last charge
// and of selling everything today.
export function portfolioCosts(inv, today = localIso()) {
  let value = 0, fundEur = 0, platformEur = 0, accrued = 0, exit = 0, terMissing = 0;
  const brokers = new Map();
  for (const p of inv.positions) {
    const c = positionCosts(inv, p);
    value += c.value;
    if (c.ter == null) terMissing++; else fundEur += c.terEur;
    platformEur += c.custodyEur;
    accrued += (c.custodyEur * daysCharged(today, c.fees.every || 3)) / 365;
    exit += c.fees.tradeFee || 0;
    brokers.set(p.broker, c.fees);
  }
  const dom = +today.slice(8, 10);
  for (const f of brokers.values()) { platformEur += (f.monthlyFee || 0) * 12; accrued += ((f.monthlyFee || 0) * (dom - 1)) / 30; }
  const totalEur = fundEur + platformEur;
  return { value, fundEur, platformEur, totalEur, totalPct: value ? (totalEur / value) * 100 : 0, accrued, exit, net: value - accrued - exit, terMissing };
}

// Asset class from the name when you have not set it.
export const TYPES = ['Renta variable', 'Renta fija', 'Monetario', 'Otros'];
export const typeOf = (p) => p.type || (/bond|bono|renta fija|govern|treasury|aggregate|credit|deuda/i.test(p.name) ? 'Renta fija'
  : /money market|monetari|liquidez|cash/i.test(p.name) ? 'Monetario' : 'Renta variable');

export function breakdown(positions) {
  const group = (key) => {
    const m = new Map();
    let total = 0;
    for (const p of positions) { const v = posValue(p) ?? p.cost ?? 0; m.set(key(p), (m.get(key(p)) || 0) + v); total += v; }
    return [...m].map(([name, value]) => ({ name, value, pct: total ? (value / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
  };
  return { brokers: group((p) => p.broker || 'Sin bróker'), types: group(typeOf) };
}

// Annualised return with the dated money that went into and out of your investments (movements of the
// «Inversión» kind, dividends received) and today's net value. Null when the contributions do not explain at least
// half of what the positions cost: some history is missing and the figure would be wrong.
export function portfolioReturn(state, kindOf, net, today = localIso()) {
  const flows = [];
  let paidIn = 0;
  for (const t of state.tx) {
    const k = kindOf(t.cat);
    if (k === 'inversion') { flows.push({ date: t.date, amount: t.amount }); paidIn -= t.amount; }
    else if (k === 'ingreso' && /(^| )(dividendo|dividendos|dividend|dividende)( |$)/.test(norm(t.concept))) flows.push({ date: t.date, amount: t.amount });
  }
  const cost = invTotals(state.inv.positions).c;
  if (!flows.length || paidIn <= 0 || paidIn < cost * 0.5) return { rate: null, paidIn, reason: 'history' };
  flows.push({ date: today, amount: net });
  const first = flows.reduce((a, f) => (f.date < a ? f.date : a), today);
  if (dayDiff(first, today) < 90) return { rate: null, paidIn, reason: 'short', since: first };
  return { rate: xirr(flows), paidIn, since: first };
}
