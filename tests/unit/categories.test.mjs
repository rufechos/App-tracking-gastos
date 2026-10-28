import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, mccCategory, suggestKw, DEFAULT_CATS } from '../../js/categories.js';

// Typical Spanish bank concepts (invented) and the category a person would pick. Movements between your own
// accounts, cards and brokers depend on «Mis cuentas» and are covered in accounts.test.mjs.
const CASES = [
  ['Pago en MERCADONA VALENCIA', -54.3, 'supermercado'], ['Pago en LIDL CAMPANAR', -23.1, 'supermercado'],
  ['Pago en CONSUM BENIMACLET', -31.2, 'supermercado'], ['Pago en CARREFOUR EXPRESS', -12.4, 'supermercado'],
  ['Pago en LA SIRENA ALIMENTACION', -18.9, 'supermercado'], ['Pago en PRIMAPRIX', -15.0, 'supermercado'],
  ['Pago en GLOVO*PEDIDO', -21.5, 'restaurantes'], ['Pago en UBER *EATS', -19.9, 'restaurantes'],
  ['Pago en SUMUP *BAR PEPE', -8.5, 'restaurantes'], ['Pago en ZETTLE_*CAFE CENTRAL', -3.2, 'restaurantes'],
  ['Pago en REST. CASA PEPE', -42.0, 'restaurantes'], ['Pago en PANS & COMPANY', -9.9, 'restaurantes'],
  ['Pago en UBER *TRIP', -12.3, 'transporte'], ['Pago en CABIFY', -14.8, 'transporte'],
  ['Pago en E.S. GALP ENERGIA', -60.0, 'transporte'], ['Pago en ESTACION DE SERVICIO REPSOL', -55.0, 'transporte'],
  ['Pago en PLENERGY VALENCIA', -48.0, 'transporte'], ['Pago en BP OIL ESPANA', -50.0, 'transporte'],
  ['Pago en TOTALENERGIES ESTACION', -45.0, 'transporte'], ['Pago en RENFE VIAJEROS', -32.0, 'transporte'],
  ['Pago en METROVALENCIA', -1.5, 'transporte'], ['Pago en AUTOPISTA AP-7 PEAJE', -6.4, 'transporte'],
  ['Recibo IBERDROLA CLIENTES SAU', -71.9, 'suministros'], ['Recibo REPSOL LUZ Y GAS', -63.0, 'suministros'],
  ['Recibo OCTOPUS ENERGY ESPANA', -58.0, 'suministros'], ['Recibo EDP COMERCIALIZADORA', -66.0, 'suministros'],
  ['Recibo DIGI SPAIN TELECOM', -30.0, 'suministros'], ['Recibo VODAFONE ESPANA', -40.0, 'suministros'],
  ['Recibo AGUAS DE VALENCIA', -25.0, 'suministros'], ['Pago en NETFLIX.COM', -12.99, 'suscripciones'],
  ['Pago en SPOTIFY P1A2B3', -11.99, 'suscripciones'], ['Pago en APPLE.COM/BILL', -2.99, 'suscripciones'],
  ['Pago en OPENAI *CHATGPT SUBSCR', -22.0, 'suscripciones'], ['Pago en AMAZON PRIME*1A2B3', -4.99, 'suscripciones'],
  ['Pago en AMZN Mktp ES', -34.99, 'compras'], ['Pago en ZARA HOME', -29.9, 'compras'], ['Pago en DECATHLON', -45.0, 'compras'],
  ['Pago en IKEA VALENCIA', -89.0, 'compras'], ['Pago en PRIMARK', -22.0, 'compras'], ['Pago en H&M', -19.99, 'compras'],
  ['Pago en FARMACIA LDO PEREZ', -12.4, 'salud'], ['Pago en CLINICA DENTAL SONRISA', -60.0, 'salud'],
  ['Recibo SANITAS SA DE SEGUROS', -55.0, 'salud'], ['Recibo BASIC-FIT SPAIN', -29.99, 'ocio'], ['Pago en CINESA', -9.5, 'ocio'],
  ['Pago en RYANAIR', -148.6, 'viajes'], ['Pago en BOOKING.COM', -312.4, 'viajes'], ['Pago en NH HOTELES', -120.0, 'viajes'],
  ['Pago en AIRBNB', -230.0, 'viajes'], ['Recibo MAPFRE SEGUROS HOGAR', -24.6, 'seguros'],
  ['Recibo LINEA DIRECTA ASEGURADORA', -31.0, 'seguros'], ['Pago en CASA DEL LIBRO', -21.0, 'educacion'],
  ['Bizum enviado DONATIVO PARROQUIA', -20.0, 'donaciones'], ['Recibo MEDICOS SIN FRONTERAS ESPANA', -15.0, 'donaciones'],
  ['Transferencia emitida CARITAS DIOCESANA', -50.0, 'donaciones'], ['Recibo CUOTA SOCIO UNICEF COMITE ESPANOL', -12.0, 'donaciones'],
  ['Recibo CRUZ ROJA ESPANOLA', -10.0, 'donaciones'], ['Pago en TEAMING.NET', -1.0, 'donaciones'],
  ['Reintegro cajero VALENCIA', -60.0, 'efectivo'], ['Comision mantenimiento cuenta', -3.0, 'impuestos'],
  ['Recibo AYUNTAMIENTO VALENCIA IBI', -310.0, 'vivienda'], ['Recibo ALQUILER OCTUBRE', -760.0, 'vivienda'],
  ['Bizum enviado a PABLO R. regalo', -15.0, 'transf_env'], ['Transferencia emitida PAGO DIA DEL PADRE', -40.0, 'transf_env'],
  ['Nomina ACME SERVICIOS SL', 1985.4, 'nomina'], ['TRANSFERENCIA RECIBIDA NOMINA ACME SERVICIOS SL', 1985.4, 'nomina'],
  ['Bizum recibido de LAURA G. cena', 22.0, 'transf_rec'], ['Devolucion compra AMAZON', 34.99, 'devoluciones'],
  ['Intereses a su favor', 3.12, 'intereses'], ['Interest payment', 4.1, 'intereses'],
  ['Dividendo VANGUARD FTSE ALL-WORLD', 6.3, 'intereses'], ['Transferencia a TRADE REPUBLIC BANK', -300.0, 'inversion'],
  ['Transferencia emitida a RENTA 4 BANCO', -500.0, 'inversion'], ['Suscripcion fondo VANGUARD GLOBAL STOCK', -200.0, 'inversion'],
  ['Savings plan execution IE00B4L5Y983', -150.0, 'inversion'], ['Compra valores ISHARES CORE MSCI WORLD', -250.0, 'inversion'],
  ['Liquidacion tarjeta credito', -412.5, 'tarjeta'], ['Recibo BANKINTER CONSUMER FINANCE EFC', -412.5, 'tarjeta'],
  ['Recibo TARJETA AIR EUROPA', -412.5, 'tarjeta'], ['Traspaso a cuenta ahorro', -200.0, 'excluir'],
];

test('categoriza los conceptos típicos de bancos españoles', () => {
  const bad = CASES.map(([c, a, exp]) => [c, exp, categorize({ concept: c, amount: a }).cat]).filter(([, exp, got]) => exp !== got);
  assert.deepEqual(bad, []);
});

test('las palabras genéricas quedan por revisar y pierden frente a las específicas', () => {
  assert.equal(categorize({ concept: 'Pago en REST. CASA PEPE', amount: -42 }).conf, 'generic');
  assert.equal(categorize({ concept: 'Pago en MERCADONA', amount: -4 }).conf, 'kw');
  assert.equal(categorize({ concept: 'Pago en XYZ 123', amount: -4 }).conf, 'none');
  assert.equal(categorize({ concept: 'Pago en XYZ 123', amount: 4 }).cat, 'otros_i');
});

test('una eléctrica que también tiene gasolineras: recibo = luz, pago con tarjeta = gasolina', () => {
  assert.equal(categorize({ concept: 'RECIBO REPSOL COMERCIALIZADORA', amount: -50 }).cat, 'suministros');
  assert.equal(categorize({ concept: 'COMPRA TARJ REPSOL AV CID', amount: -50 }).cat, 'transporte');
});

test('el código de comercio (MCC) decide cuando no hay palabra clave', () => {
  assert.equal(categorize({ concept: 'Pago en NOMBRE RARO SL', amount: -20, mcc: '5812' }).cat, 'restaurantes');
  assert.equal(categorize({ concept: 'Pago en MERCADONA', amount: -20, mcc: '5812' }).cat, 'supermercado');
  assert.equal(mccCategory('5541'), 'transporte');
  assert.equal(mccCategory('3015'), 'viajes');
  assert.equal(mccCategory('abc'), null);
  assert.equal(mccCategory('8398'), 'donaciones');
});

test('las reglas ganan y respetan el signo, el importe y la cuenta', () => {
  const ctx = { cats: DEFAULT_CATS, rules: [
    { kw: 'pepe', cat: 'restaurantes' },
    { kw: 'pepe', cat: 'transf_rec', sign: 'ingreso' },
    { kw: 'alquiler', cat: 'ocio', min: 1000 },
    { kw: 'mercadona', cat: 'compras', acct: 'a1' },
  ] };
  assert.equal(categorize({ concept: 'Bizum PEPE', amount: -10 }, ctx).cat, 'restaurantes');
  assert.equal(categorize({ concept: 'Bizum PEPE', amount: 10 }, ctx).cat, 'transf_rec');
  assert.equal(categorize({ concept: 'Recibo ALQUILER', amount: -760 }, ctx).cat, 'vivienda');
  assert.equal(categorize({ concept: 'Recibo ALQUILER', amount: -1760 }, ctx).cat, 'ocio');
  assert.equal(categorize({ concept: 'MERCADONA', amount: -10, acct: 'a1' }, ctx).cat, 'compras');
  assert.equal(categorize({ concept: 'MERCADONA', amount: -10, acct: 'a2' }, ctx).cat, 'supermercado');
});

test('sugiere el nombre del comercio para aprender una regla', () => {
  assert.equal(suggestKw('COMPRA TARJ. 4512 BAR EL RINCON'), 'bar rincon');
  assert.equal(suggestKw('Pago en SUMUP *PANADERIA LOLA'), 'panaderia lola');
});
