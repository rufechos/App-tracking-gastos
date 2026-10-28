// Categories and automatic categorisation.
// A movement is matched against whole words of its normalised concept. Your rules win; then the most specific
// keyword (generic words such as "super" or "energia" only count when nothing better matches, and the longest
// keyword beats shorter ones); then the card's merchant code (MCC) when the bank sends it.
import { norm, wordMatch } from './util.js';

export const DEFAULT_CATS = [
  { id: 'vivienda', name: 'Vivienda', kind: 'gasto', kw: ['alquiler', 'hipoteca', 'comunidad de propietarios', 'comunidad prop', 'cuota comunidad', 'ibi', 'impuesto bienes inmuebles', 'prestamo hipotecario', 'administrador de fincas', 'cuota hipoteca'] },
  { id: 'suministros', name: 'Luz, agua, gas e internet', kind: 'gasto', kw: ['iberdrola', 'endesa', 'naturgy', 'holaluz', 'octopus', 'octopus energy', 'edp', 'edp comercializadora', 'factor energia', 'lucera', 'podo', 'som energia', 'aldro', 'curenergia', 'energia xxi', 'baser', 'gesternova', 'audax', 'nexus energia', 'repsol luz', 'repsol electricidad', 'luz y gas', 'canal de isabel', 'aguas de', 'aigues', 'emasesa', 'emaya', 'aqualia', 'agbar', 'gas natural', 'butano', 'movistar', 'telefonica', 'vodafone', 'orange', 'digi', 'digi spain', 'jazztel', 'masmovil', 'pepephone', 'lowi', 'yoigo', 'simyo', 'finetwork', 'o2', 'avatel', 'adamo', 'euskaltel', 'r cable', 'telecable', 'parlem', 'energia', 'electricidad', 'agua'] },
  { id: 'supermercado', name: 'Supermercado', kind: 'gasto', kw: ['mercadona', 'carrefour', 'carrefour express', 'carrefour market', 'lidl', 'aldi', 'dia retail', 'supermercados dia', 'dia supermercado', 'eroski', 'alcampo', 'consum', 'hipercor', 'supercor', 'bonpreu', 'bonarea', 'ahorramas', 'caprabo', 'gadis', 'froiz', 'supermercado', 'supermercados', 'spar', 'condis', 'coviran', 'family cash', 'el arbol', 'hiperber', 'masymas', 'mas y mas', 'la sirena', 'primaprix', 'dialprix', 'supeco', 'costco', 'makro', 'alimerka', 'bm supermercados', 'simply', 'lupa', 'hiber', 'charter', 'cash fresh', 'alimentacion', 'ultramarinos', 'frutas', 'fruteria', 'carniceria', 'pescaderia', 'panaderia', 'horno', 'mercado', 'super', 'dia'] },
  { id: 'restaurantes', name: 'Restaurantes y bares', kind: 'gasto', kw: ['restaurante', 'restaurant', 'rest', 'bar', 'cafeteria', 'cafe', 'glovo', 'just eat', 'uber eats', 'deliveroo', 'telepizza', 'dominos', 'mcdonalds', 'mcdonald s', 'burger king', 'kfc', 'starbucks', 'taberna', 'tasca', 'meson', 'asador', 'pizzeria', 'pizza', 'burger', 'kebab', 'wok', 'sushi', 'cerveceria', 'heladeria', 'churreria', 'vips', 'goiko', '100 montaditos', 'tgb', 'five guys', 'rodilla', 'foster s', 'tagliatella', 'pans company', 'pans', 'udon', 'foodies', 'tapas', 'gastrobar'] },
  { id: 'transporte', name: 'Transporte y coche', kind: 'gasto', kw: ['repsol', 'cepsa', 'moeve', 'bp', 'bp oil', 'galp', 'shell', 'totalenergies', 'ballenoil', 'plenoil', 'plenergy', 'petroprix', 'petronor', 'avia', 'meroil', 'esclatoil', 'tamoil', 'q8', 'gasolinera', 'gasoleo', 'estacion de servicio', 'est servicio', 'e s', 'renfe', 'metro', 'metrovalencia', 'emt', 'tmb', 'alsa', 'avanza', 'uber', 'cabify', 'bolt', 'free now', 'taxi', 'parking', 'aparcamiento', 'empark', 'telpark', 'saba', 'autopista', 'peaje', 'via t', 'iryo', 'ouigo', 'blablacar', 'itv', 'taller', 'norauto', 'midas', 'feu vert', 'crtm', 'abono transporte', 'tarjeta transporte', 'bicing', 'valenbisi', 'lime', 'cooltra'] },
  { id: 'suscripciones', name: 'Suscripciones', kind: 'gasto', kw: ['netflix', 'spotify', 'hbo', 'max com', 'disney', 'disney plus', 'prime video', 'amazon prime', 'apple com', 'apple com bill', 'itunes', 'google play', 'google one', 'google storage', 'youtube', 'youtube premium', 'dazn', 'icloud', 'openai', 'chatgpt', 'claude ai', 'anthropic', 'filmin', 'audible', 'adobe', 'microsoft', 'playstation', 'xbox', 'nintendo', 'steam', 'patreon', 'twitch', 'movistar plus', 'atresplayer', 'skyshowtime', 'crunchyroll', 'dropbox', 'notion', 'github', 'canva', 'duolingo', 'strava', 'kindle unlimited', 'google'] },
  { id: 'compras', name: 'Compras y ropa', kind: 'gasto', kw: ['amazon', 'amzn', 'amzn mktp', 'amazon es', 'zara', 'zara home', 'el corte ingles', 'corte ingles', 'primark', 'mango', 'h m', 'pull bear', 'bershka', 'stradivarius', 'massimo dutti', 'oysho', 'decathlon', 'ikea', 'mediamarkt', 'media markt', 'aliexpress', 'shein', 'fnac', 'leroy merlin', 'pccomponentes', 'apple store', 'temu', 'wallapop', 'vinted', 'sprinter', 'jd sports', 'druni', 'primor', 'sephora', 'kiabi', 'lefties', 'worten', 'bricomart', 'tiger', 'action', 'miniso', 'carrefour online', 'el ganso', 'uniqlo', 'nike', 'adidas', 'zalando', 'ebay'] },
  { id: 'salud', name: 'Salud', kind: 'gasto', kw: ['farmacia', 'parafarmacia', 'clinica', 'clinica dental', 'dentista', 'dental', 'hospital', 'optica', 'opticalia', 'multiopticas', 'general optica', 'fisio', 'fisioterapia', 'sanitas', 'adeslas', 'asisa', 'dkv', 'medico', 'quiron', 'quironsalud', 'vithas', 'hm hospitales', 'veterinario', 'veterinaria', 'psicologo', 'podologo', 'laboratorio'] },
  { id: 'ocio', name: 'Ocio y deporte', kind: 'gasto', kw: ['gimnasio', 'gym', 'basic fit', 'mcfit', 'holmes place', 'altafit', 'vivagym', 'viva gym', 'synergym', 'anytime fitness', 'go fit', 'padel', 'playtomic', 'cine', 'cines', 'yelmo', 'cinesa', 'kinepolis', 'ocine', 'teatro', 'ticketmaster', 'entradas', 'eventbrite', 'museo', 'fever', 'concierto', 'loteria', 'apuestas', 'bowling', 'parque'] },
  { id: 'viajes', name: 'Viajes', kind: 'gasto', kw: ['booking', 'booking com', 'airbnb', 'ryanair', 'vueling', 'iberia', 'iberia express', 'air europa', 'easyjet', 'volotea', 'binter', 'air nostrum', 'wizz air', 'transavia', 'lufthansa', 'klm', 'air france', 'british airways', 'hotel', 'hoteles', 'nh hoteles', 'nh hotel', 'melia', 'barcelo', 'iberostar', 'riu', 'parador', 'paradores', 'hostal', 'hostel', 'expedia', 'edreams', 'lastminute', 'trivago', 'rumbo', 'logitravel', 'aena', 'aeropuerto', 'europcar', 'hertz', 'sixt', 'avis', 'goldcar', 'centauro', 'enterprise rent'] },
  { id: 'seguros', name: 'Seguros', kind: 'gasto', kw: ['mapfre', 'axa', 'allianz', 'mutua', 'mutua madrilena', 'linea directa', 'generali', 'zurich', 'reale', 'santalucia', 'ocaso', 'verti', 'caser', 'catalana occidente', 'pelayo', 'mutua levante', 'occident', 'helvetia', 'liberty', 'aseguradora', 'seguro', 'seguros'] },
  { id: 'educacion', name: 'Educación', kind: 'gasto', kw: ['colegio', 'escuela', 'universidad', 'academia', 'udemy', 'coursera', 'matricula', 'libreria', 'guarderia', 'casa del libro', 'escuela infantil', 'autoescuela'] },
  { id: 'donaciones', name: 'Donaciones', kind: 'gasto', kw: ['donativo', 'donativos', 'donacion', 'donaciones', 'donacion ong', 'ong', 'cuota socio', 'cuota de socio', 'cuota socia', 'apadrinamiento', 'apadrina', 'caritas', 'cruz roja', 'unicef', 'medicos sin fronteras', 'msf', 'save the children', 'oxfam', 'oxfam intermon', 'intermon', 'acnur', 'acnur comite', 'greenpeace', 'wwf', 'amnistia internacional', 'manos unidas', 'aldeas infantiles', 'ayuda en accion', 'accion contra el hambre', 'plan international', 'world vision', 'educo', 'entreculturas', 'open arms', 'proactiva open arms', 'banco de alimentos', 'fesbal', 'fundacion vicente ferrer', 'vicente ferrer', 'fundacion josep carreras', 'josep carreras', 'aecc', 'contra el cancer', 'mensajeros de la paz', 'proyecto hombre', 'anesvad', 'farmaceuticos mundi', 'farmamundi', 'medicus mundi', 'acnur espana', 'ayuda a la iglesia necesitada', 'unrwa', 'sos racismo', 'teaming', 'gofundme', 'migranodearena', 'mi grano de arena', 'hazloposible', 'limosna', 'ofrenda', 'parroquia', 'fundacion'] },
  { id: 'efectivo', name: 'Retiradas de efectivo', kind: 'gasto', kw: ['cajero', 'retirada', 'reintegro', 'disposicion efectivo', 'disp efectivo', 'atm', 'retirada efectivo', 'bargeldauszahlung', 'cash withdrawal'] },
  { id: 'impuestos', name: 'Impuestos y comisiones', kind: 'gasto', kw: ['comision', 'comisiones', 'aeat', 'hacienda', 'agencia tributaria', 'impuesto', 'seguridad social', 'tgss', 'dgt', 'multa', 'cuota mantenimiento', 'intereses deudores', 'tasa', 'ayuntamiento'] },
  { id: 'tarjeta', name: 'Pago de la tarjeta de crédito', kind: 'gasto', kw: ['liquidacion tarjeta', 'pago tarjeta credito', 'cargo tarjeta credito', 'recibo tarjeta', 'liquidacion de tarjeta', 'tarjeta credito', 'bankinter consumer finance', 'bankintercard', 'tarjeta air europa', 'wizink', 'cetelem', 'cofidis', 'oney'] },
  { id: 'transf_env', name: 'Bizum y transferencias enviadas', kind: 'gasto', kw: ['bizum', 'bizum enviado', 'transferencia', 'transferencia emitida', 'transferencia enviada', 'transf emitida', 'transf', 'trf', 'orden de transferencia'] },
  { id: 'otros_g', name: 'Otros gastos', kind: 'gasto', kw: [] },
  { id: 'nomina', name: 'Nómina', kind: 'ingreso', kw: ['nomina', 'salario', 'sueldo', 'payroll', 'haberes', 'paga extra'] },
  { id: 'prestaciones', name: 'Pensiones y prestaciones', kind: 'ingreso', kw: ['pension', 'prestacion', 'sepe', 'inss', 'desempleo', 'subsidio', 'ayuda'] },
  { id: 'devoluciones', name: 'Devoluciones', kind: 'ingreso', kw: ['devolucion', 'devolucion compra', 'reembolso', 'refund', 'cashback', 'anulacion', 'abono compra', 'devolucion recibo'] },
  { id: 'intereses', name: 'Intereses y rendimientos', kind: 'ingreso', kw: ['intereses', 'intereses a su favor', 'interes', 'interest', 'interest payment', 'zinsen', 'dividendo', 'dividendos', 'dividend', 'rendimiento', 'remuneracion', 'saveback bonus'] },
  { id: 'transf_rec', name: 'Bizum y transferencias recibidas', kind: 'ingreso', kw: ['bizum', 'bizum recibido', 'transferencia', 'transferencia recibida', 'transf recibida', 'transf', 'trf', 'abono'] },
  { id: 'otros_i', name: 'Otros ingresos', kind: 'ingreso', kw: [] },
  { id: 'inversion', name: 'Inversión', kind: 'inversion', kw: ['trade republic', 'traderepublic', 'renta 4', 'renta4', 'r4', 'indexa', 'indexa capital', 'myinvestor', 'degiro', 'interactive brokers', 'scalable capital', 'etoro', 'finizens', 'inbestme', 'openbank broker', 'broker', 'fondo de inversion', 'suscripcion fondo', 'suscripcion de fondo', 'suscripcion participaciones', 'reembolso fondo', 'reembolso de fondo', 'traspaso fondo', 'plan de pensiones', 'plan pensiones', 'aportacion plan', 'savings plan', 'savings plan execution', 'sparplan', 'buy trade', 'sell trade', 'kauf', 'verkauf', 'compra valores', 'venta valores', 'compra de valores', 'venta de valores', 'orden de compra', 'round up', 'saveback'] },
  { id: 'excluir', name: 'Traspasos entre mis cuentas', kind: 'excluir', kw: ['traspaso', 'traspasos', 'entre cuentas', 'cuenta ahorro', 'traspaso interno', 'transferencia interna', 'transferencia entre cuentas', 'traspaso propio', 'cuenta remunerada'] },
];

export const KIND_LABEL = { gasto: 'Gastos', ingreso: 'Ingresos', inversion: 'Inversión', excluir: 'No cuentan' };
export const KINDS = ['gasto', 'ingreso', 'inversion', 'excluir'];
export const OTHER = { gasto: 'otros_g', ingreso: 'otros_i' };

// Weak words: only used when nothing more specific matches, and the result goes to «Por revisar».
const GENERIC = new Set(['super', 'dia', 'mercado', 'horno', 'rest', 'energia', 'electricidad', 'agua', 'e s', 'metro', 'parque', 'action',
  'simply', 'charter', 'lupa', 'hiber', 'tasa', 'ayuntamiento', 'ayuda', 'abono', 'interes', 'seguro', 'seguros', 'google', 'mutua', 'reale',
  'avia', 'saba', 'lime', 'riu', 'avis', 'pans', 'udon', 'tapas', 'pizza', 'burger', 'wok', 'transf', 'trf', 'transferencia', 'broker', 'r4',
  'tarjeta credito', 'alimentacion', 'clinica', 'medico', 'liberty', 'occident', 'fundacion', 'parroquia']);
// How the money moved (Bizum, transfer): beaten by what it was for ("transferencia recibida nomina" is a salary).
const CHANNEL = new Set(['bizum', 'bizum enviado', 'bizum recibido', 'transferencia emitida', 'transferencia enviada', 'transf emitida',
  'transferencia recibida', 'transf recibida', 'orden de transferencia']);
// Energy companies that also run petrol stations: a direct debit is the electricity bill, a card payment is fuel.
const DUAL_ENERGY = new Set(['repsol', 'cepsa', 'moeve', 'galp', 'totalenergies', 'bp', 'shell', 'petronor']);
const DIRECT_DEBIT = /(^| )(recibo|recibos|adeudo|domiciliacion|domiciliado|cargo domiciliado)( |$)/;

const INDEX = DEFAULT_CATS.map((c, order) => ({ id: c.id, kind: c.kind, order, kw: c.kw.map(norm).filter(Boolean) }));

export const STOP = new Set(['compra', 'compras', 'tarj', 'tarjeta', 'pago', 'pagos', 'en', 'de', 'del', 'la', 'el', 'los', 'las', 'a', 'al', 'recibo', 'adeudo', 'cargo',
  'transferencia', 'transf', 'trf', 'bizum', 'favor', 'con', 'num', 'n', 'card', 'purchase', 'apple', 'pay', 'contactless', 'visa', 'mastercard', 'debito', 'credito',
  'fecha', 'operacion', 'op', 'com', 'es', 'www', 'sl', 'sa', 's', 'l', 'y', 'por', 'internet', 'movil', 'enviada', 'recibida', 'emitida', 'domiciliacion', 'domiciliado',
  'cta', 'cuenta', 'ref', 'referencia', 'concepto', 'abono', 'sumup', 'zettle', 'paypal', 'stripe', 'izettle', 'sumup', 'payment', 'transaction', 'kartenzahlung', 'sl', 'slu']);

export function suggestKw(concept) {
  const words = norm(concept).split(' ').filter((x) => x.length > 1 && !STOP.has(x) && !/\d/.test(x));
  return words.slice(0, 2).join(' ') || norm(concept).split(' ').slice(0, 3).join(' ');
}

// Merchant category codes (ISO 18245) for card payments.
const MCC_RANGES = [
  [3000, 3350, 'viajes'], [3351, 3500, 'viajes'], [3501, 3999, 'viajes'], [4011, 4011, 'transporte'], [4111, 4131, 'transporte'], [4214, 4214, 'compras'],
  [4411, 4411, 'viajes'], [4457, 4468, 'ocio'], [4511, 4511, 'viajes'], [4582, 4582, 'viajes'], [4722, 4722, 'viajes'], [4784, 4784, 'transporte'],
  [4789, 4789, 'transporte'], [4812, 4816, 'suministros'], [4899, 4900, 'suministros'], [5200, 5399, 'compras'], [5411, 5411, 'supermercado'],
  [5422, 5499, 'supermercado'], [5511, 5599, 'transporte'], [5541, 5542, 'transporte'], [5600, 5699, 'compras'], [5712, 5735, 'compras'],
  [5811, 5814, 'restaurantes'], [5815, 5818, 'suscripciones'], [5912, 5912, 'salud'], [5921, 5921, 'supermercado'], [5931, 5999, 'compras'],
  [5960, 5960, 'seguros'], [5968, 5968, 'suscripciones'], [5975, 5976, 'salud'], [6010, 6011, 'efectivo'], [6300, 6399, 'seguros'],
  [7011, 7011, 'viajes'], [7512, 7519, 'viajes'], [7523, 7523, 'transporte'], [7531, 7549, 'transporte'], [7829, 7833, 'ocio'],
  [7911, 7999, 'ocio'], [8011, 8099, 'salud'], [8211, 8299, 'educacion'], [9211, 9399, 'impuestos'], [742, 742, 'salud'], [8398, 8398, 'donaciones'], [8661, 8661, 'donaciones'],
];
export function mccCategory(mcc) {
  const n = parseInt(mcc, 10);
  if (!isFinite(n)) return null;
  if (n === 5541 || n === 5542) return 'transporte';
  for (const [a, b, cat] of MCC_RANGES) if (n >= a && n <= b) return cat;
  return null;
}

// Best keyword among the default categories allowed for the amount's sign.
// Tiers: 2 = what it was (merchant or purpose), 1 = how it moved (Bizum, transfer), 0 = weak word.
export function keywordMatch(n, amount) {
  const sign = amount < 0 ? 'gasto' : 'ingreso';
  let best = null;
  for (const c of INDEX) {
    if (c.kind !== sign && c.kind !== 'inversion' && c.kind !== 'excluir') continue;
    for (const kw of c.kw) {
      if (!wordMatch(n, kw)) continue;
      const tier = GENERIC.has(kw) ? 0 : CHANNEL.has(kw) ? 1 : 2;
      const better = !best || tier > best.tier || (tier === best.tier && (kw.length > best.kw.length || (kw.length === best.kw.length && c.order < best.order)));
      if (better) best = { cat: c.id, kw, tier, generic: tier === 0, order: c.order };
    }
  }
  if (best && best.cat === 'transporte' && DUAL_ENERGY.has(best.kw) && DIRECT_DEBIT.test(n)) best.cat = 'suministros';
  return best;
}

export function ruleMatches(r, n, t) {
  if (!r.kw || !wordMatch(n, r.kw)) return false;
  const a = Math.abs(t.amount);
  if (r.sign && (r.sign === 'gasto') !== (t.amount < 0)) return false;
  if (r.min != null && a < r.min) return false;
  if (r.max != null && a > r.max) return false;
  if (r.acct && r.acct !== t.acct) return false;
  return true;
}

// t: {concept, amount, mcc?, acct?}; ctx: {cats, rules} -> {cat, conf: 'rule'|'kw'|'mcc'|'generic'|'none', kw?}
export function categorize(t, ctx) {
  const n = norm(t.concept);
  const rules = (ctx && ctx.rules) || [], cats = (ctx && ctx.cats) || DEFAULT_CATS;
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (ruleMatches(r, n, t) && cats.some((c) => c.id === r.cat)) return { cat: r.cat, conf: 'rule', kw: r.kw };
  }
  const k = keywordMatch(n, t.amount);
  if (k && k.tier === 2) return { cat: k.cat, conf: 'kw', kw: k.kw };
  if (t.amount < 0 && t.mcc) { const m = mccCategory(t.mcc); if (m) return { cat: m, conf: 'mcc' }; }
  if (k) return { cat: k.cat, conf: k.tier === 1 ? 'kw' : 'generic', kw: k.kw };
  return { cat: t.amount < 0 ? 'otros_g' : 'otros_i', conf: 'none' };
}

// The default keywords of a category that name what it was (not weak words, not Bizum or transfers).
export const strongKw = (id) => kwOf(id).filter((k) => !GENERIC.has(k) && !CHANNEL.has(k));
export const defaultCatsLite = () => DEFAULT_CATS.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
export const kwOf = (id) => { const c = INDEX.find((x) => x.id === id); return c ? c.kw : []; };
