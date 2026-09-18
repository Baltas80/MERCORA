import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 32_768;
const r = 8;
const p = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("Password must contain 12-256 characters.");
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(Buffer.from(password, "utf8"), salt);

  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;

  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [algorithm, encodedN, encodedR, encodedP, saltText, hashText] = parts;
  const parsedN = Number(encodedN);
  const parsedR = Number(encodedR);
  const parsedP = Number(encodedP);

  if (algorithm !== "scrypt" || parsedN !== N || parsedR !== r || parsedP !== p) return false;

  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    if (salt.length !== SALT_BYTES || expected.length !== KEYLEN) return false;

    const actual = await scryptAsync(Buffer.from(password, "utf8"), salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
