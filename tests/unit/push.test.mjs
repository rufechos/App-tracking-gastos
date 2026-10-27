import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushPayload, catKeywords, payloadHash } from '../../js/push.js';
import { defaultCatsLite } from '../../js/categories.js';

let n = 0;
const tx = (date, concept, amount, cat, extra = {}) => ({ id: 't' + ++n, date, concept, amount, cat, ...extra });

test('avisos: lo que se manda al servidor, sin movimientos más allá de los últimos días', () => {
  const state = {
    tx: [
      tx('2026-10-02', 'COMPRA TARJ. 4512 RESTAURANTE LA PEPICA', -120, 'restaurantes'),
      tx('2026-09-12', 'COMPRA TARJ. 4512 RESTAURANTE LA PEPICA', -60, 'restaurantes'),
      tx('2026-10-20', 'COMPRA TARJ. 4512 TABERNA EL OLIVO', -25, 'restaurantes'),
      tx('2026-10-24', 'COMPRA TARJ. 4512 MERCADONA VALENCIA', -48.3, 'supermercado', { ref: 'r-77' }),
      tx('2026-10-25', 'NOMINA ACME SERVICIOS', 2000, 'nomina'),
      tx('2026-03-01', 'COMPRA TARJ. 4512 CASA PACO', -30, 'restaurantes'), // more than 6 months ago
    ],
    cats: defaultCatsLite(),
    rules: [{ kw: 'bar manolo', cat: 'restaurantes' }, { kw: 'bizum', cat: 'restaurantes', sign: 'ingreso' }],
    accounts: [{ id: 'a_ing', name: 'ING', iban: 'ES7921000813610123456789', aliases: ['ing', 'ing direct'] }, { id: 'a_tr', name: 'Trade Republic', iban: '', aliases: ['trade republic'] }],
    settings: { owners: ['Aarón Pérez'] },
    budgets: { restaurantes: 200, supermercado: 300 },
  };
  const bank = { conns: [{ id: 'c_ing', aspsp: { name: 'ING' }, valid_until: '2027-01-20T00:00:00Z', accounts: [{ uid: 'u1', acctId: 'a_ing' }], session_id: 'secreto' }] };
  const p = pushPayload(state, bank, { big: 150, budget: true, expiry: false }, '2026-10-27');
  assert.deepEqual(p.prefs, { big: 150, budget: true, expiry: false });
  assert.deepEqual(p.conns, [{ id: 'c_ing', name: 'ING', valid_until: '2027-01-20T00:00:00Z', accounts: [{ uid: 'u1' }] }]);
  assert.ok(!JSON.stringify(p).includes('secreto'));
  assert.deepEqual(p.own, { ibans: ['ES7921000813610123456789'], names: ['ing direct', 'trade republic', 'aaron perez'] }); // «ing» alone would hide too much
  assert.equal(p.watch.month, '2026-10');
  const rest = p.watch.cats.find((c) => c.id === 'restaurantes');
  assert.deepEqual([rest.limit, rest.left], [200, 55]);
  assert.deepEqual(rest.kws.slice(0, 3), ['bar manolo', 'restaurante pepica', 'taberna olivo']);
  assert.ok(!rest.kws.includes('bizum') && !rest.kws.includes('casa paco') && rest.kws.includes('glovo'));
  assert.deepEqual(p.known, [{ d: '2026-10-24', a: -48.3, r: 'r-77' }]); // expenses of the last 5 days only
  assert.equal(pushPayload(state, bank, { big: 0, budget: false, expiry: true }, '2026-10-27').watch, null);
  assert.equal(payloadHash(p), payloadHash(JSON.parse(JSON.stringify(p))));
  assert.notEqual(payloadHash(p), payloadHash({ ...p, prefs: { ...p.prefs, big: 151 } }));
  assert.ok(catKeywords(state, 'supermercado', '2026-10-27').length <= 80);
});
