// Example data shown until the first statement or bank arrives.
import { uid } from './util.js';

export function sampleTx() {
  const L = [];
  const add = (d, c, a) => L.push({ id: uid(), date: d, concept: c, amount: a, src: 'Ejemplo' });
  ['2026-07', '2026-08', '2026-09'].forEach((m, i) => {
    add(m + '-01', 'TRANSFERENCIA RECIBIDA NOMINA ACME SERVICIOS SL', 1985.40 + (i === 1 ? 310 : 0));
    add(m + '-02', 'RECIBO ALQUILER VIVIENDA C/ MAYOR 12', -760);
    add(m + '-03', 'RECIBO IBERDROLA CLIENTES SAU', -[58.2, 71.9, 49.3][i]);
    add(m + '-04', 'RECIBO DIGI SPAIN TELECOM', -30);
    add(m + '-05', 'COMPRA TARJ. 4512 MERCADONA VALENCIA', -[64.32, 71.10, 58.77][i]);
    add(m + '-06', 'COMPRA TARJ. 4512 NETFLIX.COM', -12.99);
    add(m + '-06', 'COMPRA TARJ. 4512 SPOTIFY P1A2B3', -11.99);
    add(m + '-08', 'COMPRA TARJ. 4512 REPSOL E.S. AV. CID', -[52, 61.4, 48.9][i]);
    add(m + '-09', 'COMPRA TARJ. 4512 LIDL CAMPANAR', -[38.15, 42.6, 35.2][i]);
    add(m + '-11', 'COMPRA TARJ. 4512 BAR EL RINCON', -[18.5, 24, 12.8][i]);
    add(m + '-12', 'BIZUM RECIBIDO DE LAURA G. CENA', [22, 15, 30][i]);
    add(m + '-13', 'COMPRA TARJ. 4512 AMAZON.ES AMZN MKTP', -[34.99, 89.5, 22.4][i]);
    add(m + '-14', 'RECIBO SEGURO HOGAR MAPFRE', -24.6);
    add(m + '-15', 'COMPRA TARJ. 4512 MERCADONA VALENCIA', -[81.4, 66.2, 77.9][i]);
    add(m + '-16', 'COMPRA TARJ. 4512 GLOVO PEDIDO', -[23.9, 31.5, 19.9][i]);
    add(m + '-17', 'RECIBO BASIC FIT SPAIN', -29.99);
    add(m + '-19', 'COMPRA TARJ. 4512 FARMACIA LDO. PEREZ', -[12.4, 8.9, 26.3][i]);
    add(m + '-20', 'RETIRADA CAJERO 4512 VALENCIA', -[60, 40, 80][i]);
    add(m + '-22', 'TRASPASO A CUENTA AHORRO', -200);
    add(m + '-23', 'COMPRA TARJ. 4512 CONSUM BENIMACLET', -[29.6, 34.2, 41.05][i]);
    add(m + '-25', 'COMPRA TARJ. 4512 RESTAURANTE LA PEPICA', -[46, 0, 58][i] || -31);
    add(m + '-27', 'COMPRA TARJ. 4512 ZARA VALENCIA', -[59.95, 0, 79.9][i] || -25.99);
    add(m + '-28', 'BIZUM ENVIADO A PABLO R. REGALO', -[15, 25, 10][i]);
    add(m + '-02', 'TRANSFERENCIA A TRADE REPUBLIC BANK', -300);
  });
  add('2026-08-03', 'COMPRA TARJ. 4512 RYANAIR', -148.6);
  add('2026-08-04', 'COMPRA TARJ. 4512 BOOKING.COM HOTEL', -312.4);
  add('2026-08-21', 'DEVOLUCION COMPRA AMAZON.ES', 34.99);
  add('2026-09-10', 'COMPRA TARJ. 4512 LIBRERIA PARIS-VALENCIA', -64.3);
  add('2026-09-30', 'INTERESES A SU FAVOR', 3.12);
  return L;
}

export function sampleInv() {
  return {
    sample: true, lastQuote: null,
    positions: [
      { id: uid(), broker: 'Trade Republic', name: 'iShares Core MSCI World (ejemplo)', isin: 'IE00B4L5Y983', qty: 42, cost: 3600, price: 101.2, priceDate: '2026-10-24' },
      { id: uid(), broker: 'Renta 4', name: 'Fondo indexado S&P 500 (ejemplo)', isin: '', qty: 120.5, cost: 2400, price: 23.1, priceDate: '2026-10-24' },
    ],
    history: [{ d: '2026-07-31', v: 5420, c: 5400 }, { d: '2026-08-31', v: 5610, c: 5700 }, { d: '2026-09-30', v: 6390, c: 6000 }, { d: '2026-10-24', v: 7034, c: 6000 }],
  };
}
