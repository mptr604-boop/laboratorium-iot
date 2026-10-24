// src/utils/password.js
// Hasła: scrypt (wbudowane w node:crypto, celowo wolne i pamięciożerne) + losowa sól per użytkownik.
// Opcjonalny klucz serwera PASSWORD_PEPPER (poza bazą) wchodzi przez HMAC: sama kradzież bazy nie wystarcza do łamania haseł.
// Format: scrypt$<N>$<r>$<p>$<peppered 0|1>$<sól base64url>$<hash base64url>
import crypto from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const LEGACY_SHA256 = /^[0-9a-f]{64}$/;

function pepperKey() {
  return process.env.PASSWORD_PEPPER || null;
}

function prepare(password, peppered) {
  const text = String(password ?? '');
  if (!peppered) return text;
  return crypto.createHmac('sha256', pepperKey()).update(text).digest();
}

function derive(password, salt, peppered) {
  return crypto.scryptSync(prepare(password, peppered), salt, KEY_LENGTH, { N, r: R, p: P });
}

export function hashPassword(password) {
  const peppered = pepperKey() ? 1 : 0;
  const salt = crypto.randomBytes(16);
  const hash = derive(password, salt, peppered);
  return ['scrypt', N, R, P, peppered, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// needsRehash: stary hash SHA-256 bez soli albo hash zrobiony bez pepper, gdy pepper jest już ustawiony.
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return { ok: false, needsRehash: false };

  if (LEGACY_SHA256.test(stored)) {
    const candidate = crypto.createHash('sha256').update(String(password ?? '')).digest();
    return { ok: safeEqual(candidate, Buffer.from(stored, 'hex')), needsRehash: true };
  }

  const [scheme, n, r, p, peppered, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !hash || (peppered === '1' && !pepperKey())) return { ok: false, needsRehash: false };
  const expected = Buffer.from(hash, 'base64url');
  const actual = crypto.scryptSync(prepare(password, peppered === '1'), Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  const ok = safeEqual(actual, expected);
  return { ok, needsRehash: ok && (Number(n) !== N || (peppered !== '1' && Boolean(pepperKey()))) };
}
