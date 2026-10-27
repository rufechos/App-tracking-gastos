import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xirr } from '../../js/xirr.js';
import { positionCosts, portfolioCosts, brokerFees, breakdown, typeOf, portfolioReturn, terOf } from '../../js/invest.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const KIND = { inv: 'inversion', int: 'ingreso', sup: 'gasto' };
const kindOf = (id) => KIND[id];

test('TIR como la de una hoja de cálculo', () => {
  near(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]), 0.1);
  // 1000 at the start, 1000 a year later, 2310 at the end of the second year: 10 % a year
  near(xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2024-12-31', amount: -1000 }, { date: '2025-12-31', amount: 2310 }]), 0.1, 1e-3);
  near(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 500 }]), -0.5);
  assert.equal(xirr([{ date: '2025-01-01', amount: -1000 }]), null); // money in but nothing back
});

test('costes de una posición: el TER del fondo y la custodia de la plataforma', () => {
  const inv = { positions: [], fees: {} };
  const vg = { broker: 'Renta 4', isin: 'IE00B03HD191', qty: 100, cost: 5000, price: 60 };
  assert.equal(terOf(vg), 0.18); // Vanguard Global Stock, from the table
  const c = positionCosts(inv, vg);
  near(c.value, 6000);
  near(c.terEur, 10.8);
  near(c.custodyEur, 11.4); // Renta 4: 0,19 % a year on index funds
  assert.equal(brokerFees(inv, 'Renta 4').preset, true);
  // Your own tariff wins, with VAT
  inv.fees = { 'Renta 4': { custodyPct: 0.2, vat: true, every: 3 } };
  near(positionCosts(inv, vg).custodyEur, 6000 * 0.002 * 1.21);
  assert.equal(brokerFees(inv, 'Renta 4').preset, undefined);
  // A TER you type in beats the table; without either, it is unknown
  assert.equal(terOf({ ...vg, ter: 0.25 }), 0.25);
  assert.equal(positionCosts(inv, { broker: 'Otro', isin: 'ES0000000000', qty: 1, cost: 10, price: null }).ter, null);
});

test('coste anual de la cartera y valor neto con las comisiones pendientes y las de venta', () => {
  const inv = {
    fees: { MyInvestor: { monthlyFee: 2 } },
    positions: [
      { broker: 'Renta 4', name: 'Vanguard Global Stock', isin: 'IE00B03HD191', qty: 100, cost: 5000, price: 60 },
      { broker: 'Trade Republic', name: 'iShares Core MSCI World', isin: 'IE00B4L5Y983', qty: 10, cost: 900, price: 100 },
      { broker: 'MyInvestor', name: 'Fondo sin TER conocido', isin: '', qty: 1, cost: 1000, price: null },
    ],
  };
  const c = portfolioCosts(inv, '2026-11-15'); // 45 days into the 4th quarter
  near(c.value, 8000);
  near(c.fundEur, 6000 * 0.0018 + 1000 * 0.002);
  near(c.platformEur, 11.4 + 24); // Renta 4 custody + MyInvestor 2 € a month
  near(c.accrued, (11.4 * 45) / 365 + (2 * 14) / 30);
  near(c.exit, 1); // selling the Trade Republic ETF
  near(c.net, 8000 - c.accrued - 1);
  assert.equal(c.terMissing, 1);
  near(c.totalPct, (c.totalEur / 8000) * 100);
});

test('reparto por bróker y por tipo de activo', () => {
  const ps = [
    { broker: 'Renta 4', name: 'Vanguard Global Stock Index', qty: 1, cost: 600, price: 600 },
    { broker: 'Renta 4', name: 'Vanguard Euro Government Bond Index', qty: 1, cost: 300, price: 300 },
    { broker: 'Trade Republic', name: 'Xtrackers II EUR Overnight Rate Swap', qty: 1, cost: 100, price: 100, type: 'Monetario' },
  ];
  const b = breakdown(ps);
  assert.deepEqual(b.brokers.map((x) => [x.name, Math.round(x.pct)]), [['Renta 4', 90], ['Trade Republic', 10]]);
  assert.deepEqual(b.types.map((x) => x.name), ['Renta variable', 'Renta fija', 'Monetario']);
  assert.equal(typeOf({ name: 'Amundi Money Market Fund' }), 'Monetario');
});

test('rentabilidad anualizada con las aportaciones fechadas y los dividendos', () => {
  const tx = [
    { date: '2024-11-01', amount: -1000, cat: 'inv', concept: 'TRANSFERENCIA A TRADE REPUBLIC' },
    { date: '2025-11-01', amount: -1000, cat: 'inv', concept: 'TRANSFERENCIA A TRADE REPUBLIC' },
    { date: '2026-05-01', amount: 20, cat: 'int', concept: 'Dividendo VANGUARD FTSE ALL-WORLD' },
    { date: '2026-05-02', amount: 15, cat: 'int', concept: 'INTERESES A SU FAVOR' }, // interest on cash is not the portfolio's
    { date: '2026-05-03', amount: -50, cat: 'sup', concept: 'MERCADONA' },
  ];
  const state = { tx, inv: { positions: [{ broker: 'Trade Republic', qty: 1, cost: 2000, price: 2300 }] } };
  const r = portfolioReturn(state, kindOf, 2290, '2026-11-01');
  assert.equal(r.paidIn, 2000);
  assert.equal(r.since, '2024-11-01');
  const check = xirr([{ date: '2024-11-01', amount: -1000 }, { date: '2025-11-01', amount: -1000 }, { date: '2026-05-01', amount: 20 }, { date: '2026-11-01', amount: 2290 }]);
  near(r.rate, check);
  assert.ok(r.rate > 0.09 && r.rate < 0.11);
  // Contributions that explain less than half of the cost: history is missing, no figure
  assert.equal(portfolioReturn({ ...state, inv: { positions: [{ qty: 1, cost: 5000, price: 6000 }] } }, kindOf, 6000, '2026-11-01').rate, null);
  // Less than three months: too early
  const fresh = portfolioReturn({ tx: [{ date: '2026-10-01', amount: -2000, cat: 'inv', concept: 'x' }], inv: state.inv }, kindOf, 2050, '2026-11-01');
  assert.equal(fresh.reason, 'short');
});
