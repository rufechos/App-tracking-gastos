import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, seal, unseal, checkBlob, newSalt, passProblem, sameKey, b64u, unb64u, VAULT_APP, ITER } from '../../js/vault.js';

const copy = { app: 'cuaderno-gastos', format: 1, state: { tx: Array.from({ length: 3000 }, (_, i) => ({ id: 't' + i, date: '2026-10-01', concept: 'COMPRA TARJ. 4512 MERCADONA VALENCIA', amount: -(i + 1) })) } };

test('copia cifrada: se abre con la misma frase, también en otro dispositivo, y no con otra', async () => {
  const k = await deriveKey('tres palabras raras', newSalt());
  assert.equal(k.iter, ITER);
  const blob = await seal(copy, k, new Date('2026-10-27T09:00:00Z'));
  assert.equal(blob.app, VAULT_APP);
  assert.equal(blob.at, '2026-10-27T09:00:00.000Z');
  assert.equal(blob.zip, 'gzip');
  // What the server checks before keeping it (servidor/worker.js)
  assert.ok([blob.data, blob.iv, blob.salt].every((v) => /^[\w-]+$/.test(v)));
  assert.ok(JSON.stringify(blob).length < JSON.stringify(copy).length / 3, 'compressed before encrypting');
  assert.ok(!JSON.stringify(blob).includes('MERCADONA'));

  assert.deepEqual(await unseal(blob, k), copy);
  // Another iPhone: only the passphrase, with the salt and rounds that travel with the copy
  const again = await deriveKey('tres palabras raras', blob.salt, blob.iter);
  assert.ok(sameKey(again, blob));
  assert.deepEqual(await unseal(blob, again), copy);

  await assert.rejects(unseal(blob, await deriveKey('tres palabras raraS', blob.salt, blob.iter)), { code: 'WRONG_PASS' });
  // A changed byte is noticed
  const bytes = unb64u(blob.data);
  bytes[20] ^= 1;
  await assert.rejects(unseal({ ...blob, data: b64u(bytes) }, k), { code: 'WRONG_PASS' });
  // Each copy has its own IV
  assert.notEqual((await seal(copy, k)).iv, blob.iv);
});

test('copia cifrada: formato, frases demasiado cortas y base64url', () => {
  assert.throws(() => checkBlob({ app: 'cuaderno-gastos', data: 'a', iv: 'b', salt: 'c', iter: ITER }), { code: 'FORMAT' });
  assert.throws(() => checkBlob({ app: VAULT_APP, v: 2, data: 'a', iv: 'b', salt: 'c', iter: ITER }), { code: 'VERSION' });
  assert.throws(() => checkBlob({ app: VAULT_APP, v: 1, data: 'a', iv: 'b', salt: 'c', iter: 1e9 }), { code: 'FORMAT' }); // would freeze the phone
  assert.equal(passProblem('corta'), 'Usa al menos 10 caracteres; mejor tres o cuatro palabras que no tengan que ver entre sí.');
  assert.equal(passProblem('una frase larga', 'una frase larga.'), 'Las dos frases no coinciden.');
  assert.equal(passProblem('una frase larga', 'una frase larga'), null);
  const big = new Uint8Array(100001).map((_, i) => (i * 7) & 255);
  assert.deepEqual(unb64u(b64u(big)), big);
  assert.match(b64u(big), /^[\w-]+$/);
});
