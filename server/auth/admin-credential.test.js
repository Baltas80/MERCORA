import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimBootstrapToken, hashAdminToken, loadOrCreateAdminCredential } from './admin-credential.js';

test('generates a first-run admin credential without persisting the secret', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mercora-admin-'));
  const tokenFile = path.join(dir, 'admin-token.json');
  try {
    const first = await loadOrCreateAdminCredential({ tokenFile });
    assert.equal(first.source, 'generated');
    assert.equal(first.bootstrapPending, true);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);

    const raw = JSON.parse(await readFile(tokenFile, 'utf8'));
    assert.equal(raw.bootstrapPending, true);
    assert.equal(Object.hasOwn(raw, 'token'), false);
    assert.equal(Object.hasOwn(raw, 'tokenHash'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generates a new in-memory credential on restart while bootstrap is pending', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mercora-admin-'));
  const tokenFile = path.join(dir, 'admin-token.json');
  try {
    const first = await loadOrCreateAdminCredential({ tokenFile });
    const second = await loadOrCreateAdminCredential({ tokenFile });
    assert.equal(second.bootstrapPending, true);
    assert.match(second.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first.token, second.token);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('claims bootstrap once and persists only the token hash', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mercora-admin-'));
  const tokenFile = path.join(dir, 'admin-token.json');
  const token = 'x'.repeat(43);
  try {
    await loadOrCreateAdminCredential({ tokenFile });
    const claimed = await claimBootstrapToken(tokenFile, token);
    assert.equal(claimed, token);

    const raw = JSON.parse(await readFile(tokenFile, 'utf8'));
    assert.equal(raw.bootstrapPending, false);
    assert.equal(raw.tokenHash, hashAdminToken(token));
    assert.equal(Object.hasOwn(raw, 'token'), false);

    const loaded = await loadOrCreateAdminCredential({ tokenFile });
    assert.equal(loaded.bootstrapPending, false);
    assert.equal(loaded.token, null);
    assert.equal(loaded.tokenHash, hashAdminToken(token));

    await assert.rejects(() => claimBootstrapToken(tokenFile, token), /already been completed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit environment credentials disable bootstrap', async () => {
  const token = 'x'.repeat(32);
  const credential = await loadOrCreateAdminCredential({ token, tokenFile: path.join(os.tmpdir(), 'unused') });
  assert.equal(credential.source, 'environment');
  assert.equal(credential.bootstrapPending, false);
  assert.equal(credential.token, token);
  assert.equal(credential.tokenHash, hashAdminToken(token));
  assert.equal(credential.tokenFile, null);
});
