import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminController } from './admin-control.js';

function healthyProbe() {
  return { ok: true, code: 0, stdout: 'ok', stderr: '' };
}

function controllerWithRunner(sequence) {
  let psCalls = 0;
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (args.includes('pg_isready')) return healthyProbe();
    if (args.includes('test') && args.includes('/data/hostname')) return healthyProbe();
    if (args.includes('grep') && args.includes('/torrc-defaults')) {
      return { ok: true, code: 0, stdout: 'ORPort 0\nDirPort 0\n', stderr: '' };
    }
    if (args.includes('config') && args.includes('--volumes')) {
      return { ok: true, code: 0, stdout: 'postgres_data\n', stderr: '' };
    }
    if (args.includes('ps')) {
      psCalls += 1;
      return { ok: true, code: 0, stdout: sequence[psCalls - 1] ?? sequence.at(-1), stderr: '' };
    }
    if (args.includes('restart') || args.includes('up')) return healthyProbe();
    return healthyProbe();
  };
  return { controller: createAdminController({ runner, probe: async () => healthyProbe(), backendProbeFn: async () => healthyProbe() }), calls };
}

test('RECOVER without target repairs only an unhealthy app', async () => {
  const { controller, calls } = controllerWithRunner(['postgres', 'app\npostgres\ntor']);

  const result = await controller.run('RECOVER');

  assert.equal(result.target, 'app');
  assert.equal(result.repaired, true);
  assert.equal(result.targetHealthy, true);
  assert.equal(result.ok, true);
  assert.equal(calls.some(([, args]) => args.includes('restart') && args.at(-1) === 'app'), true);
  assert.equal(calls.some(([, args]) => args.includes('restart') && args.at(-1) === 'postgres'), false);
  assert.equal(calls.some(([, args]) => args.includes('restart') && args.at(-1) === 'tor'), false);
});

test('RECOVER without target does not restart a healthy stack', async () => {
  const { controller, calls } = controllerWithRunner(['app\npostgres\ntor']);

  const result = await controller.run('RECOVER');

  assert.equal(result.target, null);
  assert.equal(result.repaired, false);
  assert.equal(result.ok, true);
  assert.equal(calls.some(([, args]) => args.includes('restart')), false);
});

test('RECOVER rejects an unsupported explicit service', async () => {
  const { controller } = controllerWithRunner(['app\npostgres\ntor']);

  await assert.rejects(() => controller.run('RECOVER', 'shell'), /Unsupported service/);
});

test('HEALTH_CHECK validates effective Tor relay listeners are disabled', async () => {
  const { controller } = controllerWithRunner(['app\npostgres\ntor']);

  const result = await controller.run('HEALTH_CHECK');
  const torConfig = result.checks.find((check) => check.name === 'torConfig');

  assert.equal(torConfig.ok, true);
  assert.match(torConfig.stdout, /ORPort 0/);
  assert.match(torConfig.stdout, /DirPort 0/);
});

test('HEALTH_CHECK validates the Compose-defined persistent storage without hardcoding a project prefix', async () => {
  const { controller } = controllerWithRunner(['app\npostgres\ntor']);

  const result = await controller.run('HEALTH_CHECK');
  const storage = result.checks.find((check) => check.name === 'storage');

  assert.equal(storage.ok, true);
  assert.equal(storage.stdout, 'postgres_data configured');
});
