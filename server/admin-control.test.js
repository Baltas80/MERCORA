import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, createAdminController, sanitizeResult } from './admin-control.js';

function fakeRunner(log, result = { ok: true, code: 0, stdout: '', stderr: '' }) {
  return async (file, args) => {
    log.push([file, ...args]);
    return result;
  };
}

function fakeProbe(log, result = { ok: true, code: 0, stdout: '', stderr: '' }) {
  return async (file, args) => {
    log.push([file, ...args]);
    return result;
  };
}

const okBackend = () => ({ ok: true, code: 200, stdout: 'backend 200', stderr: '' });

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

test('recovery targets only the affected component first and then verifies in dependency order', async () => {
  const log = [];
  const controller = createAdminController({ runner: fakeRunner(log), probe: fakeProbe(log), backendProbe: okBackend });
  const result = await controller.run('RECOVER', 'postgres');
  assert.equal(result.target, 'postgres');
  assert.equal(log[0].at(-1), 'postgres');
  assert.equal(log[0][4], 'restart');
  assert.deepEqual(log.slice(1, 6).map((entry) => entry.slice(0, 2)), [
    ['node', '--version'],
    ['docker', 'version'],
    ['docker', 'compose'],
    ['docker', 'compose'],
    ['docker', 'compose']
  ]);
  assert.equal(result.steps.at(-1).step, 'health');
  assert.equal(result.ok, true);
});

test('recovery health verification covers database, Tor, Onion Service and storage after dependencies', async () => {
  const log = [];
  const controller = createAdminController({ runner: fakeRunner(log), probe: fakeProbe(log), backendProbe: okBackend });
  const result = await controller.run('RECOVER', 'app');
  assert.equal(result.ok, true);
  assert.equal(log[0][4], 'restart');
  assert.deepEqual(log.slice(1).map((entry) => entry[0]), [
    'node', 'docker', 'docker', 'docker', 'docker', 'docker', 'docker'
  ]);
  assert.equal(log[3].at(-1), 'ps');
  assert.ok(log[4].includes('pg_isready'));
  assert.ok(log[5].includes('tor'));
  assert.ok(log[6].includes('/data/hostname'));
  assert.ok(log[7].includes('mercora_postgres_data'));
  assert.deepEqual(Object.keys(result.steps.at(-1).result.components), [
    'node', 'docker', 'mercora', 'backend', 'postgres', 'tor', 'onionService', 'storage', 'health'
  ]);
});

test('failed restart falls back to start for the same component', async () => {
  const log = [];
  let calls = 0;
  const runner = async (file, args) => {
    log.push([file, ...args]);
    calls += 1;
    if (calls === 1) return { ok: false, code: 1, stdout: '', stderr: 'failure' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const controller = createAdminController({ runner, probe: fakeProbe(log), backendProbe: okBackend });
  const result = await controller.run('RECOVER', 'app');
  assert.equal(result.steps[1].step, 'start:app');
  assert.equal(log[1][4], 'up');
});

test('failed restart and failed start abort recovery without broad restart', async () => {
  const log = [];
  const runner = async (file, args) => {
    log.push([file, ...args]);
    return { ok: false, code: 1, stdout: '', stderr: 'failure' };
  };
  const controller = createAdminController({ runner, probe: fakeProbe(log), backendProbe: okBackend });
  const result = await controller.run('RECOVER', 'tor');
  assert.equal(result.ok, false);
  assert.equal(result.recoveryAborted, true);
  assert.equal(log.length, 2);
  assert.equal(log[0][4], 'restart');
  assert.equal(log[1][4], 'up');
});

test('diagnostics remove secret-bearing lines', () => {
  const result = sanitizeResult({ ok: false, code: 1, stdout: 'safe\nTOKEN=do-not-show', stderr: 'password=secret' });
  assert.equal(result.stdout, 'safe');
  assert.equal(result.stderr, '');
});
