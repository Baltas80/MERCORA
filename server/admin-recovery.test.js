import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminController } from './admin-control.js';

const RUNNING = 'app\npostgres\ntor\n';
const ok = { ok: true, code: 0, stdout: '', stderr: '' };

test('RECOVER performs targeted repair then verifies every infrastructure dependency', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('--services')) return { ...ok, stdout: RUNNING };
    return ok;
  };
  const probes = [];
  const probe = async (file, args) => {
    probes.push([file, ...args]);
    return ok;
  };
  const backendProbeFn = async () => ({ ...ok, code: 200, stdout: 'backend 200' });

  const controller = createAdminController({ runner, probe, backendProbeFn });
  const result = await controller.run('RECOVER', 'tor');

  assert.equal(result.ok, true);
  assert.equal(result.target, 'tor');
  assert.equal(result.targetHealthy, true);
  assert.equal(result.steps[0].step, 'restart:tor');
  assert.deepEqual(calls[0], ['docker', 'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.onion.yml', 'restart', 'tor']);
  assert.ok(probes.some(([file, ...args]) => file === 'node' && args[0] === '--version'));
  assert.ok(probes.some(([file, ...args]) => file === 'docker' && args[0] === 'version'));
  assert.ok(calls.some((entry) => entry.includes('--services')));
  assert.ok(calls.some((entry) => entry.includes('pg_isready')));
  assert.ok(calls.some((entry) => entry.includes('/data/hostname')));
  assert.ok(probes.some(([file, ...args]) => file === 'docker' && args[0] === 'volume'));
  assert.ok(result.steps.some((step) => step.step === 'health'));
});

test('RECOVER does not restart unrelated services when a target is supplied', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('--services')) return { ...ok, stdout: RUNNING };
    return ok;
  };
  const controller = createAdminController({
    runner,
    probe: async () => ok,
    backendProbeFn: async () => ({ ...ok, code: 200 })
  });

  const result = await controller.run('RECOVER', 'postgres');
  assert.equal(result.ok, true);
  const repairCommands = calls.slice(0, 1);
  assert.deepEqual(repairCommands, [['docker', 'compose', '-f', 'docker-compose.yml', 'restart', 'postgres']]);
  assert.equal(calls.filter((entry) => entry.includes('restart')).length, 1);
  assert.equal(calls.filter((entry) => entry.includes('up')).length, 0);
});
