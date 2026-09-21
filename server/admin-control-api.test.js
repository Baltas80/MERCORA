import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApi } from './admin-control-api.js';

const token = 'x'.repeat(32);

async function withApi(controller, fn) {
  const api = createAdminApi({ token, controller, port: 0 });
  await api.listen();
  const address = api.server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
  }
}

test('admin API rejects short tokens', () => {
  assert.throws(() => createAdminApi({ token: 'short' }), /at least 32/);
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

test('admin API uses constant-time-compatible token comparison and forwards valid requests', async () => {
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
