import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApi } from './admin-control-api.js';

const token = 'x'.repeat(32);

test('malformed JSON is rejected as a client error', async () => {
  const api = createAdminApi({
    token,
    port: 0,
    controller: { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) },
    management: { run: async () => ({}) },
    reputation: { run: async () => ({}) },
    escrow: { run: async () => ({}) },
    system: {
      logs: async () => ({}), metrics: async () => ({}), migrateDb: async () => ({}),
      backupDb: async () => ({}), listBackups: async () => [], verifyBackup: async () => ({}),
      restoreBackup: async () => ({})
    }
  });
  await api.listen();
  const port = api.server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{"action":'
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /JSON/i);
  } finally {
    await new Promise(resolve => api.server.close(resolve));
  }
});

test('JSON arrays are rejected as administrative request bodies', async () => {
  const api = createAdminApi({
    token,
    port: 0,
    controller: { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) },
    management: { run: async () => ({}) },
    reputation: { run: async () => ({}) },
    escrow: { run: async () => ({}) },
    system: {
      logs: async () => ({}), metrics: async () => ({}), migrateDb: async () => ({}),
      backupDb: async () => ({}), listBackups: async () => [], verifyBackup: async () => ({}),
      restoreBackup: async () => ({})
    }
  });
  await api.listen();
  const port = api.server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/control`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '[]'
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise(resolve => api.server.close(resolve));
  }
});
