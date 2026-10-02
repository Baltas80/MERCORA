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
    if (args.includes('test') && args.includes('/data/mercora/hostname')) return healthyProbe();
    if (args.includes('grep') && args.includes('/data/torrc')) {
      return { ok: true, code: 0, stdout: 'ORPort 0\nDirPort 0\nExitPolicy reject *:*\n', stderr: '' };
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
  return {
    controller: createAdminController({
      runner,
      probe: async () => healthyProbe(),
      backendProbeFn: async () => healthyProbe(),
      configurationProbe: () => ({ ok: true, code: 0, stdout: 'required compose configuration detected', stderr: '' })
    }),
    calls
  };
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

test('RECOVER app is blocked when its PostgreSQL dependency is unhealthy', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (args.includes('pg_isready')) return { ok: false, code: 1, stdout: '', stderr: 'database unavailable' };
    if (args.includes('ps')) return { ok: true, code: 0, stdout: 'app\ntor\n', stderr: '' };
    if (args.includes('grep')) return { ok: true, code: 0, stdout: 'ORPort 0\nDirPort 0\nExitPolicy reject *:*\n', stderr: '' };
    if (args.includes('test')) return healthyProbe();
    if (args.includes('config')) return { ok: true, code: 0, stdout: 'postgres_data\n', stderr: '' };
    return healthyProbe();
  };
  const controller = createAdminController({
    runner,
    probe: async () => healthyProbe(),
    backendProbeFn: async () => healthyProbe(),
    configurationProbe: () => ({ ok: true, code: 0, stdout: 'required compose configuration detected', stderr: '' })
  });

  const result = await controller.run('RECOVER', 'app');

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.target, 'app');
  assert.equal(result.repaired, false);
  assert.equal(result.steps.at(-1).step, 'dependency-block');
  assert.equal(calls.some(([, args]) => args.includes('restart') && args.at(-1) === 'app'), false);
});

test('RECOVER records post-recovery verification in the required operational order', async () => {
  const { controller } = controllerWithRunner(['postgres', 'app\npostgres\ntor']);

  const result = await controller.run('RECOVER');
  const steps = result.steps.map(({ step }) => step);
  const expected = [
    'restart:app',
    'verify:dependencies',
    'verify:backend',
    'verify:database',
    'verify:tor',
    'verify:onion-service',
    'health'
  ];

  assert.deepEqual(steps.slice(-expected.length), expected);
  assert.equal(result.steps.find((entry) => entry.step === 'verify:dependencies')?.result?.ok, true);
  assert.equal(result.steps.find((entry) => entry.step === 'verify:backend')?.result?.ok, true);
  assert.equal(result.steps.find((entry) => entry.step === 'verify:database')?.result?.ok, true);
  assert.equal(result.steps.find((entry) => entry.step === 'verify:tor')?.result?.ok, true);
  assert.equal(result.steps.find((entry) => entry.step === 'verify:onion-service')?.result?.ok, true);
});

test('RECOVER verification does not expose diagnostic secrets', async () => {
  const { controller } = controllerWithRunner(['postgres', 'app\npostgres\ntor']);

  const result = await controller.run('RECOVER');
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /password|secret|token|authorization/i);
});

test('HEALTH_CHECK validates effective Tor relay listeners are disabled', async () => {
  const { controller } = controllerWithRunner(['app\npostgres\ntor']);

  const result = await controller.run('HEALTH_CHECK');
  const torConfig = result.checks.find((check) => check.name === 'torConfig');

  assert.equal(torConfig.ok, true);
  assert.match(torConfig.stdout, /ORPort 0/);
  assert.match(torConfig.stdout, /DirPort 0/);
  assert.match(torConfig.stdout, /ExitPolicy reject \*:\*/);
});

test('HEALTH_CHECK validates the Compose-defined persistent storage without hardcoding a project prefix', async () => {
  const { controller } = controllerWithRunner(['app\npostgres\ntor']);

  const result = await controller.run('HEALTH_CHECK');
  const storage = result.checks.find((check) => check.name === 'storage');

  assert.equal(storage.ok, true);
  assert.equal(storage.stdout, 'postgres_data configured');
});

test('HEALTH_CHECK uses the controlled Docker app probe by default', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (args.includes('port') && args.includes('app')) return { ok: true, code: 0, stdout: '127.0.0.1:8080\n', stderr: '' };
    if (args.includes('pg_isready')) return healthyProbe();
    if (args.includes('ps')) return { ok: true, code: 0, stdout: 'app\npostgres\ntor\n', stderr: '' };
    if (args.includes('grep')) return { ok: true, code: 0, stdout: 'ORPort 0\nDirPort 0\nExitPolicy reject *:*\n', stderr: '' };
    if (args.includes('test')) return healthyProbe();
    if (args.includes('config')) return { ok: true, code: 0, stdout: 'postgres_data\n', stderr: '' };
    return healthyProbe();
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:8080/api/healthz');
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };

  try {
    const controller = createAdminController({
      runner,
      probe: async () => healthyProbe(),
      configurationProbe: () => ({ ok: true, code: 0, stdout: 'required compose configuration detected', stderr: '' })
    });

    const result = await controller.run('HEALTH_CHECK');
    const backendCall = calls.find(([, args]) => args.includes('port') && args.includes('app'));

    assert.equal(result.checks.find((check) => check.name === 'backend')?.ok, true);
    assert.equal(backendCall?.[0], 'docker');
    assert.deepEqual(backendCall?.[1].slice(-2), ['app', '8080']);
    assert.equal(calls.some(([, args]) => args.includes('exec') && args.includes('app') && args.includes('node')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HEALTH_CHECK falls back to the controlled Docker app probe when no safe published port is available', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (args.includes('port') && args.includes('app')) return { ok: false, code: 1, stdout: '', stderr: 'no port published' };
    if (args.includes('pg_isready')) return healthyProbe();
    if (args.includes('ps')) return { ok: true, code: 0, stdout: 'app\npostgres\ntor\n', stderr: '' };
    if (args.includes('grep')) return { ok: true, code: 0, stdout: 'ORPort 0\nDirPort 0\nExitPolicy reject *:*\n', stderr: '' };
    if (args.includes('test')) return healthyProbe();
    if (args.includes('config')) return { ok: true, code: 0, stdout: 'postgres_data\n', stderr: '' };
    if (args.includes('exec') && args.includes('app') && args.includes('node')) return healthyProbe();
    return healthyProbe();
  };
  const controller = createAdminController({
    runner,
    probe: async () => healthyProbe(),
    configurationProbe: () => ({ ok: true, code: 0, stdout: 'required compose configuration detected', stderr: '' })
  });

  const result = await controller.run('HEALTH_CHECK');
  const backendFallback = calls.find(([, args]) => args.includes('exec') && args.includes('app') && args.includes('node'));

  assert.equal(result.checks.find((check) => check.name === 'backend')?.ok, true);
  assert.equal(backendFallback?.[0], 'docker');
  assert.equal(backendFallback?.[1].at(-2), '-e');
  assert.match(backendFallback?.[1].at(-1) ?? '', /127\.0\.0\.1:8080\/api\/healthz/);
});

test('HEALTH_CHECK exposes only sanitized backend HTTP diagnostics', async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (args.includes('port') && args.includes('app')) return { ok: true, code: 0, stdout: '127.0.0.1:8080\n', stderr: '' };
    if (args.includes('pg_isready')) return healthyProbe();
    if (args.includes('ps')) return { ok: true, code: 0, stdout: 'app\npostgres\ntor\n', stderr: '' };
    if (args.includes('grep')) return { ok: true, code: 0, stdout: 'ORPort 0\nDirPort 0\nExitPolicy reject *:*\n', stderr: '' };
    if (args.includes('test')) return healthyProbe();
    if (args.includes('config')) return { ok: true, code: 0, stdout: 'postgres_data\n', stderr: '' };
    if (args.includes('exec') && args.includes('app') && args.includes('node')) {
      return { ok: false, code: 1, stdout: '{"status":503,"statusText":"Service Unavailable","ok":false}', stderr: '' };
    }
    return healthyProbe();
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 503 }), { status: 503, statusText: 'Service Unavailable' });

  try {
    const controller = createAdminController({
      runner,
      probe: async () => healthyProbe(),
      configurationProbe: () => ({ ok: true, code: 0, stdout: 'required compose configuration detected', stderr: '' })
    });

    const result = await controller.run('HEALTH_CHECK');
    const backend = result.checks.find((check) => check.name === 'backend');

    assert.equal(result.ok, false);
    assert.equal(backend?.ok, false);
    assert.equal(backend?.code, 503);
    assert.match(backend?.stdout ?? '', /"status":503/);
    assert.doesNotMatch(backend?.stdout ?? '', /password|secret|token|authorization/i);
    assert.doesNotMatch(backend?.stderr ?? '', /password|secret|token|authorization/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
