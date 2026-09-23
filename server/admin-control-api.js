import http from 'node:http';
import { auth as defaultAuth } from './auth/better-auth.js';
import { createAdminController } from './admin-control.js';

const ACTIONS = new Set(['START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER']);
const SERVICES = new Set(['app', 'postgres', 'tor']);
const MAX_BODY = 4096;

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function responseHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function requestHeaders(req, cookie = null) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  if (!headers.has('x-forwarded-for') && req.socket.remoteAddress) {
    headers.set('x-forwarded-for', req.socket.remoteAddress);
  }
  if (cookie !== null) headers.set('cookie', cookie);
  return headers;
}

function forwardSetCookies(res, headers) {
  const cookies = headers?.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  else {
    const cookie = headers?.get?.('set-cookie');
    if (cookie) res.setHeader('Set-Cookie', cookie);
  }
}

async function rejectOversized(req, res) {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY) {
    res.writeHead(413);
    res.end(JSON.stringify({ error: 'request too large' }));
    req.resume();
    return true;
  }
  return false;
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY) {
      throw Object.assign(new Error('request too large'), { statusCode: 413 });
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { statusCode: 400 });
  }
}

async function requireAdmin(auth, req) {
  const session = await auth.api.getSession({ headers: requestHeaders(req) });
  if (!session?.user || session.user.role !== 'admin') return null;
  return session;
}

async function authenticateLogin(auth, req, res) {
  const input = await readJson(req);
  const username = typeof input.username === 'string' ? input.username : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!username || !password) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    const headers = requestHeaders(req);
    headers.delete('content-length');
    headers.delete('host');
    headers.set('content-type', 'application/json');
    const request = new Request(
      `http://127.0.0.1:${process.env.MERCORA_ADMIN_PORT ?? '8787'}/api/auth/sign-in/username`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password, rememberMe: false }),
      },
    );
    const response = await auth.handler(request);
    forwardSetCookies(res, response.headers);
    const body = await response.text();
    if (!response.ok) {
      res.writeHead(response.status || 401);
      return res.end(JSON.stringify({ error: response.status === 429 ? 'too many authentication attempts' : 'unauthorized' }));
    }
    const parsed = JSON.parse(body || '{}');
    if (parsed?.user?.role !== 'admin') {
      const cookie = response.headers.getSetCookie?.()[0]?.split(';', 1)[0] ?? response.headers.get('set-cookie')?.split(';', 1)[0];
      if (cookie) await auth.api.signOut({ headers: new Headers({ cookie }) }).catch(() => {});
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'admin role required' }));
    }
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, user: { id: parsed.user.id, username: parsed.user.username ?? null, role: parsed.user.role } }));
  } catch {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'unauthorized' }));
  }
}

async function logout(auth, req, res) {
  try {
    const response = await auth.api.signOut({ headers: requestHeaders(req), asResponse: true });
    forwardSetCookies(res, response.headers);
  } catch {}
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export function createAdminApi({ controller, auth, host = '127.0.0.1', port = 8787 } = {}) {
  const control = controller ?? createAdminController();
  const authProvider = auth ?? defaultAuth;

  const server = http.createServer(async (req, res) => {
    responseHeaders(res);
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'local access only' }));
    }
    if (await rejectOversized(req, res)) return;

    if (req.method === 'POST' && req.url === '/v1/login') {
      try {
        return await authenticateLogin(authProvider, req, res);
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
        res.writeHead(status);
        return res.end(JSON.stringify({ error: status === 413 ? 'request too large' : 'invalid request' }));
      }
    }

    if (req.method === 'POST' && req.url === '/v1/logout') return logout(authProvider, req, res);

    if (req.method === 'GET' && req.url === '/v1/session') {
      const session = await requireAdmin(authProvider, req);
      if (!session) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, user: { id: session.user.id, username: session.user.username ?? null, role: session.user.role } }));
    }

    const authenticated = await requireAdmin(authProvider, req);
    if (!authenticated) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }

    if (req.method !== 'POST' || req.url !== '/v1/control') {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'not found' }));
    }

    try {
      const input = await readJson(req);
      const action = String(input.action ?? '').toUpperCase();
      const service = input.service === undefined ? undefined : String(input.service);
      if (!ACTIONS.has(action)) throw new Error('unsupported action');
      if (service !== undefined && !SERVICES.has(service)) throw new Error('unsupported service');
      const result = action === 'HEALTH_CHECK'
        ? await control.healthCheck()
        : await control.run(action, service);
      res.writeHead(result.ok ? 200 : 503);
      return res.end(JSON.stringify(result));
    } catch (error) {
      const status = error?.statusCode ?? 400;
      res.writeHead(status);
      return res.end(JSON.stringify({ error: status === 413 ? 'request too large' : String(error.message ?? 'bad request') }));
    }
  });

  return { server, listen: () => new Promise((resolve) => server.listen(port, host, resolve)) };
}
