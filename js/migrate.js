// Upgrading data saved by the first versions of the app (a single file, no format version).
// Their categorisation is replayed so that categories you set by hand are kept as manual choices.
import { norm, wordMatch } from './util.js';

const V1 = {
  vivienda: ['alquiler', 'hipoteca', 'comunidad de propietarios', 'comunidad prop', 'cuota comunidad', 'ibi', 'prestamo hipotecario'],
  suministros: ['iberdrola', 'endesa', 'naturgy', 'holaluz', 'totalenergies', 'canal de isabel', 'aguas de', 'aigues', 'emasesa', 'gas natural', 'movistar', 'vodafone', 'orange', 'digi', 'jazztel', 'masmovil', 'pepephone', 'lowi', 'yoigo', 'simyo', 'finetwork', 'o2', 'energia', 'electricidad'],
  supermercado: ['mercadona', 'carrefour', 'lidl', 'aldi', 'dia', 'eroski', 'alcampo', 'consum', 'hipercor', 'supercor', 'bonpreu', 'bonarea', 'ahorramas', 'caprabo', 'gadis', 'froiz', 'supermercado', 'super', 'spar', 'condis', 'coviran', 'family cash', 'el arbol', 'hiperber', 'masymas', 'frutas', 'fruteria', 'carniceria', 'panaderia'],
  restaurantes: ['restaurante', 'rest', 'bar', 'cafeteria', 'cafe', 'glovo', 'just eat', 'uber eats', 'deliveroo', 'telepizza', 'dominos', 'mcdonalds', 'mcdonald s', 'burger king', 'kfc', 'starbucks', 'taberna', 'pizzeria', 'cerveceria', 'vips', 'goiko', '100 montaditos', 'tgb', 'five guys', 'rodilla', 'foster s', 'tagliatella', 'sushi'],
  transporte: ['repsol', 'cepsa', 'bp', 'galp', 'shell', 'ballenoil', 'plenoil', 'petronor', 'gasolinera', 'estacion de servicio', 'e s', 'renfe', 'metro', 'emt', 'tmb', 'alsa', 'avanza', 'uber', 'cabify', 'bolt', 'free now', 'taxi', 'parking', 'aparcamiento', 'empark', 'telpark', 'autopista', 'peaje', 'via t', 'iryo', 'ouigo', 'blablacar', 'itv', 'taller', 'norauto', 'midas', 'crtm', 'abono transporte', 'tarjeta transporte'],
  suscripciones: ['netflix', 'spotify', 'hbo', 'max com', 'disney', 'prime video', 'amazon prime', 'apple com', 'itunes', 'google', 'youtube', 'dazn', 'icloud', 'openai', 'chatgpt', 'filmin', 'audible', 'adobe', 'microsoft', 'playstation', 'xbox', 'nintendo', 'steam', 'patreon', 'twitch'],
  compras: ['amazon', 'amzn', 'zara', 'el corte ingles', 'corte ingles', 'primark', 'mango', 'h m', 'pull bear', 'bershka', 'stradivarius', 'decathlon', 'ikea', 'mediamarkt', 'media markt', 'aliexpress', 'shein', 'fnac', 'leroy merlin', 'pccomponentes', 'apple store', 'temu', 'wallapop', 'vinted', 'sprinter', 'jd sports', 'druni', 'primor', 'sephora', 'kiabi', 'lefties', 'worten', 'bricomart', 'tiger'],
  salud: ['farmacia', 'parafarmacia', 'clinica', 'dentista', 'dental', 'hospital', 'optica', 'opticalia', 'multiopticas', 'fisio', 'fisioterapia', 'sanitas', 'adeslas', 'asisa', 'dkv', 'medico', 'quiron', 'vithas', 'veterinario', 'veterinaria'],
  ocio: ['gimnasio', 'gym', 'basic fit', 'mcfit', 'holmes place', 'altafit', 'vivagym', 'viva gym', 'synergym', 'anytime fitness', 'padel', 'cine', 'cines', 'yelmo', 'cinesa', 'kinepolis', 'teatro', 'ticketmaster', 'entradas', 'eventbrite', 'museo', 'fever', 'concierto'],
  viajes: ['booking', 'airbnb', 'ryanair', 'vueling', 'iberia', 'air europa', 'easyjet', 'volotea', 'hotel', 'hostal', 'expedia', 'edreams', 'trivago', 'rumbo', 'aena', 'aeropuerto'],
  seguros: ['seguro', 'seguros', 'mapfre', 'axa', 'allianz', 'mutua', 'linea directa', 'generali', 'zurich', 'reale', 'santalucia', 'ocaso', 'verti', 'caser', 'catalana occidente', 'pelayo'],
  educacion: ['colegio', 'escuela', 'universidad', 'academia', 'udemy', 'coursera', 'matricula', 'libreria', 'guarderia', 'casa del libro'],
  efectivo: ['cajero', 'retirada', 'reintegro', 'disposicion efectivo', 'disp efectivo', 'atm'],
  impuestos: ['comision', 'comisiones', 'aeat', 'hacienda', 'agencia tributaria', 'impuesto', 'tasa', 'ayuntamiento', 'seguridad social', 'tgss', 'dgt', 'multa', 'cuota mantenimiento', 'intereses deudores'],
  transf_env: ['bizum', 'transferencia', 'transf', 'trf'],
  otros_g: [],
  nomina: ['nomina', 'salario', 'sueldo', 'payroll', 'haberes'],
  prestaciones: ['pension', 'prestacion', 'sepe', 'inss', 'desempleo', 'subsidio', 'ayuda'],
  devoluciones: ['devolucion', 'reembolso', 'refund', 'cashback', 'anulacion'],
  intereses: ['intereses', 'interes', 'dividendo', 'dividendos', 'rendimiento', 'remuneracion'],
  transf_rec: ['bizum', 'transferencia', 'transf', 'trf', 'abono'],
  otros_i: [],
};
const V1_INV = ['trade republic', 'traderepublic', 'renta 4', 'renta4', 'r4', 'indexa', 'myinvestor', 'degiro', 'interactive brokers', 'scalable capital', 'etoro', 'finizens', 'inbestme', 'broker', 'fondo de inversion', 'suscripcion fondo', 'reembolso fondo', 'plan de pensiones', 'plan pensiones'];
const V1_EXCL = ['traspaso', 'traspasos', 'entre cuentas', 'cuenta ahorro', 'liquidacion tarjeta', 'pago tarjeta credito', 'cargo tarjeta credito'];
const EXP = ['vivienda', 'suministros', 'supermercado', 'restaurantes', 'transporte', 'suscripciones', 'compras', 'salud', 'ocio', 'viajes', 'seguros', 'educacion', 'efectivo', 'impuestos', 'transf_env', 'otros_g'];
const INC = ['nomina', 'prestaciones', 'devoluciones', 'intereses', 'transf_rec', 'otros_i'];

// What the old app would have chosen by itself (withInvestment: the version with the "Inversión" category).
export function legacyCategory(t, rules, cats, withInvestment) {
  const n = norm(t.concept);
  for (let i = rules.length - 1; i >= 0; i--) { const r = rules[i]; if (wordMatch(n, r.kw) && cats.some((c) => c.id === r.cat)) return r.cat; }
  const lists = (withInvestment ? [['inversion', V1_INV]] : []).concat([['excluir', V1_EXCL]], (t.amount < 0 ? EXP : INC).map((id) => [id, V1[id]]));
  for (const [id, kws] of lists) if (kws.some((k) => wordMatch(n, k))) return id;
  return t.amount < 0 ? 'otros_g' : 'otros_i';
}

export function migrateV1(s) {
  const rules = s.rules || [], cats = s.cats || [];
  for (const t of s.tx) {
    if (t.manual != null) continue;
    const a = legacyCategory(t, rules, cats, false), b = legacyCategory(t, rules, cats, true);
    if (t.cat !== a && t.cat !== b) t.manual = true;
  }
  return s;
}
