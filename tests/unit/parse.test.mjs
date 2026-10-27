import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, parseDate } from '../../js/parse/numbers.js';
import { parseCSV, decodeText, toCSV } from '../../js/parse/csv.js';
import { rowsToTx } from '../../js/parse/tabular.js';
import { yearResolver, linesToTx } from '../../js/parse/pdf-statement.js';
import { validIsin, rowsToPositions, linesToPositions } from '../../js/parse/positions.js';
import { cleanIban, findIban, ymd, dayDiff, addDays, addMonths } from '../../js/util.js';

const IBAN = 'ES9121000418450200051332'; // the usual documentation example, valid check digits

test('importes como los escriben los bancos', () => {
  const cases = [
    ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['-12,30', -12.3], ['12,30-', -12.3], ['(12,30)', -12.3],
    ['−12,30 €', -12.3], ['+45,00', 45], ['1.000', 1000], ['1,5', 1.5], ['12.5', 12.5], ["1'234.50", 1234.5],
    ['EUR 7,00', 7], ['1.234.567,89', 1234567.89], [3.5, 3.5], ['', null], ['abc', null], [null, null], [NaN, null],
  ];
  for (const [v, want] of cases) assert.equal(parseNum(v), want, String(v));
});

test('fechas en todos los formatos habituales', () => {
  const serial = Date.UTC(2026, 9, 24) / 864e5 + 25569;
  const cases = [
    ['2026-10-24', '2026-10-24'], ['24/10/2026', '2026-10-24'], ['24-10-26', '2026-10-24'], ['24.10.2026', '2026-10-24'],
    ['24 oct 2026', '2026-10-24'], ['3 Dez. 2025', '2025-12-03'], ['31/02/2026', null], ['24 oct', null], ['hola', null],
    [serial, '2026-10-24'], [new Date(2026, 9, 24), '2026-10-24'],
  ];
  for (const [v, want] of cases) assert.equal(parseDate(v), want, String(v));
});

test('utilidades de fechas e IBAN', () => {
  assert.equal(ymd(2026, 2, 29), null);
  assert.equal(ymd(2028, 2, 29), '2028-02-29');
  assert.equal(dayDiff('2025-12-30', '2026-01-02'), 3);
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // across the clock change
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 14), '2028-01');
  assert.equal(cleanIban('ES91 2100 0418 4502 0005 1332'), IBAN);
  assert.equal(cleanIban('ES92 2100 0418 4502 0005 1332'), '');
  assert.equal(findIban('Cuenta: ES91 2100 0418 4502 0005 1332 Titular'), IBAN);
});

test('CSV: separador, comillas y codificación', () => {
  assert.deepEqual(parseCSV('Fecha;Concepto;Importe\r\n24/10/2026;"BAR ""EL RINCÓN""; VALENCIA";-8,50\r\n'),
    [['Fecha', 'Concepto', 'Importe'], ['24/10/2026', 'BAR "EL RINCÓN"; VALENCIA', '-8,50']]);
  assert.deepEqual(parseCSV('date,description,amount\n2026-10-24,"Coffee, large",-3.20'), [['date', 'description', 'amount'], ['2026-10-24', 'Coffee, large', '-3.20']]);
  assert.deepEqual(parseCSV('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('"línea\nsegunda";x\n'), [['línea\nsegunda', 'x']]);
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x4e, 0xc3, 0xb3])), 'Nó');
  assert.equal(decodeText(new Uint8Array([0x4e, 0xf3, 0x6d, 0x69, 0x6e, 0x61])), 'Nómina'); // Windows-1252
  assert.equal(toCSV([['a;b', 'c"d', 1]]), '﻿"a;b";"c""d";1\r\n');
});

test('extracto de ING: cabecera tras varias filas, IBAN y columnas de importe y saldo', () => {
  const rows = [
    ['Movimientos de la Cuenta'], ['Número de cuenta:', 'ES91 2100 0418 4502 0005 1332'], ['Titular:', 'AARÓN'], [],
    ['F. VALOR', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCIÓN', 'COMENTARIO', 'IMAGEN', 'IMPORTE (€)', 'SALDO (€)'],
    ['24/10/2026', 'Alimentación', 'Supermercados', 'Pago en MERCADONA VALENCIA', '', '', '-54,30', '1.945,70'],
    ['23/10/2026', 'Nómina', '', 'Transferencia recibida NOMINA ACME', '', '', '2.000,00', '2.000,00'],
    ['22/10/2026', '', '', 'Movimiento sin importe', '', '', '', '0,00'],
  ];
  const { tx, iban } = rowsToTx(rows);
  assert.equal(iban, IBAN);
  assert.deepEqual(tx, [
    { date: '2026-10-24', concept: 'Pago en MERCADONA VALENCIA', amount: -54.3, bal: 1945.7 },
    { date: '2026-10-23', concept: 'Transferencia recibida NOMINA ACME', amount: 2000, bal: 2000 },
  ]);
});

test('con varias fechas se usa la de operación, y cargo y abono en columnas separadas', () => {
  const a = rowsToTx([['Fecha valor', 'Fecha operación', 'Concepto', 'Importe'], ['21/10/2026', '20/10/2026', 'COMPRA ZARA', '-29,90']]);
  assert.equal(a.tx[0].date, '2026-10-20');
  const b = rowsToTx([['Fecha contable', 'Fecha valor', 'Descripción', 'Importe', 'Saldo'], ['21/10/2026', '20/10/2026', 'RECIBO DIGI', '-30,00', '100,00']]);
  assert.equal(b.tx[0].date, '2026-10-21');
  const c = rowsToTx([['Fecha', 'Concepto', 'Cargo', 'Abono', 'Saldo'], ['01/10/2026', 'ALQUILER', '760,00', '', '1.000,00'], ['02/10/2026', 'BIZUM DE LAURA', '', '22,00', '1.022,00']]);
  assert.deepEqual(c.tx.map((t) => t.amount), [-760, 22]);
});

test('sin cabecera reconocible se deducen las columnas del contenido', () => {
  const { tx } = rowsToTx([
    ['24/10/2026', 'MERCADONA VALENCIA', '-54,30', '1.200,00'],
    ['25/10/2026', 'BAR EL RINCON', '-8,50', '1.191,50'],
    ['26/10/2026', 'BIZUM RECIBIDO LAURA', '15,00', '1.206,50'],
  ]);
  assert.deepEqual(tx.map((t) => [t.date, t.concept, t.amount, t.bal]), [
    ['2026-10-24', 'MERCADONA VALENCIA', -54.3, 1200], ['2026-10-25', 'BAR EL RINCON', -8.5, 1191.5], ['2026-10-26', 'BIZUM RECIBIDO LAURA', 15, 1206.5],
  ]);
  assert.throws(() => rowsToTx([['a', 'b'], ['c', 'd']]), /fechas/);
});

test('PDF de tarjeta de diciembre a enero: cada fecha sin año cae en su año', () => {
  const lines = ['Periodo de liquidación del 15/12/2025 al 14/01/2026', 'Fecha de nacimiento del titular 02/03/1980'];
  const r = yearResolver(lines, '2026-10-27');
  assert.equal(r(20, 12), '2025-12-20');
  assert.equal(r(3, 1), '2026-01-03');
  // Without full dates, a day still to come this year belongs to last year.
  const r2 = yearResolver(['sin fechas completas'], '2026-10-27');
  assert.equal(r2(20, 12), '2025-12-20');
  assert.equal(r2(3, 1), '2026-01-03');
  assert.equal(r2(28, 10), '2026-10-28'); // tomorrow: allowed (time zones)
});

test('PDF: importes sin signo, segunda fecha, líneas que continúan el concepto e IBAN', () => {
  const { tx, iban } = linesToTx([
    'EXTRACTO TARJETA', 'Cuenta de cargo ES91 2100 0418 4502 0005 1332', 'Periodo del 15/12/2025 al 14/01/2026',
    'Fecha Concepto Importe',
    '20/12 MERCADONA VALENCIA 54,30',
    '28/12 29/12 AMAZON EU SARL 23,99',
    'AMAZON.ES PEDIDO',
    '03/01 REPSOL E.S. AV CID 60,00',
    '05/01 DEVOLUCION AMAZON EU 23,99',
  ], '2026-10-27');
  assert.equal(iban, IBAN);
  assert.deepEqual(tx, [
    { date: '2025-12-20', concept: 'MERCADONA VALENCIA', amount: -54.3 },
    { date: '2025-12-28', concept: 'AMAZON EU SARL AMAZON.ES PEDIDO', amount: -23.99 },
    { date: '2026-01-03', concept: 'REPSOL E.S. AV CID', amount: -60 },
    { date: '2026-01-05', concept: 'DEVOLUCION AMAZON EU', amount: 23.99 },
  ]);
});

test('PDF de cuenta: el saldo decide el signo cuando no lo hay', () => {
  const { tx } = linesToTx([
    '01/10/2026 NOMINA ACME 2.000,00 3.000,00',
    '02/10/2026 ALQUILER 760,00 2.240,00',
    '03/10/2026 TRANSFERENCIA DE LAURA 50,00 2.290,00',
  ], '2026-10-27');
  assert.deepEqual(tx.map((t) => t.amount), [2000, -760, 50]);
  const signed = linesToTx(['24/10/2026 24/10/2026 COMPRA MERCADONA -54,30 1.200,00'], '2026-10-27');
  assert.deepEqual(signed.tx, [{ date: '2026-10-24', concept: 'COMPRA MERCADONA', amount: -54.3 }]);
  assert.throws(() => linesToTx(['nada que ver'], '2026-10-27'), /No he encontrado movimientos/);
});

test('ISIN con dígito de control', () => {
  for (const ok of ['US0378331005', 'IE00B4L5Y983', 'AU0000XVGZA3', 'GB0002634946']) assert.ok(validIsin(ok), ok);
  for (const bad of ['US0378331006', 'IE00B4L5Y984', 'ABCDEFGHIJKL', '']) assert.ok(!validIsin(bad), bad);
});

test('informe de posiciones de Renta 4 en hoja de cálculo', () => {
  const pos = rowsToPositions([
    ['Cartera de fondos'],
    ['Fondo', 'ISIN', 'Participaciones', 'Coste', 'Valor liquidativo', 'Valoración'],
    ['Vanguard Global Stock Index Fund EUR Acc', 'IE00B4L5Y983', '35,123', '1.000,00', '33,50', '1.176,62'],
    ['Fondo sin ISIN reconocible', 'XX', '10', '', '', '250,00'],
    ['Total', '', '', '1.000,00', '', '1.426,62'],
  ]);
  assert.equal(pos.length, 2);
  assert.deepEqual(pos[0], { name: 'Vanguard Global Stock Index Fund EUR Acc', isin: 'IE00B4L5Y983', qty: 35.123, cost: 1000, price: 33.5, costGuess: false });
  assert.deepEqual(pos[1], { name: 'Fondo sin ISIN reconocible', isin: '', qty: 10, cost: 250, price: 25, costGuess: true });
  assert.throws(() => rowsToPositions([['a', 'b'], ['1', '2']]), /títulos/);
});

test('informe de posiciones de Trade Republic en PDF', () => {
  const pos = linesToPositions(['POSICIONES', '35,123 Stk. iShares Core MSCI World USD (Acc) 101,20 3.554,45 24.10.2026', 'ISIN: IE00B4L5Y983', 'Total 3.554,45']);
  assert.equal(pos.length, 1);
  assert.equal(pos[0].isin, 'IE00B4L5Y983');
  assert.equal(pos[0].name, 'iShares Core MSCI World USD (Acc)');
  assert.equal(pos[0].qty, 35.123);
  assert.equal(pos[0].cost, 3554.45);
  assert.ok(Math.abs(pos[0].price - 101.2) < 0.01);
});
