// src/test/password.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';

const withPepper = (value, fn) => {
  const previous = process.env.PASSWORD_PEPPER;
  if (value === null) delete process.env.PASSWORD_PEPPER; else process.env.PASSWORD_PEPPER = value;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.PASSWORD_PEPPER; else process.env.PASSWORD_PEPPER = previous;
  }
};

test('Password - correct passes, wrong fails, same password gets different hashes (salt)', () => {
  withPepper(null, () => {
    const a = hashPassword('tajne-haslo');
    const b = hashPassword('tajne-haslo');
    assert.notEqual(a, b);
    assert.match(a, /^scrypt\$/);
    assert.equal(verifyPassword('tajne-haslo', a).ok, true);
    assert.equal(verifyPassword('inne-haslo', a).ok, false);
    assert.equal(verifyPassword('tajne-haslo', a).needsRehash, false);
  });
});

test('Password - pepper: hash made with a key does not verify without it or with another key', () => {
  withPepper('dlugi-klucz-serwera-1', () => {
    const stored = hashPassword('haslo');
    assert.equal(verifyPassword('haslo', stored).ok, true);
    assert.ok(!stored.includes('dlugi-klucz'));
    withPepper('inny-klucz', () => assert.equal(verifyPassword('haslo', stored).ok, false));
    withPepper(null, () => assert.equal(verifyPassword('haslo', stored).ok, false));
  });
});

test('Password - legacy SHA-256 hash still verifies and is flagged for upgrade', () => {
  const legacy = crypto.createHash('sha256').update('stare-haslo').digest('hex');
  assert.deepEqual(verifyPassword('stare-haslo', legacy), { ok: true, needsRehash: true });
  assert.equal(verifyPassword('zle', legacy).ok, false);
});

test('Password - hash made before the pepper was set is flagged for upgrade', () => {
  const unpeppered = withPepper(null, () => hashPassword('haslo'));
  withPepper('nowy-klucz', () => {
    assert.deepEqual(verifyPassword('haslo', unpeppered), { ok: true, needsRehash: true });
  });
});

test('Password - garbage and missing stored values are rejected without throwing', () => {
  for (const bad of [undefined, null, '', 'x', 'scrypt$1', 'scrypt$16384$8$1$0$$']) {
    assert.equal(verifyPassword('haslo', bad).ok, false);
  }
});
