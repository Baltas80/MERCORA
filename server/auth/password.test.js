import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.js";

test("hashPassword creates a non-reversible encoded verifier", async () => {
  const password = "correct horse battery staple 2026";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
});

test("identical passwords receive different salts", async () => {
  const password = "another strong password 2026";
  const a = await hashPassword(password);
  const b = await hashPassword(password);

  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword(password, b), true);
});

test("weak passwords are rejected", async () => {
  await assert.rejects(() => hashPassword("short"), /12-256/);
});
