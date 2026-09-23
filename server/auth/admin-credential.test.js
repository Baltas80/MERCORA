import test from 'node:test';
import assert from 'node:assert/strict';
import { auth } from './better-auth.js';

test('admin authentication is provided by Better Auth, not the removed legacy credential module', () => {
  assert.equal(typeof auth.handler, 'function');
  assert.equal(typeof auth.api.getSession, 'function');
  assert.equal(typeof auth.api.signOut, 'function');
});
