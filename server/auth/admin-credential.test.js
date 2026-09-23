import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimBootstrapToken, loadOrCreateAdminCredential } from './admin-credential.js';

test('generates a first-run admin credential outside the repository', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mercora-admin-'));
  const tokenFile = path.join(dir, 'admin-token.json');
  try {
    const first = await loadOrCreateAdminCredential({ tokenFile });
    assert.equal(first.source, 'generated');
    assert.equal(first.bootstrapPending, true);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);

    const raw = JSON.parse(await readFile(tokenFile, 'utf8'));
    assert.equal(raw.token, first.token);
    assert.equal(raw.bootstrapPending, true);

    const second = await loadOrCreateAdminCredential({ tokenFile });
    assert.equal(second.token, first.token);
    assert.equal(second.bootstrapPending, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('claims bootstrap exactly once and preserves the generated credential', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mercora-admin-'));
  const tokenFile = path.join(dir, 'admin-token.json');
  try {
    const first = await loadOrCreateAdminCredential({ tokenFile });
    const token = await claimBootstrapToken(tokenFile);
    assert.equal(token, first.token);

    await assert.rejects(() => claimBootstrapToken(tokenFile), /already been completed/);

    const loaded = await loadOrCreateAdminCredential({ tokenFile });
    assert.equal(loaded.token, token);
    assert.equal(loaded.bootstrapPending, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit environment credentials disable bootstrap', async () => {
  const credential = await loadOrCreateAdminCredential({ token: 'x'.repeat(32), tokenFile: path.join(os.tmpdir(), 'unused') });
  assert.equal(credential.source, 'environment');
  assert.equal(credential.bootstrapPending, false);
  assert.equal(credential.tokenFile, null);
});
