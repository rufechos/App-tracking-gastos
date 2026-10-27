// Encrypted copy on your own server: the server keeps something it cannot read.
// The key comes from a passphrase only you know (PBKDF2-SHA256, 600 000 rounds) and encrypts with AES-GCM 256;
// what is encrypted is the same copy as «Exportar copia», compressed first.
export const VAULT_APP = 'cuaderno-gastos-cifrada';
export const ITER = 600000;
export const MIN_PASS = 10;
const AAD = new TextEncoder().encode(VAULT_APP + '/1');

export class VaultError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export const newSalt = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

export function passProblem(pass, again) {
  if (pass.length < MIN_PASS) return `Usa al menos ${MIN_PASS} caracteres; mejor tres o cuatro palabras que no tengan que ver entre sí.`;
  if (again != null && pass !== again) return 'Las dos frases no coinciden.';
  return null;
}

// -> {key, salt, iter}. The key cannot be read back, but it can be kept on this device to save copies without asking.
export async function deriveKey(pass, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(salt), iterations: iter }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, salt, iter };
}

export async function seal(obj, k, now = new Date()) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), zip = canZip();
  let data = new TextEncoder().encode(JSON.stringify(obj));
  if (zip) data = await pipe(data, new CompressionStream('gzip'));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, k.key, data));
  return { app: VAULT_APP, v: 1, iter: k.iter, salt: k.salt, iv: b64u(iv), zip: zip ? 'gzip' : '', data: b64u(ct), at: now.toISOString() };
}

export function checkBlob(b) {
  if (!b || b.app !== VAULT_APP || ![b.data, b.iv, b.salt].every((v) => typeof v === 'string' && /^[\w-]+$/.test(v))) {
    throw new VaultError('Lo que hay en el servidor no es una copia cifrada del Cuaderno de gastos.', 'FORMAT');
  }
  if (b.v > 1) throw new VaultError('La copia es de una versión más nueva de la app. Actualízala y vuelve a intentarlo.', 'VERSION');
  if (!(Number.isInteger(b.iter) && b.iter >= 100000 && b.iter <= 5000000)) throw new VaultError('La copia del servidor no es válida.', 'FORMAT');
  return b;
}

// k: from deriveKey with the copy's salt and rounds.
export async function unseal(b, k) {
  checkBlob(b);
  let data;
  try {
    data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(b.iv), additionalData: AAD }, k.key, unb64u(b.data)));
  } catch (e) { throw new VaultError('La frase no es la correcta, o la copia está dañada.', 'WRONG_PASS'); }
  if (b.zip === 'gzip') data = await pipe(data, new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(data));
}

export const sameKey = (k, b) => !!k && k.salt === b.salt && k.iter === b.iter;
