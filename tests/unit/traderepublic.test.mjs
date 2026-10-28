import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../../js/parse/csv.js';
import { isTrExport, trRowsToTx, trPositions } from '../../js/parse/traderepublic.js';
import { rowsToPositions } from '../../js/parse/positions.js';

// Same columns as Trade Republic's «Exportar transacciones»; made-up rows, newest first as the app gives them.
const HEAD = 'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
const row = (o) => [o.dt || o.d + 'T10:00:00Z', o.d, 'DEFAULT', o.cat, o.type, o.cls || '', o.name || '', o.isin || '', o.shares || '', o.price || '', o.amount ?? '', o.fee || '', o.tax || '', 'EUR', '', '', '', o.desc || '', o.id || 'id-' + o.d + o.type, o.cpName || '', o.cpIban || '', '', o.mcc || '']
  .map((c) => '"' + c + '"').join(',');
const W = 'IE00B4L5Y983', A = 'US0378331005', S = 'IE00B5BMR087';
const CSV = [HEAD, ...[
  { d: '2026-10-20', cat: 'CASH', type: 'CARD_TRANSACTION', name: 'MERCADONA VALENCIA', amount: '-45.30', desc: 'Card payment', mcc: '5411' },
  { d: '2026-10-15', cat: 'TRADING', type: 'SELL', cls: 'STOCK', name: 'Apple Inc.', isin: A, shares: '-2.0000000000', price: '240.0000', amount: '480.00', fee: '-1.00', tax: '-12.50' },
  { d: '2026-10-10', cat: 'CASH', type: 'DIVIDEND', name: 'Apple Inc.', isin: A, shares: '5', amount: '1.10' },
  { d: '2026-10-02', cat: 'CORPORATE_ACTION', type: 'SPLIT', name: 'iShares Core S&P 500', isin: S, shares: '9' },
  { d: '2026-10-01', cat: 'CASH', type: 'INTEREST_PAYMENT', amount: '3.25' },
  { d: '2026-09-20', cat: 'DELIVERY', type: 'FREE_RECEIPT', name: 'iShares Core S&P 500', isin: S, shares: '1.5' },
  { d: '2026-09-16', cat: 'CASH', type: 'BENEFITS_SAVEBACK', amount: '5.00', desc: 'Saveback' },
  { d: '2026-09-16', dt: '2026-09-16T11:00:00Z', cat: 'TRADING', type: 'BUY', cls: 'FUND', name: 'iShares Core MSCI World USD (Acc)', isin: W, shares: '0.0500000000', price: '100.0000', amount: '-5.00' },
  { d: '2026-09-15', cat: 'TRADING', type: 'BUY', cls: 'FUND', name: 'iShares Core MSCI World USD (Acc)', isin: W, shares: '2.0000000000', price: '100.0000', amount: '-200.00' },
  { d: '2026-09-10', cat: 'TRADING', type: 'BUY', cls: 'STOCK', name: 'Apple Inc.', isin: A, shares: '5.0000000000', price: '200.0000', amount: '-1000.00', fee: '-1.00' },
  { d: '2026-09-01', cat: 'CASH', type: 'TRANSFER_INSTANT_INBOUND', amount: '2000.00', desc: 'Incoming transfer', cpName: 'AARON EJEMPLO', cpIban: 'ES91 2100 0418 4502 0005 1332' },
].map(row)].join('\n');
const rows = parseCSV(CSV);

test('reconoce la exportación de Trade Republic y no otros CSV', () => {
  assert.equal(isTrExport(rows), true);
  assert.equal(isTrExport(parseCSV('Fecha;Concepto;Importe\n01/10/2026;Mercadona;-10,00')), false);
});

test('posiciones de Trade Republic: lo que dejan las compras y ventas, a coste medio con comisiones', () => {
  const p = trPositions(rows);
  const by = Object.fromEntries(p.map((x) => [x.isin, x]));
  assert.equal(p.length, 3);
  // 5 Apple for 1001 € (fee included); 2 sold (written negative): 3 left at the average cost.
  assert.deepEqual(by[A], { name: 'Apple Inc.', isin: A, qty: 3, cost: 600.6, price: 240, priceDate: '2026-10-15', costGuess: false });
  // The saveback buy is invested money too.
  assert.deepEqual(by[W], { name: 'iShares Core MSCI World USD (Acc)', isin: W, qty: 2.05, cost: 205, price: 100, priceDate: '2026-09-16', costGuess: false });
  // Received from another broker: the units are there, what they cost is not.
  assert.equal(by[S].qty, 1.5);
  assert.equal(by[S].costGuess, true);
  // The split cannot be applied; the dividend (which also says how many you had) is not a movement of units.
  assert.match(p.note, /^Un movimiento de valores .*no se ha podido/);
});

test('posiciones de Trade Republic: lo vendido del todo desaparece y el orden del archivo no importa', () => {
  const sold = parseCSV([HEAD,
    row({ d: '2026-09-10', cat: 'TRADING', type: 'BUY', name: 'Apple Inc.', isin: A, shares: '5', amount: '-1000.00' }),
    row({ d: '2026-10-15', cat: 'TRADING', type: 'SELL', name: 'Apple Inc.', isin: A, shares: '5', amount: '1100.00' }),
    row({ d: '2026-09-15', cat: 'TRADING', type: 'BUY', name: 'iShares Core MSCI World USD (Acc)', isin: W, shares: '1,5', amount: '-150,00' }),
  ].join('\n'));
  const p = trPositions(sold);
  assert.deepEqual(p.map((x) => [x.isin, x.qty, x.cost]), [[W, 1.5, 150]]);
  assert.equal(p.note, undefined);
  assert.throws(() => trPositions(parseCSV([HEAD, row({ d: '2026-10-01', cat: 'CASH', type: 'INTEREST_PAYMENT', amount: '1.00' })].join('\n'))), /ninguna posición abierta/);
});

test('el lector genérico ya no es el que lee esta exportación (daba una posición por compra)', () => {
  assert.ok(rowsToPositions(rows).length > 3);
});

test('movimientos de Trade Republic: comercio, compras de valores, comisiones e impuestos, código MCC e IBAN de la otra parte', () => {
  const { tx, iban } = trRowsToTx(rows);
  assert.equal(iban, '');
  assert.equal(tx.length, 9); // the split and the received units move no money
  assert.deepEqual(tx[0], { date: '2026-09-01', concept: 'AARON EJEMPLO', amount: 2000, cpName: 'AARON EJEMPLO', cpIban: 'ES9121000418450200051332' });
  assert.deepEqual(tx[1], { date: '2026-09-10', concept: 'Compra de valores Apple Inc.', amount: -1001 });
  assert.deepEqual(tx.find((t) => t.concept === 'Saveback'), { date: '2026-09-16', concept: 'Saveback', amount: 5 });
  assert.deepEqual(tx.find((t) => t.concept === 'Intereses'), { date: '2026-10-01', concept: 'Intereses', amount: 3.25 });
  assert.deepEqual(tx.find((t) => t.concept.startsWith('Dividendo')), { date: '2026-10-10', concept: 'Dividendo Apple Inc.', amount: 1.1 });
  assert.deepEqual(tx.find((t) => t.concept.startsWith('Venta')), { date: '2026-10-15', concept: 'Venta de valores Apple Inc.', amount: 466.5 });
  assert.deepEqual(tx[tx.length - 1], { date: '2026-10-20', concept: 'MERCADONA VALENCIA', amount: -45.3, mcc: '5411' });
});

test('un informe que no se entiende enseña solo los títulos de sus columnas, ninguna cifra', () => {
  const r = parseCSV('Cartera a 27/10/2026\nProducto;Cód.;Saldo vivo;Valoración\nFondo X;IE00B4L5Y983;12,5;1.234,56');
  assert.throws(() => rowsToPositions(r), (e) => e.message.endsWith('Columnas que veo: Producto · Cód. · Saldo vivo · Valoración.') && !/1\.234|12,5/.test(e.message));
});

test('«Uds.» como columna de títulos, como en algunos informes en español', () => {
  const p = rowsToPositions(parseCSV('Producto;ISIN;Uds.;Valoración\nVanguard Global Stock;IE00B03HD191;12,5;1.234,56'));
  assert.deepEqual(p.map((x) => [x.isin, x.qty, x.price]), [['IE00B03HD191', 12.5, 98.7648]]);
});
