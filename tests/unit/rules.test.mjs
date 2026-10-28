import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRule, rulePreview } from '../../js/rules.js';

let n = 0;
const tx = (date, concept, amount, cat, extra = {}) => ({ id: 't' + ++n, date, concept, amount, cat, ...extra });

test('reglas: lo escrito en el editor se limpia y lo que falta se rechaza', () => {
  assert.deepEqual(cleanRule({ kw: '  Glovo  Pedido ', cat: 'restaurantes', sign: '', min: null, max: null, acct: '' }), { kw: 'glovo pedido', cat: 'restaurantes' });
  // A zero or empty limit means no limit
  assert.deepEqual(cleanRule({ kw: 'AMAZON', cat: 'compras', sign: 'gasto', min: 0, max: NaN, acct: 'a_ing' }), { kw: 'amazon', cat: 'compras', sign: 'gasto', acct: 'a_ing' });
  assert.deepEqual(cleanRule({ kw: 'bizum', cat: 'otros_i', sign: 'ingreso', min: 5, max: 50 }), { kw: 'bizum', cat: 'otros_i', sign: 'ingreso', min: 5, max: 50 });
  assert.equal(cleanRule({ kw: '   ', cat: 'compras' }), null);
  assert.equal(cleanRule({ kw: 'amazon', cat: '' }), null);
});

test('reglas: la vista previa cuenta lo que encaja, lo que cambiaría y lo que pusiste a mano', () => {
  const state = {
    tx: [
      tx('2026-09-15', 'COMPRA TARJ. 4512 AMAZON.ES AMZN MKTP', -36, 'compras'),
      tx('2026-10-15', 'COMPRA TARJ. 4512 AMAZON.ES AMZN MKTP', -12, 'compras'),
      tx('2026-10-20', 'COMPRA TARJ. 4512 AMAZON.ES AMZN MKTP', -89, 'ocio', { manual: true }),
      tx('2026-10-21', 'DEVOLUCION AMAZON.ES', 36, 'devoluciones'),
      tx('2026-10-02', 'COMPRA TARJ. 4512 AMAZON.ES AMZN MKTP', -60, 'ocio'),
      tx('2026-10-03', 'COMPRA TARJ. 4512 MERCADONA', -60, 'supermercado'),
    ],
  };
  const rule = cleanRule({ kw: 'amazon', cat: 'ocio', sign: 'gasto', min: 20 });
  const p = rulePreview(state, [rule], 0);
  assert.equal(p.n, 3); // the 12 € purchase is under «desde» and the refund is not a «gasto»
  assert.equal(p.manual, 1);
  assert.deepEqual(p.change.map((t) => t.amount), [-36]); // the 60 € one is already in «ocio»

  // A later rule that also matches wins, so this one would not touch those movements
  const later = rulePreview(state, [rule, { kw: 'amzn', cat: 'compras' }], 0);
  assert.equal(later.n, 0);
  // Editing the first of two rules looks at the list as it would be saved
  const edited = rulePreview(state, [{ kw: 'amazon', cat: 'compras' }, { kw: 'mercadona', cat: 'supermercado' }], 0);
  assert.deepEqual([edited.n, edited.manual, edited.change.map((t) => t.date)], [5, 1, ['2026-10-21', '2026-10-02']]);
});
