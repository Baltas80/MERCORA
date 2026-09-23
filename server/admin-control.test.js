import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, createAdminController, sanitizeResult } from './admin-control.js';
import { createAdminApi } from './admin-control-api.js';

function fakeRunner(log, result = { ok: true, code: 0, stdout: '', stderr: '' }) {
  return async (file, args) => {
    log.push([file, ...args]);
    return result;
  };
}

const RUNNING_SERVICES = 'app\npostgres\ntor\n';
const ADMIN_TOKEN = 'x'.repeat(64);

async function withApi(controller, fn) {
  const api = createAdminApi({ controller, token: ADMIN_TOKEN, port: 0 });
  await api.listen();
  const address = api.server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
}

const apiHeaders = {
  authorization: `Bearer ${ADMIN_TOKEN}`,
  'content-type': 'application/json'
};

test('exposes only the six allowlisted operations', () => {
  assert.deepEqual(ACTIONS, ['START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER']);
});

test('never builds a shell command and allowlists service names', async () => {
  const log = [];
  const controller = createAdminController({ runner: fakeRunner(log) });
  await controller.run('RESTART', 'app');
  assert.deepEqual(log[0], ['docker', 'compose', '-f', 'docker-compose.yml', 'restart', 'app']);
  await assert.rejects(() => controller.run('RESTART', 'app;whoami'), /Unsupported service/);
  await assert.rejects(() => controller.run('SHELL'), /Unsupported admin action/);
});

test('recovery targets only the affected component first', async () => {
  const log = [];
  const runner = async (file, args) => {
    log.push([file, ...args]);
    if (args.includes('--services')) return { ok: true, code: 0, stdout: RUNNING_SERVICES, stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const controller = createAdminController({ runner, backendProbeFn: async () => ({ ok: true }) });
  const result = await controller.run('RECOVER', 'postgres');
  assert.equal(result.target, 'postgres');
  assert.equal(log[0].at(-1), 'postgres');
  assert.equal(log[0][4], 'restart');
  assert.ok(log.some((entry) => entry.includes('--services')));
});

test('failed restart falls back to start for the same component and can still recover successfully', async () => {
  const log = [];
  let calls = 0;
  const runner = async (file, args) => {
    log.push([file, ...args]);
    calls += 1;
    if (calls === 1) return { ok: false, code: 1, stdout: '', stderr: 'failure' };
    if (args.includes('--services')) return { ok: true, code: 0, stdout: RUNNING_SERVICES, stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const probe = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  const backendProbeFn = async () => ({ ok: true, code: 200, stdout: 'backend 200', stderr: '' });
  const controller = createAdminController({ runner, probe, backendProbeFn });
  const result = await controller.run('RECOVER', 'app');
  assert.equal(result.steps[1].step, 'start:app');
  assert.equal(log[1][4], 'up');
  assert.equal(result.ok, true);
});

test('health check reports offline when a required compose service is not running', async () => {
  const runner = async (file, args) => {
    if (args.includes('--services')) return { ok: true, code: 0, stdout: 'app\npostgres\n', stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const probe = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  const backendProbeFn = async () => ({ ok: true, code: 200, stdout: 'backend 200', stderr: '' });
  const controller = createAdminController({ runner, probe, backendProbeFn });
  const result = await controller.run('STATUS');
  assert.equal(result.health, 'OFFLINE');
  assert.equal(result.tor, 'OFFLINE');
  assert.equal(result.ok, false);
});

test('status exposes structured infrastructure state without exposing raw diagnostics', async () => {
  const runner = async (file, args) => {
    if (args.includes('--services')) return { ok: true, code: 0, stdout: RUNNING_SERVICES, stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const probe = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  const backendProbeFn = async () => ({ ok: true, code: 200, stdout: 'backend 200', stderr: '' });
  const controller = createAdminController({ runner, probe, backendProbeFn });
  const result = await controller.run('STATUS');
  assert.equal(result.ok, true);
  assert.equal(result.mercora, 'ONLINE');
  assert.equal(result.node, 'ONLINE');
  assert.equal(result.postgresql, 'ONLINE');
  assert.equal(result.backend, 'ONLINE');
  assert.equal(result.tor, 'ONLINE');
  assert.equal(result.onionService, 'CONFIGURED');
  assert.equal(result.storage, 'OK');
  assert.equal(result.health, 'OK');
});

test('diagnostics remove secret-bearing lines and redact embedded credentials', () => {
  const result = sanitizeResult({
    ok: false,
    code: 1,
    stdout: 'safe\nTOKEN=do-not-show\npostgres://mercora:supersecret@db:5432/mercora\nendpoint token=still-secret',
    stderr: 'password=secret'
  });
  assert.equal(result.stdout, 'safe\npostgres://mercora:[REDACTED]@db:5432/mercora\nendpoint token=[REDACTED]');
  assert.equal(result.stderr, '');
});

test('admin API rejects missing or invalid authentication', async () => {
  const controller = { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const missing = await fetch(`${base}/v1/control`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'STATUS' })
    });
    assert.equal(missing.status, 401);

    const invalid = await fetch(`${base}/v1/control`, {
      method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'STATUS' })
    });
    assert.equal(invalid.status, 401);
  });
});

test('admin API forwards only validated operations', async () => {
  const calls = [];
  const controller = {
    run: async (action, service) => {
      calls.push([action, service]);
      return { ok: true, action, service };
    },
    healthCheck: async () => ({ ok: true })
  };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ action: 'restart', service: 'app' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [['RESTART', 'app']]);

    const rejected = await fetch(`${base}/v1/control`, {
      method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ action: 'restart', service: 'app;whoami' })
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(calls, [['RESTART', 'app']]);
  });
});

test('admin API routes HEALTH_CHECK without invoking an arbitrary action', async () => {
  const calls = [];
  const controller = {
    run: async (...args) => calls.push(['run', ...args]),
    healthCheck: async () => ({ ok: true, checks: [] })
  };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ action: 'health_check' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, checks: [] });
    assert.deepEqual(calls, []);
  });
});

test('admin API rejects bodies larger than 4 KiB', async () => {
  let calls = 0;
  const controller = {
    run: async () => { calls += 1; return { ok: true }; },
    healthCheck: async () => ({ ok: true })
  };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: apiHeaders,
      body: 'x'.repeat(4097)
    });
    assert.equal(response.status, 413);
    assert.equal(calls, 0);
  });
});

test('admin API exposes defensive response headers', async () => {
  const controller = { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ action: 'status' })
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  });
});
