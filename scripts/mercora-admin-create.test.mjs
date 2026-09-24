import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapMarkerPath,
  databaseStateDir,
  hashOwnerBootstrapToken,
  normalizeUsername,
  verifyOwnerBootstrapToken,
} from './mercora-admin-create.mjs';

test('owner bootstrap token verification is exact and constant-time comparable', () => {
  const token = 'MERCORA-owner-token-' + 'x'.repeat(40);
  const digest = hashOwnerBootstrapToken(token);

  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(verifyOwnerBootstrapToken(token, digest), true);
  assert.equal(verifyOwnerBootstrapToken(token + 'x', digest), false);
  assert.equal(verifyOwnerBootstrapToken('short', digest), false);
  assert.equal(verifyOwnerBootstrapToken(token, '00'.repeat(31)), false);
});

test('username normalization rejects unsafe identifiers', () => {
  assert.equal(normalizeUsername('Fran_80'), 'fran_80');
  assert.equal(normalizeUsername('Fran.Admin'), 'fran.admin');
  assert.throws(() => normalizeUsername('ab'), /3-64/);
  assert.throws(() => normalizeUsername('bad space'), /3-64/);
  assert.throws(() => normalizeUsername('bad/slash'), /3-64/);
});

test('bootstrap state remains inside the authentication state directory', () => {
  const databasePath = 'C:\\MERCORA\\Admin\\admin-auth.db';
  assert.equal(databaseStateDir(databasePath), 'C:\\MERCORA\\Admin');
  assert.equal(bootstrapMarkerPath(databasePath), 'C:\\MERCORA\\Admin\\owner-bootstrap-used');
});
