import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const adminSecret = 'test-secret-for-better-auth-only-32-chars-minimum';
process.env.BETTER_AUTH_SECRET = adminSecret;
process.env.MERCORA_ADMIN_AUTH_DB = path.join(os.tmpdir(), `mercora-admin-auth-test-${process.pid}.db`);

const { createAdminApi } = await import('./admin-control-api.js');
const { auth } = await import('./auth/better-auth.js');
const { getMigrations } = await import('better-auth/db/migration');
const migrations = await getMigrations(auth.options);
await migrations.runMigrations();

async function withApi(controller, fn) {
  const api = createAdminApi({ controller, port: 0 });
  await api.listen();
  const address = api.server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
  }
}

test('admin API remains loopback-only and rejects unauthenticated control requests', async () => {
  const controller = { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  });
});

test('admin API rejects oversized requests before authentication/controller execution', async () => {
  let calls = 0;
  const controller = { run: async () => { calls += 1; return { ok: true }; }, healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(4097)
    });
    assert.equal(response.status, 413);
    assert.equal(calls, 0);
  });
});

test('admin API does not expose arbitrary control endpoints', async () => {
  await withApi({ run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) }, async (base) => {
    const response = await fetch(`${base}/v1/exec`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  });
});
