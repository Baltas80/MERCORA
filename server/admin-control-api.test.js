import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const adminSecret = process.env.BETTER_AUTH_SECRET ?? 'test-secret-for-better-auth-only-32-chars-minimum';
process.env.BETTER_AUTH_SECRET = adminSecret;
process.env.MERCORA_ADMIN_AUTH_DB = process.env.MERCORA_ADMIN_AUTH_DB ?? path.join(os.tmpdir(), `mercora-admin-auth-test-${process.pid}.db`);

const { createAdminApi } = await import('./admin-control-api.js');
const { auth } = await import('./auth/better-auth.js');
const { getMigrations } = await import('better-auth/db/migration');
const migrations = await getMigrations(auth.options);
await migrations.runMigrations();

async function withApi(controller, fn, authProvider = auth) {
  const api = createAdminApi({ controller, auth: authProvider, port: 0 });
  await api.listen();
  const address = api.server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
  }
}

function sessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies[0]?.split(';', 1)[0] ?? response.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
}

test('admin API remains loopback-only and rejects unauthenticated control requests', async () => {
  const controller = { run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  });
});

test('admin API rejects oversized requests before authentication/controller execution', async () => {
  let calls = 0;
  const controller = { run: async () => { calls += 1; return { ok: true }; }, healthCheck: async () => ({ ok: true }) };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(4097)
    });
    assert.equal(response.status, 413);
    assert.equal(calls, 0);
  });
});

test('admin API ignores spoofed forwarded IP headers for authentication', async () => {
  let observedHeaders;
  const fakeAuth = {
    api: {
      getSession: async ({ headers }) => {
        observedHeaders = headers;
        return null;
      },
      signOut: async () => ({ ok: true }),
    },
    handler: async () => new Response('{}', { status: 401 }),
  };
  await withApi({ run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) }, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'STATUS' }),
    });
    assert.equal(response.status, 401);
    assert.equal(observedHeaders.get('x-forwarded-for'), '127.0.0.1');
  }, fakeAuth);
});

test('admin API does not expose arbitrary control endpoints', async () => {
  await withApi({ run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) }, async (base) => {
    const response = await fetch(`${base}/v1/exec`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  });
});

test('admin control API does not expose unexpected controller exception details', async () => {
  const fakeAuth = {
    api: {
      getSession: async () => ({ user: { id: 'admin-1', username: 'admin', role: 'admin' } }),
      signOut: async () => ({ ok: true }),
    },
    handler: async () => new Response('{}', { status: 401 }),
  };
  const controller = {
    run: async () => { throw new Error('secret internal path C:\\MERCORA\\private\nTOKEN=must-not-leak'); },
    healthCheck: async () => ({ ok: true }),
  };
  await withApi(controller, async (base) => {
    const response = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=admin-session' },
      body: JSON.stringify({ action: 'RESTART', service: 'app' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'control operation failed' });
  }, fakeAuth);
});

test('admin login does not issue a session cookie to a non-admin user', async () => {
  let signOutCalls = 0;
  const fakeAuth = {
    api: {
      getSession: async () => null,
      signOut: async () => { signOutCalls += 1; return { ok: true }; },
    },
    handler: async () => new Response(JSON.stringify({ user: { id: 'user-1', username: 'ordinary-user', role: 'user' } }), {
      status: 200,
      headers: { 'set-cookie': 'mercora_admin.session=temporary-session; HttpOnly; Path=/; SameSite=Strict' },
    }),
  };
  await withApi({ run: async () => ({ ok: true }), healthCheck: async () => ({ ok: true }) }, async (base) => {
    const response = await fetch(`${base}/v1/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ordinary-user', password: 'password' }),
    });
    assert.equal(response.status, 403);
    assert.equal(sessionCookie(response), null);
    assert.equal(signOutCalls, 1);
  }, fakeAuth);
});

test('admin API authenticates a provisioned Better Auth admin and authorizes control operations', {
  skip: !process.env.MERCORA_ADMIN_TEST_USERNAME || !process.env.MERCORA_ADMIN_TEST_PASSWORD,
}, async () => {
  const calls = [];
  const controller = {
    run: async (action, service) => { calls.push([action, service]); return { ok: true, action, service }; },
    healthCheck: async () => ({ ok: true, checks: [] })
  };
  await withApi(controller, async (base) => {
    const login = await fetch(`${base}/v1/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: process.env.MERCORA_ADMIN_TEST_USERNAME, password: process.env.MERCORA_ADMIN_TEST_PASSWORD })
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);
    assert.ok(cookie);

    const good = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'RESTART', service: 'app' })
    });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { ok: true, action: 'RESTART', service: 'app' });
    assert.deepEqual(calls, [['RESTART', 'app']]);

    const logout = await fetch(`${base}/v1/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);

    const denied = await fetch(`${base}/v1/control`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'STATUS' })
    });
    assert.equal(denied.status, 401);
  });
});