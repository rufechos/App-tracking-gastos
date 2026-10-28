// Lock with Face ID (or Touch ID, or the device's code): a passkey of this device whose only use is opening the app.
// It keeps others out if they pick up your unlocked iPhone; it does not encrypt your data on the device.
import { b64u, unb64u } from './vault.js';

export const LOCK_KEY = 'cuaderno-gastos-bloqueo';
export const RELOCK = 60e3; // back to the app after this long away: Face ID again (unless chosen in Ajustes)
export const RELOCK_CHOICES = [1, 5, 15, 60]; // minutes
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 letters and digits, without 0/O and 1/I

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export function lockConf() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || null; } catch (e) { return null; }
}
const store = (c) => { if (c) localStorage.setItem(LOCK_KEY, JSON.stringify(c)); else localStorage.removeItem(LOCK_KEY); };

export async function lockAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
}

// 12 characters (60 bits) in three groups, for when Face ID stops working.
export function newCode() {
  const s = [...rand(12)].map((x) => ALPHABET[x % 32]).join('');
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
}
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function codeHash(code, salt) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + cleanCode(code)))));
}
async function withCode(c) {
  const code = newCode(), salt = b64u(rand(16));
  return [{ ...c, salt, code: await codeHash(code, salt) }, code];
}

// The authenticator saw you (presence) and checked it was you (Face ID or the code): flags UP and UV.
const verified = (authData) => { const b = new Uint8Array(authData || new ArrayBuffer(0)); return b.length > 32 && (b[32] & 0x05) === 0x05; };

// Face ID creates the passkey. -> the recovery code, to show once.
export async function enableLock() {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Cuaderno de gastos' },
    user: { id: rand(16), name: 'Cuaderno de gastos', displayName: 'Cuaderno de gastos' },
    challenge: rand(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000,
    attestation: 'none',
  } });
  if (!cred) throw new Error('No se ha creado la llave.');
  const data = cred.response.getAuthenticatorData ? cred.response.getAuthenticatorData() : null;
  if (data && !verified(data)) throw new Error('El dispositivo no ha comprobado que eras tú.');
  const [c, code] = await withCode({ on: true, ids: [b64u(new Uint8Array(cred.rawId))], at: new Date().toISOString() });
  store(c);
  return code;
}

export async function renewCode() {
  const [c, code] = await withCode(lockConf());
  store(c);
  return code;
}

export function disableLock() { store(null); }

export const relockMs = () => { const c = lockConf(); return (c && c.relock) || RELOCK; };
export function setRelock(minutes) {
  const c = lockConf();
  if (c && RELOCK_CHOICES.includes(minutes)) store({ ...c, relock: minutes * 60e3 });
}

// -> true when Face ID (or the device's code) said it was you.
export async function verify() {
  const c = lockConf();
  if (!c || !c.on) return true;
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rand(32),
    allowCredentials: c.ids.map((id) => ({ type: 'public-key', id: unb64u(id), transports: ['internal'] })),
    userVerification: 'required',
    timeout: 60000,
  } });
  return !!a && c.ids.includes(b64u(new Uint8Array(a.rawId))) && verified(a.response.authenticatorData);
}

export async function checkCode(code) {
  const c = lockConf();
  return !!(c && c.code && cleanCode(code).length === 12 && (await codeHash(code, c.salt)) === c.code);
}
