import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ebToTx, linkAccounts, makeConnection, syncConnection, dueForSync, expired, expiresSoon, coolingDown, syncErrorText, AUTO_INTERVAL } from '../../js/bank.js';
import { ApiError } from '../../js/api.js';
import { emptyState } from '../../js/store.js';
import { classify } from '../../js/classify.js';

const NOW = Date.parse('2026-10-27T09:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const bt = (o) => ({ status: 'BOOK', credit_debit_indicator: 'DBIT', remittance_information: [], ...o });
const amt = (a) => ({ amount: a, currency: 'EUR' });

// A fake server: answers /transactions per account and records every call.
function fakeApi(handler) {
  const calls = [];
  const api = async (path, { query } = {}) => {
    calls.push({ path, query: { ...query } });
    return handler(query, calls.length);
  };
  return { api, calls };
}
const conn = (o = {}) => ({ id: 'c1', aspsp: { name: 'ING', country: 'ES' }, session_id: 's', accounts: [{ uid: 'u1', acctId: 'ing', name: '' }], valid_until: iso(NOW + 90 * 864e5), lastSync: iso(NOW - 864e5), firstDone: true, ...o });

test('un movimiento de Enable Banking', () => {
  const t = ebToTx(bt({
    entry_reference: 'R1', booking_date: '2026-10-21', value_date: '2026-10-20', transaction_amount: amt('54.30'),
    creditor: { name: 'MERCADONA SA' }, creditor_account: { iban: 'ES91 2100 0418 4502 0005 1332' }, remittance_information: ['MERCADONA SA VALENCIA'], merchant_category_code: '5411',
  }));
  assert.deepEqual(t, { date: '2026-10-20', concept: 'MERCADONA SA VALENCIA', amount: -54.3, bdate: '2026-10-21', ref: 'R1', mcc: '5411', cpIban: 'ES9121000418450200051332', cpName: 'MERCADONA SA' });
  const inc = ebToTx(bt({ credit_debit_indicator: 'CRDT', transaction_date: '2026-10-01', booking_date: '2026-10-02', transaction_amount: amt('2000'), debtor: { name: 'ACME SL' }, remittance_information: ['NOMINA OCTUBRE'] }));
  assert.equal(inc.date, '2026-10-01');
  assert.equal(inc.amount, 2000);
  assert.equal(inc.concept, 'ACME SL · NOMINA OCTUBRE');
  assert.equal(ebToTx(bt({ status: 'PDNG', booking_date: '2026-10-01', transaction_amount: amt('5') })), null);
  assert.equal(ebToTx(bt({ booking_date: '2026-10-01', transaction_amount: amt('0') })), null);
  assert.equal(ebToTx(bt({ transaction_amount: amt('5') })), null);
  assert.equal(ebToTx(bt({ booking_date: '2026-10-01', transaction_amount: amt('5'), creditor_account: { iban: 'ES00 1234' } })).cpIban, undefined);
  assert.equal(ebToTx(bt({ booking_date: '2026-10-01', transaction_amount: amt('5'), bank_transaction_code: { description: 'Comisión' } })).concept, 'Comisión');
});

test('las cuentas de un banco autorizado se enlazan con «Mis cuentas», también al renovar', () => {
  const accounts = [];
  const session = { session_id: 's1', access: { valid_until: '2027-01-25T00:00:00Z' }, accounts: [
    { uid: 'u1', identification_hash: 'h1', account_id: { iban: 'ES91 2100 0418 4502 0005 1332' }, name: 'Cuenta Nómina', cash_account_type: 'CACC' },
    { uid: 'u2', identification_hash: 'h2', account_id: {}, name: 'Tarjeta', cash_account_type: 'CARD' },
  ] };
  const c = makeConnection(session, { name: 'Bankinter', country: 'ES' }, accounts);
  assert.equal(accounts.length, 2);
  assert.deepEqual(accounts.map((a) => [a.name, a.kind, a.ebHash]), [['Bankinter · Cuenta Nómina', 'banco', 'h1'], ['Bankinter · Tarjeta', 'tarjeta', 'h2']]);
  assert.equal(c.valid_until, '2027-01-25T00:00:00Z');
  assert.equal(c.firstDone, false);
  // Renewal: new uids, same accounts.
  const again = linkAccounts({ accounts: [{ uid: 'u9', identification_hash: 'h2' }, { uid: 'u8', account_id: { iban: 'ES9121000418450200051332' } }] }, { name: 'Bankinter' }, accounts);
  assert.equal(accounts.length, 2);
  assert.deepEqual(again.map((a) => a.acctId), [accounts[1].id, accounts[0].id]);
});

test('primera sincronización: el historial más largo, con todas sus páginas y cabeceras de usuario presente', async () => {
  const { api, calls } = fakeApi((q) => {
    if (!q.continuation_key) return { transactions: [bt({ entry_reference: '1', booking_date: '2026-01-05', transaction_amount: amt('10') })], continuation_key: 'k1' };
    return { transactions: [bt({ entry_reference: '2', booking_date: '2026-02-05', transaction_amount: amt('20') })], continuation_key: null };
  });
  const s = emptyState();
  const r = await syncConnection(api, s, conn({ firstDone: false, lastSync: null }), NOW);
  assert.equal(r.added.length, 2);
  assert.deepEqual(calls.map((c) => c.query), [
    { account: 'u1', strategy: 'longest', continuation_key: null, psu: 1 },
    { account: 'u1', strategy: 'longest', continuation_key: 'k1', psu: 1 },
  ]);
  assert.ok(r.added.every((t) => t.acct === 'ing' && t.src === 'ING' && t.ext.startsWith('eb:ing:r:')));
});

test('después: desde 7 días antes de la última vez; si el banco no acepta el periodo, los últimos 89 días', async () => {
  const later = fakeApi(() => ({ transactions: [] }));
  await syncConnection(later.api, emptyState(), conn(), NOW);
  assert.equal(later.calls[0].query.date_from, '2026-10-19');
  const picky = fakeApi((q, n) => { if (n === 1) throw new ApiError('Periodo incorrecto', 422, 'WRONG_TRANSACTIONS_PERIOD'); return { transactions: [] }; });
  await syncConnection(picky.api, emptyState(), conn({ firstDone: false, lastSync: null }), NOW);
  assert.equal(picky.calls[0].query.strategy, 'longest');
  assert.equal(picky.calls[1].query.date_from, '2026-07-30');
  const limited = fakeApi(() => { throw new ApiError('Too many', 429, 'ASPSP_RATE_LIMIT_EXCEEDED'); });
  await assert.rejects(syncConnection(limited.api, emptyState(), conn(), NOW), (e) => e.status === 429);
  assert.equal(limited.calls.length, 1);
});

test('sin referencia del banco y con transaction_id cambiante, la segunda sincronización no duplica', async () => {
  const s = emptyState();
  const { api } = fakeApi((q, n) => ({ transactions: [
    bt({ transaction_id: 'tid-' + n + '-a', booking_date: '2026-10-24', transaction_amount: amt('3.20'), remittance_information: ['CAFE CENTRAL'] }),
    bt({ transaction_id: 'tid-' + n + '-b', booking_date: '2026-10-24', transaction_amount: amt('3.20'), remittance_information: ['CAFE CENTRAL'] }),
    bt({ transaction_id: 'tid-' + n + '-c', booking_date: '2026-10-24', transaction_amount: amt('54.30'), remittance_information: ['MERCADONA VALENCIA'] }),
  ] }));
  const first = await syncConnection(api, s, conn(), NOW);
  assert.equal(first.added.length, 3); // two equal coffees are two movements
  s.tx.push(...first.added);
  const second = await syncConnection(api, s, conn(), NOW);
  assert.equal(second.added.length, 0);
});

test('una compra ya importada de un extracto, que el banco contabiliza al día siguiente, no se duplica', async () => {
  const s = emptyState();
  s.tx.push({ id: 'f1', date: '2026-10-20', concept: 'Pago en MERCADONA VALENCIA', amount: -54.3, cat: 'supermercado', src: 'extracto.xlsx', fid: 'f' });
  const { api } = fakeApi(() => ({ transactions: [
    bt({ entry_reference: 'r9', booking_date: '2026-10-21', transaction_amount: amt('54.30'), remittance_information: ['MERCADONA VALENCIA'], merchant_category_code: '5411' }),
    bt({ entry_reference: 'r10', booking_date: '2026-10-22', transaction_amount: amt('54.30'), remittance_information: ['OTRA TIENDA'] }),
  ] }));
  const r = await syncConnection(api, s, conn(), NOW);
  assert.equal(r.merged, 1);
  assert.deepEqual([s.tx[0].ext, s.tx[0].acct, s.tx[0].mcc], ['eb:ing:r:r9', 'ing', '5411']);
  assert.equal(r.added.length, 1); // the other shop is new: the statement movement is already taken
  assert.equal(r.added[0].rv, undefined);
  assert.equal(r.maybe, 0);
});

test('un posible duplicado entra marcado para revisar', async () => {
  const s = emptyState();
  s.tx.push({ id: 'f1', date: '2026-10-20', concept: 'COMPRA ONLINE', amount: -30, cat: 'compras', fid: 'f' });
  const { api } = fakeApi(() => ({ transactions: [bt({ entry_reference: 'x', booking_date: '2026-10-22', transaction_amount: amt('30'), remittance_information: ['AMAZON EU'] })] }));
  const r = await syncConnection(api, s, conn(), NOW);
  assert.equal(r.maybe, 1);
  assert.equal(r.added[0].rv, 'dup');
  assert.equal(r.added[0].dupOf, 'f1');
});

test('de ING a Trade Republic con los dos bancos conectados: traspaso; el plan de inversión cuenta como inversión', async () => {
  const s = emptyState();
  s.accounts.push({ id: 'ing', name: 'ING', kind: 'banco', iban: '', aliases: ['ing'], track: 'auto' }, { id: 'tr', name: 'Trade Republic', kind: 'broker', iban: '', aliases: ['trade republic'], track: 'auto' });
  const ing = fakeApi(() => ({ transactions: [bt({ entry_reference: 'i1', booking_date: '2026-10-22', transaction_amount: amt('300.00'), creditor: { name: 'Trade Republic Bank GmbH' }, remittance_information: ['Transferencia emitida'] })] }));
  const tr = fakeApi(() => ({ transactions: [
    bt({ entry_reference: 't1', booking_date: '2026-10-22', credit_debit_indicator: 'CRDT', transaction_amount: amt('300.00'), debtor: { name: 'AARON' }, remittance_information: ['Ingreso'] }),
    bt({ entry_reference: 't2', booking_date: '2026-10-23', transaction_amount: amt('150.00'), remittance_information: ['Savings plan execution IE00B4L5Y983'] }),
  ] }));
  const fresh = new Set();
  for (const [api, c] of [[ing.api, conn()], [tr.api, conn({ id: 'c2', aspsp: { name: 'Trade Republic', country: 'DE' }, accounts: [{ uid: 'u2', acctId: 'tr' }] })]]) {
    const r = await syncConnection(api, s, c, NOW);
    for (const t of r.added) { s.tx.push(t); fresh.add(t.id); }
  }
  classify(s, fresh);
  assert.deepEqual(s.tx.map((t) => [t.amount, t.cat, t.rv || null]), [[-300, 'excluir', null], [300, 'excluir', null], [-150, 'inversion', null]]);
});

test('cuándo toca sincronizar, pausa tras «demasiadas consultas» y avisos de caducidad', () => {
  assert.equal(dueForSync(conn({ lastSync: iso(NOW - AUTO_INTERVAL - 1) }), NOW), true);
  assert.equal(dueForSync(conn({ lastSync: iso(NOW - 60e3) }), NOW), false);
  assert.equal(dueForSync(conn({ lastSync: iso(NOW - 60e3), firstDone: false }), NOW), true); // just authorised
  assert.equal(dueForSync(conn({ cooldownUntil: iso(NOW + 3600e3) }), NOW), false);
  assert.equal(coolingDown(conn({ cooldownUntil: iso(NOW - 1) }), NOW), false);
  assert.equal(expired(conn({ valid_until: iso(NOW - 1) }), NOW), true);
  assert.equal(expiresSoon(conn({ valid_until: iso(NOW + 3 * 864e5) }), NOW), true);
  assert.equal(expiresSoon(conn({ valid_until: iso(NOW + 30 * 864e5) }), NOW), false);
  assert.match(syncErrorText(new ApiError('x', 429, 'ASPSP_RATE_LIMIT_EXCEEDED')), /6 horas/);
  assert.match(syncErrorText(new ApiError('x', 403, 'EXPIRED_SESSION')), /Vuelve a autorizarlo/);
  assert.match(syncErrorText(new ApiError('x', 401)), /clave de acceso/);
});
