import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApi } from './admin-control-api.js';

const token = 'x'.repeat(32);

test('admin API rejects short tokens', () => {
  assert.throws(() => createAdminApi({ token: 'short' }), /at least 32/);
});

test('admin API requires bearer authentication', async () => {
  const controller = { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) };
  const api = createAdminApi({ token, controller, port: 0 });
  await api.listen();
  const address = api.server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/control`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 401);
  api.server.close();
});

test('admin API validates action and service before calling controller', async () => {
  let calls = 0;
  const controller = { run: async () => { calls += 1; return { ok: true }; }, healthCheck: async () => ({ ok: true }) };
  const api = createAdminApi({ token, controller, port: 0 });
  await api.listen();
  const address = api.server.address();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/control`, { method: 'POST', headers, body: JSON.stringify({ action: 'RESTART', service: 'nope' }) });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  api.server.close();
});
