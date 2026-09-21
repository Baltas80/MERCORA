import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, createAdminController, sanitizeResult } from './admin-control.js';

function fakeRunner(log, result = { ok: true, code: 0, stdout: '', stderr: '' }) {
  return async (file, args) => {
    log.push([file, ...args]);
    return result;
  };
}

const RUNNING_SERVICES = 'app\npostgres\ntor\n';

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

test('diagnostics remove secret-bearing lines', () => {
  const result = sanitizeResult({ ok: false, code: 1, stdout: 'safe\nTOKEN=do-not-show', stderr: 'password=secret' });
  assert.equal(result.stdout, 'safe');
  assert.equal(result.stderr, '');
});
