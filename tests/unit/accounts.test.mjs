import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTransfers, guessAccount, bankFromIban, trackedSet } from '../../js/accounts.js';
import { matchRefund, isRefund } from '../../js/refunds.js';
import { classify } from '../../js/classify.js';
import { emptyState } from '../../js/store.js';

const ING = { id: 'ing', name: 'ING', kind: 'banco', iban: 'ES9121000418450200051332', aliases: ['ing'], track: 'auto' };
const CARD = { id: 'card', name: 'Tarjeta Air Europa', kind: 'tarjeta', iban: '', aliases: ['bankinter consumer finance', 'bankintercard', 'tarjeta air europa'], track: 'auto' };
const TR = { id: 'tr', name: 'Trade Republic', kind: 'broker', iban: '', aliases: ['trade republic', 'traderepublic'], track: 'auto' };
const BKT = { id: 'bkt', name: 'Bankinter', kind: 'banco', iban: '', aliases: ['bankinter'], track: 'auto' };

let n = 0;
const tx = (acct, date, concept, amount, extra = {}) => ({ id: 't' + ++n, acct, date, concept, amount, src: acct || 'x', ...extra });
const state = (txs, accounts, owners = []) => Object.assign(emptyState(), { tx: txs, accounts, settings: { owners, lastBackup: null } });
const run = (txs, accounts, owners) => { const s = state(txs, accounts, owners); classify(s, new Set(txs.map((t) => t.id))); return s; };
const by = (s, concept) => s.tx.find((t) => t.concept === concept);

test('cuentas conocidas por su nombre y banco por el IBAN', () => {
  assert.equal(guessAccount('Bankinter Consumer Finance').kind, 'tarjeta');
  assert.equal(guessAccount('Trade Republic').kind, 'broker');
  assert.equal(guessAccount('ING').kind, 'banco');
  assert.equal(bankFromIban('ES9121000418450200051332'), 'CaixaBank');
  assert.equal(bankFromIban('ES7614650100911234567890'), 'ING');
  const t = [tx('ing', '2026-10-01', 'X', -1)];
  assert.deepEqual([...trackedSet([ING, CARD, { ...TR, track: 'si' }, { ...BKT, track: 'no' }], t)].sort(), ['ing', 'tr']);
});

test('el pago de la tarjeta, con la tarjeta también en la app, no cuenta dos veces', () => {
  const s = run([
    tx('ing', '2026-10-05', 'RECIBO BANKINTER CONSUMER FINANCE', -450),
    tx('card', '2026-09-20', 'Pago en MERCADONA VALENCIA', -450),
    tx('card', '2026-10-06', 'PAGO RECIBIDO GRACIAS', 450),
  ], [ING, CARD]);
  const pay = by(s, 'RECIBO BANKINTER CONSUMER FINANCE'), recv = by(s, 'PAGO RECIBIDO GRACIAS');
  assert.equal(pay.cat, 'excluir');
  assert.equal(recv.cat, 'excluir');
  assert.equal(pay.pair, recv.id);
  assert.equal(pay.rv, undefined);
  assert.equal(by(s, 'Pago en MERCADONA VALENCIA').cat, 'supermercado'); // the purchases are the spending
});

test('pago de la tarjeta sin su pareja: no cuenta si la tarjeta está en la app; si no, es el gasto de la tarjeta', () => {
  const tracked = run([tx('ing', '2026-10-05', 'RECIBO BANKINTER CONSUMER FINANCE', -450), tx('card', '2026-09-20', 'Pago en ZARA', -50)], [ING, CARD]);
  assert.equal(by(tracked, 'RECIBO BANKINTER CONSUMER FINANCE').cat, 'excluir');
  const untracked = run([tx('ing', '2026-10-05', 'RECIBO BANKINTER CONSUMER FINANCE', -450)], [ING, CARD]);
  assert.equal(by(untracked, 'RECIBO BANKINTER CONSUMER FINANCE').cat, 'tarjeta');
  const noAccounts = run([tx(undefined, '2026-10-05', 'RECIBO BANKINTER CONSUMER FINANCE', -450)], []);
  assert.equal(by(noAccounts, 'RECIBO BANKINTER CONSUMER FINANCE').cat, 'tarjeta');
});

test('de ING a Trade Republic con las dos cuentas conectadas: traspaso; el plan de inversión sí es inversión', () => {
  const s = run([
    tx('ing', '2026-10-22', 'Trade Republic Bank GmbH · Transferencia emitida', -300, { cpName: 'Trade Republic Bank GmbH' }),
    tx('tr', '2026-10-22', 'AARON · Ingreso', 300, { cpName: 'AARON' }),
    tx('tr', '2026-10-23', 'Savings plan execution IE00B4L5Y983', -150),
  ], [ING, TR]);
  assert.equal(by(s, 'Trade Republic Bank GmbH · Transferencia emitida').cat, 'excluir');
  assert.equal(by(s, 'AARON · Ingreso').cat, 'excluir');
  assert.equal(by(s, 'Savings plan execution IE00B4L5Y983').cat, 'inversion');
});

test('de ING a Trade Republic sin Trade Republic en la app: es inversión', () => {
  const s = run([tx('ing', '2026-10-22', 'Transferencia emitida TRADE REPUBLIC', -300)], [ING, TR]);
  const t = by(s, 'Transferencia emitida TRADE REPUBLIC');
  assert.equal(t.cat, 'inversion');
  assert.equal(t.conf, 'transfer');
});

test('dinero que te mandas a ti mismo: por tu nombre o por la pareja de importes', () => {
  const owners = ['Aarón Pérez'];
  const alone = run([tx('ing', '2026-10-10', 'Transferencia recibida de AARON PEREZ GARCIA', 200)], [ING], owners);
  const a = by(alone, 'Transferencia recibida de AARON PEREZ GARCIA');
  assert.equal(a.cat, 'excluir');
  assert.equal(a.rv, 'transfer'); // only your name: confirm it
  const pair = run([
    tx('bkt', '2026-10-09', 'Transferencia a Aarón Pérez', -200),
    tx('ing', '2026-10-10', 'Transferencia recibida de AARON PEREZ GARCIA', 200),
  ], [ING, BKT], owners);
  for (const t of pair.tx) { assert.equal(t.cat, 'excluir'); assert.equal(t.rv, undefined); }
});

test('dos transferencias iguales y opuestas sin más pistas: traspaso a confirmar', () => {
  const s = run([tx('bkt', '2026-10-09', 'TRANSFERENCIA', -100), tx('ing', '2026-10-11', 'TRANSFERENCIA RECIBIDA', 100)], [ING, BKT]);
  for (const t of s.tx) { assert.equal(t.cat, 'excluir'); assert.equal(t.rv, 'transfer'); }
  // Same account, or too far apart: not a pair.
  const same = run([tx('ing', '2026-10-09', 'TRANSFERENCIA', -100), tx('ing', '2026-10-09', 'TRANSFERENCIA RECIBIDA', 100)], [ING]);
  assert.deepEqual(same.tx.map((t) => t.cat), ['transf_env', 'transf_rec']);
  const far = run([tx('bkt', '2026-10-01', 'TRANSFERENCIA', -100), tx('ing', '2026-10-11', 'TRANSFERENCIA RECIBIDA', 100)], [ING, BKT]);
  assert.deepEqual(far.tx.map((t) => t.cat), ['transf_env', 'transf_rec']);
});

test('sin cuentas, la pareja se busca entre archivos distintos', () => {
  const s = run([
    tx(undefined, '2026-10-09', 'TRASPASO A CUENTA AHORRO', -500, { fid: 'f1' }),
    tx(undefined, '2026-10-09', 'TRASPASO DESDE CUENTA NOMINA', 500, { fid: 'f2' }),
  ], []);
  for (const t of s.tx) assert.equal(t.cat, 'excluir');
});

test('una compra y su devolución no son un traspaso', () => {
  const out = detectTransfers([
    { id: 'a', acct: 'ing', date: '2026-10-01', concept: 'Pago en MERCADONA', amount: -54.3 },
    { id: 'b', acct: 'card', date: '2026-10-02', concept: 'DEVOLUCION MERCADONA', amount: 54.3 },
  ], [ING, CARD]);
  assert.equal(out.size, 0);
});

test('un abono en la cuenta de la tarjeta es su pago aunque falte el otro lado', () => {
  const s = run([tx('card', '2026-10-06', 'PAGO RECIBIDO GRACIAS', 450), tx('card', '2026-10-01', 'Pago en ZARA', -50)], [ING, CARD]);
  assert.equal(by(s, 'PAGO RECIBIDO GRACIAS').cat, 'excluir');
});

test('devoluciones: restan en la categoría de la compra', () => {
  const kindOf = (id) => ({ compras: 'gasto', supermercado: 'gasto', transf_env: 'gasto', devoluciones: 'ingreso' }[id]);
  const buy = { id: 'p', date: '2026-10-01', concept: 'Pago en AMAZON EU SARL', amount: -23.99, cat: 'compras' };
  const other = { id: 'q', date: '2026-10-03', concept: 'Pago en AMAZON EU SARL', amount: -50, cat: 'compras' };
  const ref = { id: 'r', date: '2026-10-10', concept: 'DEVOLUCION AMAZON EU', amount: 23.99 };
  assert.ok(isRefund(ref));
  assert.deepEqual(matchRefund(ref, [buy, other, ref], kindOf), { cat: 'compras', of: 'p' }); // the exact amount wins
  assert.deepEqual(matchRefund({ ...ref, amount: 10 }, [buy, ref], kindOf), { cat: 'compras', of: 'p' }); // partial
  assert.equal(matchRefund({ ...ref, amount: 30 }, [buy], kindOf), null); // more than the purchase
  assert.equal(matchRefund({ ...ref, date: '2026-09-30' }, [buy], kindOf), null); // before the purchase
  assert.equal(matchRefund({ ...ref, date: '2027-03-01' }, [buy], kindOf), null); // over 120 days
  assert.equal(matchRefund({ ...ref, concept: 'DEVOLUCION ZARA' }, [buy], kindOf), null); // another shop
});

test('clasificar: tus elecciones y reglas mandan, y «Por revisar» solo marca lo recién llegado', () => {
  const s = state([
    tx('ing', '2026-10-01', 'Pago en AMAZON EU SARL', -23.99),
    tx('ing', '2026-10-10', 'DEVOLUCION AMAZON EU', 23.99),
    tx('ing', '2026-10-11', 'DEVOLUCION RECIBO DESCONOCIDO', 12),
    tx('ing', '2026-10-12', 'PAGO EN COSA RARA', -9),
    tx('ing', '2026-10-13', 'Pago en MERCADONA', -40, { cat: 'ocio', manual: true }),
    tx('ing', '2026-10-14', 'TRANSFERENCIA A JUAN', -30),
  ], [ING]);
  s.rules = [{ kw: 'juan', cat: 'ocio' }];
  const fresh = new Set(s.tx.filter((t) => t.concept !== 'PAGO EN COSA RARA').map((t) => t.id));
  classify(s, fresh);
  const refund = by(s, 'DEVOLUCION AMAZON EU');
  assert.equal(refund.cat, 'compras');
  assert.equal(refund.conf, 'refund');
  assert.equal(refund.of, by(s, 'Pago en AMAZON EU SARL').id);
  const lost = by(s, 'DEVOLUCION RECIBO DESCONOCIDO');
  assert.equal(lost.cat, 'devoluciones');
  assert.equal(lost.rv, 'refund');
  assert.equal(by(s, 'PAGO EN COSA RARA').cat, 'otros_g');
  assert.equal(by(s, 'PAGO EN COSA RARA').rv, undefined); // not fresh: no new flag
  assert.equal(by(s, 'Pago en MERCADONA').cat, 'ocio');
  assert.equal(by(s, 'Pago en MERCADONA').conf, 'manual');
  assert.equal(by(s, 'TRANSFERENCIA A JUAN').cat, 'ocio');
  // A rule added later clears the «Otros» flag of what it now covers.
  const t = by(s, 'PAGO EN COSA RARA');
  t.rv = 'otros';
  s.rules.push({ kw: 'cosa rara', cat: 'compras' });
  classify(s);
  assert.equal(t.cat, 'compras');
  assert.equal(t.rv, undefined);
});
