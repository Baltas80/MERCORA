import crypto from 'node:crypto';

const HASH_PREFIX = 'scrypt$1$';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

export function isValidAdminUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9._-]{3,64}$/.test(username);
}

export function hashAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Admin password must be 12-256 characters.');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `${HASH_PREFIX}${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyAdminPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 4 || `${parts[0]}$${parts[1]}$` !== HASH_PREFIX) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[2], 'base64url');
    expected = Buffer.from(parts[3], 'base64url');
  } catch { return false; }
  if (salt.length !== SALT_BYTES || expected.length !== KEYLEN) return false;
  try {
    const actual = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function createAdminSession() {
  return crypto.randomBytes(32).toString('base64url');
}
