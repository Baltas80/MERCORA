import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdminController, configurationCheck } from './admin-control.js';

const RUNNING = 'app\npostgres\ntor\n';
const TOR_CONFIG = 'ORPort 0\nDirPort 0\nExitPolicy reject *:*\n';
const ok = { ok: true, code: 0, stdout: '', stderr: '' };
const configured = () => ({ ...ok, name: 'configuration' });

function healthyRunner(calls) {
  return async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes('--services')) return { ...ok, stdout: RUNNING };
    if (args.includes('config') && args.includes('--volumes')) return { ...ok, stdout: 'postgres_data\n' };
    if (args.includes('tor') && args.includes('grep')) return { ...ok, stdout: TOR_CONFIG };
    if (args.includes('/data/mercora/hostname')) return ok;
    return ok;
  };
}

test('HEALTH_CHECK runs the full infrastructure health check instead of a plain compose ps', async () => {
  const calls = [];
  const controller = createAdminController({
    runner: healthyRunner(calls),
    probe: async () => ok,
    backendProbeFn: async () => ({ ...ok, code: 200 }),
    configurationProbe: configured
  });

  const result = await controller.run('HEALTH_CHECK');

  assert.equal(result.ok, true);
  assert.ok(result.checks.some((check) => check.name === 'postgresql'));
  assert.ok(result.checks.some((check) => check.name === 'onionService'));
  assert.ok(result.checks.some((check) => check.name === 'storage'));
  assert.ok(calls.some((entry) => entry.includes('pg_isready')));
  assert.ok(calls.some((entry) => entry.includes('/data/mercora/hostname')));
  assert.ok(calls.some((entry) => entry.includes('/data/torrc')));
  assert.ok(calls.some((entry) => entry.includes('config') && entry.includes('--volumes')));
  assert.ok(!calls.some((entry) => entry.includes('ps') && !entry.includes('--services')));
});

test('RECOVER performs targeted repair then verifies every infrastructure dependency', async () => {
  const calls = [];
  const runner = healthyRunner(calls);
  const probes = [];
  const probe = async (file, args) => {
    probes.push([file, ...args]);
    return ok;
  };
  const backendProbeFn = async () => ({ ...ok, code: 200, stdout: 'backend 200' });

  const controller = createAdminController({ runner, probe, backendProbeFn, configurationProbe: configured });
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
  assert.ok(calls.some((entry) => entry.includes('/data/mercora/hostname')));
  assert.ok(calls.some((entry) => entry.includes('/data/torrc')));
  assert.ok(calls.some((entry) => entry.includes('config') && entry.includes('--volumes')));
  assert.ok(result.steps.some((step) => step.step === 'health'));
});

test('RECOVER does not restart unrelated services when a target is supplied', async () => {
  const calls = [];
  const controller = createAdminController({
    runner: healthyRunner(calls),
    probe: async () => ok,
    backendProbeFn: async () => ({ ...ok, code: 200 }),
    configurationProbe: configured
  });

  const result = await controller.run('RECOVER', 'postgres');
  assert.equal(result.ok, true);
  const repairCommands = calls.slice(0, 1);
  assert.deepEqual(repairCommands, [['docker', 'compose', '-f', 'docker-compose.yml', 'restart', 'postgres']]);
  assert.equal(calls.filter((entry) => entry.includes('restart')).length, 1);
  assert.equal(calls.filter((entry) => entry.includes('up')).length, 0);
});

test('RECOVER blocks before Docker operations when required compose configuration is missing', async () => {
  const calls = [];
  const controller = createAdminController({
    runner: async (file, args) => {
      calls.push([file, ...args]);
      return ok;
    },
    configurationProbe: () => ({
      ok: false,
      code: null,
      stdout: '',
      stderr: 'POSTGRES_PASSWORD is not configured for Docker Compose'
    })
  });

  const result = await controller.run('RECOVER', 'tor');
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.target, null);
  assert.deepEqual(calls, []);
  assert.match(result.steps[0].result.stderr, /POSTGRES_PASSWORD is not configured/);
});

test('configurationCheck accepts a non-empty POSTGRES_PASSWORD from the Compose .env file without exposing it', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mercora-compose-'));
  try {
    fs.writeFileSync(path.join(cwd, '.env'), 'POSTGRES_PASSWORD=super-secret-value\n', 'utf8');
    const result = configurationCheck(cwd);
    assert.equal(result.ok, true);
    assert.equal(result.stdout, 'required compose configuration detected');
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /super-secret-value/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('configurationCheck rejects an empty Compose .env password', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mercora-compose-'));
  try {
    fs.writeFileSync(path.join(cwd, '.env'), 'POSTGRES_PASSWORD=\n', 'utf8');
    const result = configurationCheck(cwd);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /POSTGRES_PASSWORD is not configured/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Onion Compose enforces non-relay Tor configuration', () => {
  const compose = fs.readFileSync(path.resolve(process.cwd(), 'docker-compose.onion.yml'), 'utf8');
  assert.match(compose, /tor\/torrc\.onion\.secure:\/data\/torrc:ro/);
  assert.match(compose, /--ORPort[\s\S]*?"0"/);
  assert.match(compose, /--DirPort[\s\S]*?"0"/);
  assert.match(compose, /--ExitPolicy[\s\S]*?reject \*:\*/);
});
