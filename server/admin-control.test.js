import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminController, sanitizeResult } from './admin-control.js';

const fakeProbe = (log) => async (service) => {
  log.push(['probe', service]);
  return { ok: true, service, status: 'running' };
};
const okBackend = async () => ({ ok: true, status: 'running' });

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
  assert.ok(log[1].includes('up'));
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
  assert.ok(log[0].includes('restart'));
  assert.ok(log[1].includes('up'));
});

test('diagnostics remove secret-bearing lines', () => {
  const result = sanitizeResult({ ok: false, code: 1, stdout: 'safe\nTOKEN=do-not-show', stderr: 'password=secret' });
  assert.equal(result.stdout, 'safe');
  assert.equal(result.stderr, '');
});
