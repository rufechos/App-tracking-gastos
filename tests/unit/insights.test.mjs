import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeBudgets, budgetStatus, averages } from '../../js/budgets.js';
import { recurring } from '../../js/recurring.js';
import { vsAverage, catSeries, yearSummary, lastMonths } from '../../js/insights.js';

const KINDS = { restaurantes: 'gasto', supermercado: 'gasto', suscripciones: 'gasto', suministros: 'gasto', ocio: 'gasto', seguros: 'gasto', efectivo: 'gasto', nomina: 'ingreso', inversion: 'inversion', excluir: 'excluir' };
const kindOf = (id) => KINDS[id];
let n = 0;
const tx = (date, concept, amount, cat) => ({ id: 't' + ++n, date, concept, amount, cat });

test('presupuestos: propuestos con la media de los 6 últimos meses y el ritmo del mes', () => {
  const list = [];
  for (const m of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
    list.push(tx(m + '-05', 'RESTAURANTE LA PEPICA', -150, 'restaurantes'), tx(m + '-10', 'MERCADONA', -301, 'supermercado'), tx(m + '-01', 'NOMINA', 2000, 'nomina'));
  }
  list.push(tx('2026-03-03', 'MERCADONA', -900, 'supermercado')); // more than 6 months ago: not counted
  list.push(tx('2026-09-20', 'CINE', -6, 'ocio')); // 1 € a month on average: too little for a budget
  const state = { tx: list, budgets: {} };
  assert.deepEqual(proposeBudgets(state, kindOf, '2026-10-15'), { restaurantes: 150, supermercado: 310 });
  assert.equal(Math.round(averages(state, kindOf, '2026-10-15').ocio), 1);

  state.budgets = { restaurantes: 200, supermercado: 400, nomina: 100 }; // an income category cannot have one
  list.push(tx('2026-10-02', 'RESTAURANTE LA PEPICA', -120, 'restaurantes'), tx('2026-10-08', 'GLOVO', -60, 'restaurantes'), tx('2026-10-09', 'MERCADONA', -100, 'supermercado'));
  const s = budgetStatus(state, kindOf, '2026-10', '2026-10-10');
  assert.deepEqual(s.rows.map((r) => [r.id, r.spent, r.state]), [['restaurantes', 180, 'fast'], ['supermercado', 100, 'ok']]);
  assert.equal(Math.round(s.pace * 100), 32); // day 10 of 31
  list.push(tx('2026-10-12', 'BAR', -30, 'restaurantes'));
  assert.equal(budgetStatus(state, kindOf, '2026-10', '2026-10-12').rows[0].state, 'over');
  // A past month is judged complete; no budgets, nothing to show
  assert.equal(budgetStatus(state, kindOf, '2026-09', '2026-10-12').pace, 1);
  assert.equal(budgetStatus({ tx: list, budgets: {} }, kindOf, '2026-10'), null);
});

test('gastos fijos: suscripciones, recibos que cambian de importe y subidas de precio', () => {
  const list = [];
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  months.forEach((m, i) => {
    list.push(tx(m + '-06', 'COMPRA TARJ. 4512 NETFLIX.COM', i < 8 ? -12.99 : -14.99, 'suscripciones'));
    list.push(tx(m + '-03', 'RECIBO IBERDROLA CLIENTES SAU', -[58.2, 71.9, 49.3, 62, 55.4][i % 5], 'suministros'));
    list.push(tx(m + '-' + String(5 + (i % 3) * 9).padStart(2, '0'), 'COMPRA MERCADONA VALENCIA', -[64.3, 71.1, 30.2][i % 3], 'supermercado'));
    list.push(tx(m + '-' + String(5 + (i % 3) * 9 + 3).padStart(2, '0'), 'COMPRA MERCADONA VALENCIA', -[44.3, 91.1, 20.2][i % 3], 'supermercado'));
    list.push(tx(m + '-20', 'RETIRADA CAJERO 4512', -60, 'efectivo'));
  });
  list.push(tx('2025-11-14', 'RECIBO SEGURO HOGAR MAPFRE', -290, 'seguros'), tx('2024-11-15', 'RECIBO SEGURO HOGAR MAPFRE', -280, 'seguros'));
  list.push(tx('2025-12-01', 'RECIBO BASIC FIT SPAIN', -29.99, 'ocio'), tx('2026-01-01', 'RECIBO BASIC FIT SPAIN', -29.99, 'ocio'), tx('2026-02-01', 'RECIBO BASIC FIT SPAIN', -29.99, 'ocio')); // cancelled in March
  const r = recurring({ tx: list }, kindOf, '2026-10-27');
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(by).sort(), ['iberdrola clientes', 'netflix', 'seguro hogar']);
  assert.equal(by.netflix.period, 'mensual');
  assert.equal(by.netflix.amount, 14.99);
  assert.deepEqual(by.netflix.rise && [by.netflix.rise.from, by.netflix.rise.to], [12.99, 14.99]);
  assert.equal(by.netflix.next, '2026-11-05');
  assert.equal(by.netflix.yearly, 179.88);
  assert.equal(by['iberdrola clientes'].variable, true);
  assert.equal(by['iberdrola clientes'].rise, null);
  assert.equal(by['seguro hogar'].period, 'anual');
  assert.equal(by['seguro hogar'].yearly, 290);
  assert.equal(r[0].key, 'iberdrola clientes'); // most expensive first
});

test('comparativas: cada categoría frente a su media, su evolución y el resumen de cada año', () => {
  const list = [
    tx('2026-08-05', 'RESTAURANTE', -100, 'restaurantes'), tx('2026-09-05', 'RESTAURANTE', -200, 'restaurantes'),
    tx('2026-10-05', 'RESTAURANTE', -300, 'restaurantes'), tx('2026-10-06', 'MERCADONA', -50, 'supermercado'),
    tx('2026-10-01', 'NOMINA', 2000, 'nomina'), tx('2025-12-01', 'NOMINA', 1500, 'nomina'), tx('2025-12-03', 'ALQUILER', -1200, 'restaurantes'),
    tx('2026-10-02', 'A TRADE REPUBLIC', -300, 'inversion'), tx('2026-10-03', 'A MI AHORRO', -500, 'excluir'),
  ];
  const v = vsAverage({ tx: list }, kindOf, '2026-10');
  assert.equal(v.restaurantes.avg, 150);
  assert.equal(v.restaurantes.pct, 100);
  assert.equal(v.supermercado.pct, null); // nothing before: no comparison
  assert.deepEqual(catSeries({ tx: list }, kindOf, 'restaurantes', ['2026-08', '2026-09', '2026-10']), [100, 200, 300]);
  assert.deepEqual(lastMonths('2026-10-27', 3), ['2026-08', '2026-09', '2026-10']);
  const y = yearSummary({ tx: list }, kindOf);
  assert.deepEqual(y.map((r) => [r.year, r.ti, r.te, r.saved, Math.round(r.rate), r.tinv, r.months]), [
    ['2026', 2000, 650, 1350, 68, 300, 3], ['2025', 1500, 1200, 300, 20, 0, 1],
  ]);
});

test('patrimonio: saldo del banco, de un extracto o a mano, y los meses anteriores hacia atrás', async () => {
  const { pickBalance, statementBalance, accountBalance, balanceAt, worthNow, worthSeries } = await import('../../js/worth.js');
  assert.deepEqual(pickBalance([
    { balance_type: 'ITAV', balance_amount: { amount: '2500.00', currency: 'EUR' }, credit_limit_included: true },
    { balance_type: 'ITBD', balance_amount: { amount: '1234.5', currency: 'EUR' } },
    { balance_type: 'CLBD', balance_amount: { amount: '99', currency: 'USD' } },
  ]), { v: 1234.5, type: 'ITBD' });
  assert.equal(pickBalance([]), null);

  // A statement listing the day newest first: the balance of the day is the one no other movement starts from
  const tx = [
    { id: 'a', acct: 'ing', date: '2026-10-10', amount: -20, bal: 980 },
    { id: 'b', acct: 'ing', date: '2026-10-10', amount: -30, bal: 1000 },
    { id: 'c', acct: 'ing', date: '2026-10-01', amount: 2000, bal: 1030 },
    { id: 'd', acct: 'ing', date: '2026-10-20', amount: -80 }, // synced afterwards, without balance
    { id: 'e', acct: 'ing', date: '2026-09-15', amount: -500 },
  ];
  const state = { tx, accounts: [{ id: 'ing', name: 'ING', kind: 'banco' }, { id: 'tr', name: 'Trade Republic', kind: 'broker' }], inv: { positions: [], history: [{ d: '2026-09-30', v: 5000 }, { d: '2026-10-24', v: 5200 }] } };
  assert.deepEqual(statementBalance(state, 'ing'), { v: 980, d: '2026-10-10', src: 'extracto' });
  assert.equal(balanceAt(tx.filter((t) => t.acct === 'ing'), { v: 980, d: '2026-10-10' }, '2026-10-27'), 900);
  assert.equal(balanceAt(tx.filter((t) => t.acct === 'ing'), { v: 980, d: '2026-10-10' }, '2026-09-30'), -970);
  // A balance typed later wins over the statement
  state.accounts[1].bal = { v: 120, d: '2026-10-25', src: 'manual' };
  assert.deepEqual(accountBalance(state, state.accounts[1]), { v: 120, d: '2026-10-25', src: 'manual' });
  const w = worthNow(state, '2026-10-27');
  assert.deepEqual([w.cash, w.inv, w.total, w.missing], [1020, 0, 1020, 0]);
  assert.deepEqual(worthSeries(state, ['2026-08', '2026-09', '2026-10'], '2026-10-27').map((r) => [r.m, r.cash, r.inv, r.total]), [
    ['2026-08', 0, null, 0], ['2026-09', -970, 5000, 4030], ['2026-10', 1020, 5200, 6220], // Trade Republic counts from its balance
  ]);
});
