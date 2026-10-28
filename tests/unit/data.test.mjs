import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, fileKey, withBankKeys, findTwin, matchBatch } from '../../js/dedup.js';
import { importStatement, setFileAccount, removeFile } from '../../js/import.js';
import { confirmDuplicate, settle, reviewItems } from '../../js/review.js';
import { emptyState, upgrade, normalizeState } from '../../js/store.js';
import { legacyCategory, migrateV1 } from '../../js/migrate.js';
import { exportData, validateBackup, movementsCSV, backupDue } from '../../js/backup.js';
import { periodBounds, inPeriod, shiftMonth, periodLabel, shortcuts } from '../../js/period.js';
import { agg, monthsOf } from '../../js/aggregate.js';
import { invTotals, importPositionRows, applyQuotes, snapshot } from '../../js/invest.js';

const IBAN = 'ES9121000418450200051332';

test('parecido entre conceptos: palabras con sentido, sin números ni relleno', () => {
  assert.equal(similarity('COMPRA TARJ. 4512 MERCADONA VALENCIA', 'Pago en MERCADONA VALENCIA'), 1);
  assert.equal(similarity('MERCADONA VALENCIA', 'MERCADONA'), 1);
  assert.equal(similarity('BAR PEPE', 'CAFE CENTRAL'), 0);
  assert.equal(fileKey({ date: '2026-10-01', amount: -5, concept: 'Café  Central' }), '2026-10-01|-5.00|cafe central');
});

test('clave estable de los movimientos del banco: referencia, o fecha, importe, concepto y orden', () => {
  const make = () => [
    { date: '2026-10-24', concept: 'CAFE CENTRAL', amount: -3.2 },
    { date: '2026-10-24', concept: 'CAFE CENTRAL', amount: -3.2 },
    { date: '2026-10-24', bdate: '2026-10-25', concept: 'MERCADONA', amount: -54.3 },
    { date: '2026-10-24', concept: 'ZARA', amount: -20, ref: 'R1' },
  ];
  const a = withBankKeys(make(), 'acc').map((t) => t.ext);
  assert.deepEqual(a, ['eb:acc:2026-10-24|-3.20|cafe central#1', 'eb:acc:2026-10-24|-3.20|cafe central#2', 'eb:acc:2026-10-25|-54.30|mercadona#1', 'eb:acc:r:R1']);
  assert.deepEqual(withBankKeys(make(), 'acc').map((t) => t.ext), a); // the same on every sync
});

test('el mismo movimiento dos veces: seguro o dudoso', () => {
  const pool = [{ id: 'e1', date: '2026-10-20', concept: 'Pago en MERCADONA VALENCIA', amount: -54.3, acct: 'ing' }];
  const used = new Set();
  assert.equal(findTwin({ date: '2026-10-20', concept: 'MERCADONA', amount: -54.3, acct: 'ing' }, pool, used).level, 'sure');
  assert.equal(findTwin({ date: '2026-10-20', concept: 'OTRA COSA', amount: -54.3, acct: 'ing' }, pool, used).level, 'sure'); // same day, same account
  assert.equal(findTwin({ date: '2026-10-21', concept: 'MERCADONA', amount: -54.3, acct: 'ing' }, pool, used).level, 'sure');
  assert.equal(findTwin({ date: '2026-10-21', concept: 'OTRA COSA', amount: -54.3, acct: 'ing' }, pool, used).level, 'maybe');
  assert.equal(findTwin({ date: '2026-10-23', concept: 'MERCADONA', amount: -54.3, acct: 'ing' }, pool, used).level, 'maybe');
  assert.equal(findTwin({ date: '2026-10-24', concept: 'MERCADONA', amount: -54.3, acct: 'ing' }, pool, used), null);
  assert.equal(findTwin({ date: '2026-10-20', concept: 'MERCADONA', amount: -54.3, acct: 'card' }, pool, used), null);
  assert.equal(findTwin({ date: '2026-10-20', concept: 'MERCADONA', amount: -54.31, acct: 'ing' }, pool, used), null);
  // Two equal movements on different days each find their own.
  const twoPool = [{ id: 'a', date: '2026-10-01', concept: 'CAFE', amount: -2, acct: 'x' }, { id: 'b', date: '2026-10-03', concept: 'CAFE', amount: -2, acct: 'x' }];
  const items = [{ date: '2026-10-02', concept: 'CAFE', amount: -2, acct: 'x' }, { date: '2026-10-03', concept: 'CAFE', amount: -2, acct: 'x' }];
  const m = matchBatch(items, twoPool);
  assert.equal(m.get(items[1]).tx.id, 'b');
  assert.equal(m.get(items[0]).tx.id, 'a');
});

const fileRows = (rows) => ({ tx: rows.map(([date, concept, amount]) => ({ date, concept, amount })), iban: '' });

test('importar dos veces el mismo extracto no duplica nada, ni siquiera dos cafés iguales el mismo día', () => {
  const s = emptyState();
  const rows = [['2026-10-01', 'CAFE CENTRAL', -2], ['2026-10-01', 'CAFE CENTRAL', -2], ['2026-10-02', 'MERCADONA', -40]];
  const a = importStatement(s, fileRows(rows), { name: 'oct.csv' });
  assert.equal(a.entry.added, 3);
  assert.equal(a.fresh.size, 3);
  const b = importStatement(s, fileRows(rows.concat([['2026-10-03', 'ZARA', -20]])), { name: 'oct-bis.csv' });
  assert.equal(b.entry.added, 1);
  assert.equal(b.entry.dup, 3);
  assert.equal(s.tx.length, 4);
});

test('dos extractos de la misma cuenta que se solapan, con textos distintos', () => {
  const s = emptyState();
  importStatement(s, { tx: [{ date: '2026-10-20', concept: 'COMPRA TARJ. 4512 MERCADONA VALENCIA', amount: -54.3 }, { date: '2026-10-25', concept: 'BAR PEPE', amount: -8 }], iban: IBAN }, { name: 'oct.xls' });
  assert.equal(s.accounts.length, 1);
  assert.equal(s.accounts[0].name, 'CaixaBank');
  const r = importStatement(s, { tx: [{ date: '2026-10-21', concept: 'Pago en MERCADONA VALENCIA', amount: -54.3 }, { date: '2026-10-25', concept: 'CAFETERIA LUNA', amount: -8 }], iban: IBAN }, { name: 'oct.pdf' });
  assert.equal(r.entry.dup, 2); // one day apart with the same shop; same day, amount and account
  assert.equal(r.entry.added, 0);
  // A later statement that does not overlap is not compared with the first one.
  const later = importStatement(s, { tx: [{ date: '2026-11-01', concept: 'OTRO BAR', amount: -8 }], iban: IBAN }, { name: 'nov.pdf' });
  assert.equal(later.entry.added, 1);
  assert.equal(later.entry.maybe, 0);
});

test('un movimiento dudoso entra marcado para revisar, y confirmarlo como duplicado lo quita', () => {
  const s = emptyState();
  s.tx.push({ id: 'bank1', date: '2026-10-20', concept: 'AMAZON EU', amount: -30, acct: 'ing', ext: 'eb:ing:r:1', ref: '1', cat: 'compras' });
  const r = importStatement(s, fileRows([['2026-10-22', 'COMPRA ONLINE PEDIDO', -30]]), { name: 'oct.csv' });
  assert.equal(r.entry.maybe, 1);
  const dup = s.tx.find((t) => t.rv === 'dup');
  assert.equal(dup.dupOf, 'bank1');
  assert.deepEqual(reviewItems(s).map((t) => t.id), [dup.id]);
  confirmDuplicate(s, dup.id);
  assert.equal(s.tx.length, 1);
  assert.equal(s.files[0].added, 0);
  assert.equal(s.files[0].dup, 1);
});

test('confirmar duplicado: el que se queda adopta la clave del banco para no volver a entrar', () => {
  const s = emptyState();
  s.tx.push({ id: 'file1', date: '2026-10-20', concept: 'PAGO MERCADONA', amount: -54.3, cat: 'supermercado' });
  s.tx.push({ id: 'bank1', date: '2026-10-22', concept: 'MERCADONA', amount: -54.3, ext: 'eb:ing:r:9', acct: 'ing', mcc: '5411', rv: 'dup', dupOf: 'file1' });
  confirmDuplicate(s, 'bank1');
  assert.deepEqual(s.tx.map((t) => [t.id, t.ext, t.acct, t.mcc]), [['file1', 'eb:ing:r:9', 'ing', '5411']]);
});

test('resolver «Por revisar»', () => {
  const s = emptyState();
  s.tx.push({ id: 'a', date: '2026-10-01', concept: 'X', amount: -1, cat: 'otros_g', rv: 'otros' });
  s.tx.push({ id: 'b', date: '2026-10-01', concept: 'Y', amount: -1, cat: 'excluir', rv: 'transfer' });
  assert.equal(settle(s, 'a', 'ocio').manual, true);
  const b = settle(s, 'b', 'excluir');
  assert.equal(b.manual, true); // confirming what the app proposed
  assert.equal(b.rv, undefined);
  assert.equal(reviewItems(s).length, 0);
});

test('tarjeta en positivo: se invierte el signo; y asignar cuenta o quitar un extracto', () => {
  const s = emptyState();
  const r = importStatement(s, fileRows([['2026-10-01', 'A', 1], ['2026-10-02', 'B', 2], ['2026-10-03', 'C', 3], ['2026-10-04', 'D', 4]]), { name: 'tarjeta.pdf' });
  assert.equal(r.entry.flipped, true);
  assert.deepEqual(s.tx.map((t) => t.amount), [-1, -2, -3, -4]);
  setFileAccount(s, r.entry.id, 'card');
  assert.ok(s.tx.every((t) => t.acct === 'card'));
  removeFile(s, r.entry.id);
  assert.equal(s.tx.length, 0);
  assert.equal(s.files.length, 0);
  assert.throws(() => importStatement(s, { tx: [], iban: '' }, { name: 'x' }), /No he encontrado/);
});

test('datos de la primera versión: se conservan tus categorías a mano', () => {
  const v1 = {
    tx: [
      { date: '2026-10-01', concept: 'Pago en MERCADONA', amount: -40, cat: 'supermercado' },
      { date: '2026-10-02', concept: 'Pago en MERCADONA', amount: -10, cat: 'ocio' },
      { date: '2026-10-03', concept: 'TRADE REPUBLIC', amount: -100, cat: 'inversion' },
      { date: '2026-10-04', concept: 'TRADE REPUBLIC', amount: -100, cat: 'otros_g' },
    ],
    cats: [{ id: 'supermercado', name: 'Supermercado', kind: 'gasto' }], rules: [],
  };
  assert.equal(legacyCategory(v1.tx[2], [], [], true), 'inversion');
  const m = migrateV1(JSON.parse(JSON.stringify(v1)));
  assert.deepEqual(m.tx.map((t) => !!t.manual), [false, true, false, false]);
  const s = upgrade(v1);
  assert.equal(s.v, 2);
  assert.ok(s.tx.every((t) => t.id));
  assert.ok(s.cats.some((c) => c.id === 'tarjeta'));
  assert.deepEqual(s.tx.map((t) => t.cat), ['supermercado', 'ocio', 'inversion', 'inversion']);
  assert.equal(v1.tx[1].manual, undefined); // the original is not modified
  assert.ok(normalizeState({ tx: [], cats: [] }).cats.length > 20);
});

test('copia de seguridad: sin la clave del servidor, validada y con resumen', () => {
  const s = emptyState();
  s.tx.push({ id: 'a', date: '2026-10-01', concept: 'X', amount: -1, cat: 'otros_g' }, { id: 'b', date: '2026-09-01', concept: 'Y', amount: 2, cat: 'otros_i' });
  const ing = { id: 'c1', aspsp: { name: 'ING', country: 'ES' }, session_id: 's', accounts: [] };
  const out = exportData(s, { server: 'https://x.workers.dev', token: 'SECRETO', conns: [ing] }, new Date('2026-10-27T10:00:00Z'));
  assert.ok(!JSON.stringify(out).includes('SECRETO'));
  const v = validateBackup(JSON.parse(JSON.stringify(out)));
  assert.equal(v.ok, true);
  assert.deepEqual(v.summary, { tx: 2, from: '2026-09-01', to: '2026-10-01', exportedAt: '2026-10-27T10:00:00.000Z', positions: 0 });
  assert.deepEqual(v.bank, { server: 'https://x.workers.dev', conns: [ing] });
  assert.equal(validateBackup({ app: 'otra' }).ok, false);
  assert.match(validateBackup({ ...out, format: 2 }).error, /más nueva/);
  assert.match(validateBackup({ ...out, state: { ...out.state, tx: [{ date: 'ayer', amount: 1 }] } }).error, /dañada/);
});

test('una copia retocada no puede meter código en la página', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const v = validateBackup({ app: 'cuaderno-gastos', format: 1, state: { v: 2, tx: [{ id: evil, date: '2026-10-01', concept: 'X', amount: -1, cat: evil, acct: evil }], cats: [{ id: evil, name: 'Mía', kind: evil }], accounts: [{ id: evil, name: 'Cuenta', kind: evil }], rules: [{ kw: 'x', cat: evil }], files: [] },
    bank: { server: '', conns: [{ id: evil, aspsp: { name: 'ING' }, session_id: 's', accounts: [] }, { id: 'c2', aspsp: 'nada' }] } });
  assert.equal(v.ok, true);
  const t = v.state.tx[0], cat = v.state.cats.find((c) => c.name === 'Mía');
  assert.match(t.id, /^\w+$/);
  assert.equal(t.cat, cat.id);
  assert.equal(cat.kind, 'gasto');
  assert.equal(t.acct, v.state.accounts[0].id);
  assert.equal(v.state.accounts[0].kind, 'banco');
  assert.equal(v.state.rules[0].cat, cat.id);
  assert.equal(v.bank.conns.length, 1);
  assert.match(v.bank.conns[0].id, /^c_\w+$/);
});

test('CSV para Excel: coma decimal y sin fórmulas que se ejecuten', () => {
  const s = emptyState();
  s.tx.push({ id: 'a', date: '2026-10-01', concept: '=HYPERLINK("http://x","clic")', amount: -1234.5, cat: 'compras', src: '@origen' });
  const csv = movementsCSV(s);
  const line = csv.split('\r\n')[1];
  assert.equal(line, `01/10/2026;"'=HYPERLINK(""http://x"",""clic"")";-1234,50;Compras y ropa;Gasto;;'@origen`);
});

test('recordatorio de copia cada 30 días', () => {
  const s = emptyState();
  assert.equal(backupDue(s), false); // nothing to save
  s.tx.push({ id: 'a', date: '2026-10-01', concept: 'X', amount: -1 });
  assert.equal(backupDue(s), true);
  s.settings.lastBackup = '2026-10-01T00:00:00Z';
  assert.equal(backupDue(s, Date.parse('2026-10-20T00:00:00Z')), false);
  assert.equal(backupDue(s, Date.parse('2026-11-20T00:00:00Z')), true);
});

test('periodos: mes, año, últimos 12 meses y todo', () => {
  const today = '2026-10-27';
  assert.deepEqual(periodBounds({ kind: 'month', m: '2026-02' }, today), ['2026-02', '2026-02']);
  assert.deepEqual(periodBounds({ kind: 'year', y: '2025' }, today), ['2025-01', '2025-12']);
  assert.deepEqual(periodBounds({ kind: 'last12' }, today), ['2025-11', '2026-10']);
  assert.ok(inPeriod({ kind: 'all' }, today)('1999-01-01'));
  assert.ok(inPeriod({ kind: 'last12' }, today)('2025-11-30'));
  assert.ok(!inPeriod({ kind: 'last12' }, today)('2025-10-31'));
  assert.deepEqual(shiftMonth({ kind: 'month', m: '2026-01' }, -1, today), { kind: 'month', m: '2025-12' });
  assert.deepEqual(shiftMonth({ kind: 'year', y: '2026' }, 1, today), { kind: 'year', y: '2027' });
  assert.equal(periodLabel({ kind: 'month', m: '2026-10' }), 'Octubre 2026');
  assert.deepEqual(shortcuts(today).map((x) => x.label), ['Este mes', 'Mes pasado', 'Últimos 12 meses', 'Este año', 'Todo']);
});

test('totales: los traspasos no cuentan y la inversión va aparte', () => {
  const kind = { supermercado: 'gasto', compras: 'gasto', nomina: 'ingreso', inversion: 'inversion', excluir: 'excluir' };
  const r = agg([
    { cat: 'supermercado', amount: -50 }, { cat: 'compras', amount: -30 }, { cat: 'compras', amount: 30 },
    { cat: 'nomina', amount: 2000 }, { cat: 'inversion', amount: -300 }, { cat: 'excluir', amount: -450 },
  ], (id) => kind[id]);
  assert.deepEqual(r, { e: { supermercado: 50 }, inc: { nomina: 2000 }, te: 50, ti: 2000, tinv: 300 });
  assert.deepEqual(monthsOf([{ date: '2026-10-01' }, { date: '2026-09-05' }, { date: '2026-10-09' }]), ['2026-09', '2026-10']);
});

test('cartera: importar un informe sustituye las posiciones de ese bróker y conserva el coste conocido', () => {
  const inv = { positions: [{ id: 'p1', broker: 'Renta 4', name: 'Vanguard Global Stock', isin: 'IE00B4L5Y983', qty: 10, cost: 300, price: 33 }, { id: 'p2', broker: 'Trade Republic', name: 'Apple', isin: 'US0378331005', qty: 1, cost: 150, price: 200 }], history: [] };
  importPositionRows(inv, [{ name: 'Vanguard Global Stock', isin: 'IE00B4L5Y983', qty: 12, cost: 400, price: 34, costGuess: true }], 'Renta 4', '2026-10-27');
  const p = inv.positions.find((x) => x.broker === 'Renta 4');
  assert.equal(p.id, 'p1');
  assert.equal(p.cost, 300); // the report did not say what you paid
  assert.equal(p.qty, 12);
  assert.equal(inv.positions.length, 2);
  assert.deepEqual(invTotals(inv.positions), { v: 12 * 34 + 200, c: 450, g: 12 * 34 + 200 - 450, known: true });
  const q = applyQuotes(inv, { IE00B4L5Y983: { priceEur: 35, time: '2026-10-27T15:00:00Z' }, US0378331005: { error: 'Sin precio' } }, new Date('2026-10-27T16:00:00Z'));
  assert.deepEqual(q, { n: 1, miss: ['Apple'] });
  assert.equal(p.price, 35);
  snapshot(inv, '2026-10-27');
  assert.equal(inv.history.filter((h) => h.d === '2026-10-27').length, 1);
});

test('al abrir datos antiguos aparece «Donaciones» y los donativos se recolocan', () => {
  const cats = emptyState().cats.filter((c) => c.id !== 'donaciones');
  const s = upgrade({ v: 2, cats, rules: [], tx: [
    { id: 'a', date: '2026-10-01', amount: -30, concept: 'Bizum enviado donativo Caritas', cat: 'transf_env' },
    { id: 'b', date: '2026-10-02', amount: -30, concept: 'Bizum enviado donativo Caritas', cat: 'transf_env', manual: true },
  ] });
  assert.ok(s.cats.some((c) => c.id === 'donaciones'));
  assert.equal(s.tx[0].cat, 'donaciones');
  assert.equal(s.tx[1].cat, 'transf_env');
});
