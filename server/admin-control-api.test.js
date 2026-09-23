import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashAdminToken } from './auth/admin-credential.js';
import { createAdminApi } from './admin-control-api.js';

const token = 'x'.repeat(32);

async function withApi(controller, fn, options = {}) {
  const api = createAdminApi({ token, controller, port: 0, ...options });
  await api.listen();
  const address = api.server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
  }
}

test('admin API rejects invalid credential hashes', () => {
  assert.throws(() => createAdminApi({ token: 'short' }), /credential hash/);
});

test('admin API requires bearer authentication', async () => {
  const controller = { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  });
});

test('admin API validates action and service before calling controller', async () => {
  let calls = 0;
  const controller = { run: async () => { calls += 1; return { ok: true }; }, healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const response = await fetch(`${base}/v1/control`, { method: 'POST', headers, body: JSON.stringify({ action: 'RESTART', service: 'nope' }) });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test('admin API authenticates against the persisted hash without a plaintext token', async () => {
  const controller = {
    run: async (action, service) => ({ ok: true, action, service }),
    healthCheck: async () => ({ ok: true, checks: [] })
  };
  const api = createAdminApi({ controller, tokenHash: hashAdminToken(token), port: 0 });
  await api.listen();
  const address = api.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'STATUS' })
    });
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
});

test('admin API forwards valid credentials using a stored hash', async () => {
  const calls = [];
  const controller = {
    run: async (action, service) => { calls.push([action, service]); return { ok: true, action, service }; },
    healthCheck: async () => ({ ok: true, checks: [] })
  };
  await withApi(controller, async (base) => {
    const bad = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'y'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'RESTART', service: 'app' })
    });
    assert.equal(bad.status, 401);
    assert.deepEqual(calls, []);

    const good = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'RESTART', service: 'app' })
    });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { ok: true, action: 'RESTART', service: 'app' });
    assert.deepEqual(calls, [['RESTART', 'app']]);
  });
});

test('admin API rejects oversized requests before controller execution', async () => {
  let calls = 0;
  const controller = { run: async () => { calls += 1; return { ok: true }; }, healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: 'x'.repeat(4097)
    });
    assert.equal(response.status, 413);
    assert.equal(calls, 0);
  });
});

test('admin API exposes a one-time localhost bootstrap endpoint for generated credentials', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mercora-admin-api-'));
  const tokenFile = path.join(dir, 'admin-token.json');
  try {
    const { loadOrCreateAdminCredential } = await import('./auth/admin-credential.js');
    const generated = await loadOrCreateAdminCredential({ tokenFile });
    const api = createAdminApi({
      controller: { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) },
      token: generated.token,
      tokenFile,
      bootstrapPending: true,
      port: 0
    });
    await api.listen();
    const address = api.server.address();
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const first = await fetch(`${base}/v1/bootstrap`, { method: 'POST' });
      assert.equal(first.status, 200);
      const body = await first.json();
      assert.equal(body.token, generated.token);

      const second = await fetch(`${base}/v1/bootstrap`, { method: 'POST' });
      assert.equal(second.status, 409);

      const raw = JSON.parse(await readFile(tokenFile, 'utf8'));
      assert.equal(raw.bootstrapPending, false);
      assert.equal(raw.tokenHash, hashAdminToken(generated.token));
      assert.equal(Object.hasOwn(raw, 'token'), false);
    } finally {
      await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
