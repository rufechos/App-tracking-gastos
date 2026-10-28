import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agg, byMonth, monthsOf, ownMonth, txMonth, usePayday, DEFAULT_PAYDAY } from '../../js/aggregate.js';
import { budgetStatus } from '../../js/budgets.js';
import { yearSummary } from '../../js/insights.js';

const KINDS = { nomina: 'ingreso', transf_rec: 'ingreso', supermercado: 'gasto' };
const kindOf = (id) => KINDS[id];
let n = 0;
const tx = (date, concept, amount, cat, extra) => ({ id: 't' + ++n, date, concept, amount, cat, ...extra });

test('nómina de finales de mes: cuenta en el mes siguiente', () => {
  let p = { ...DEFAULT_PAYDAY };
  usePayday(() => p);
  const list = [
    tx('2026-09-26', 'NOMINA ACME', 2000, 'nomina'),
    tx('2026-10-05', 'MERCADONA', -80, 'supermercado'),
    tx('2026-10-24', 'NOMINA ACME', 300, 'nomina'), // before day 25: its own month
    tx('2026-10-28', 'NOMINA ACME', 2050, 'nomina'),
    tx('2026-10-29', 'BIZUM RECIBIDO', 20, 'transf_rec'), // not salary
    tx('2026-12-30', 'NOMINA ACME', 2100, 'nomina'), // into the next year
  ];
  assert.deepEqual(list.map(ownMonth), ['2026-10', '2026-10', '2026-10', '2026-11', '2026-10', '2027-01']);
  const per = byMonth(list);
  assert.equal(agg(per.get('2026-10'), kindOf).ti, 2320);
  assert.equal(agg(per.get('2026-11'), kindOf).ti, 2050);
  assert.deepEqual(monthsOf(list), ['2026-10', '2026-11', '2027-01']);
  assert.deepEqual(yearSummary({ tx: list }, kindOf).map((r) => [r.year, r.ti]), [['2027', 2100], ['2026', 4370]]);

  // By hand: the October 24 extra goes with November; the Bizum stays put whatever the setting
  list[2].mm = '2026-11';
  assert.equal(txMonth(list[2]), '2026-11');
  assert.equal(agg(byMonth(list).get('2026-11'), kindOf).ti, 2350);

  // Day and categories are yours to change; off, every movement counts in its date's month
  p = { on: true, day: 29, cats: ['nomina', 'transf_rec'] };
  assert.equal(ownMonth(list[3]), '2026-10');
  assert.equal(ownMonth(list[4]), '2026-11');
  p = { ...p, on: false };
  assert.deepEqual(list.map(txMonth), ['2026-09', '2026-10', '2026-11', '2026-10', '2026-10', '2026-12']);
  usePayday(() => DEFAULT_PAYDAY);
});

test('nómina de finales de mes: un gasto movido de mes a mano sigue a su presupuesto', () => {
  const list = [tx('2026-10-30', 'MERCADONA', -100, 'supermercado', { mm: '2026-11' }), tx('2026-11-02', 'MERCADONA', -50, 'supermercado')];
  const st = budgetStatus({ tx: list, budgets: { supermercado: 300 } }, kindOf, '2026-11', '2026-11-10');
  assert.equal(st.rows[0].spent, 150);
});
