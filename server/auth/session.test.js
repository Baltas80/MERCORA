import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, hashSessionToken, sessionCookie } from "./session.js";

test("session tokens are random and hashable", () => {
  const a = createSessionToken();
  const b = createSessionToken();
  assert.notEqual(a, b);
  assert.equal(hashSessionToken(a).length, 64);
  assert.notEqual(hashSessionToken(a), a);
});

test("session cookie uses hardened browser attributes", () => {
  const cookie = sessionCookie("test-token-that-is-long-enough-1234567890");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});
