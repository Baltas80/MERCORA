import crypto from 'node:crypto';
import http from 'node:http';
import { claimBootstrapToken, hashAdminToken, isValidAdminToken } from './auth/admin-credential.js';
import { createAdminSession, isValidAdminUsername, verifyAdminPassword } from './auth/admin-password.js';
import { createAdminController } from './admin-control.js';

const ACTIONS = new Set(['START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER']);
const SERVICES = new Set(['app', 'postgres', 'tor']);
const MAX_BODY = 4096;
const SESSION_TTL_MS = 30 * 60 * 1000;
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

function sameToken(provided, expectedHash) {
  if (!expectedHash || !isValidAdminToken(provided)) return false;
  const providedHash = Buffer.from(hashAdminToken(provided), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return expected.length === providedHash.length && crypto.timingSafeEqual(providedHash, expected);
}
function isLoopback(address) { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function responseHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}
async function rejectOversized(req, res) {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY) { res.writeHead(413); res.end(JSON.stringify({ error: 'request too large' })); req.resume(); return true; }
  return false;
}
async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > MAX_BODY) throw Object.assign(new Error('request too large'), { statusCode: 413 }); }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); }
}
function cookieSession(req) {
  const cookies = String(req.headers.cookie ?? '').split(';');
  const entry = cookies.find((item) => item.trim().startsWith('mercora_admin_session='));
  return entry?.trim().slice('mercora_admin_session='.length) || null;
}

export function createAdminApi({ controller, token, tokenHash, tokenFile = null, bootstrapPending = false, host = '127.0.0.1', port = 8787, username = process.env.MERCORA_ADMIN_USERNAME, passwordHash = process.env.MERCORA_ADMIN_PASSWORD_HASH } = {}) {
  const expectedHash = tokenHash ?? (token ? hashAdminToken(token) : null);
  const passwordAuthEnabled = isValidAdminUsername(username) && typeof passwordHash === 'string' && passwordHash.length >= 40;
  if (!passwordAuthEnabled && !expectedHash) throw new Error('Configure admin username/password hash or a legacy admin token');
  const control = controller ?? createAdminController();
  let canBootstrap = Boolean(tokenFile && bootstrapPending && token);
  const sessions = new Map(); const failures = new Map();
  function cleanup() { const now = Date.now(); for (const [id, expires] of sessions) if (expires <= now) sessions.delete(id); for (const [address, state] of failures) if (state.resetAt <= now) failures.delete(address); }
  const cleanupTimer = setInterval(cleanup, 60_000); cleanupTimer.unref?.();
  function sessionAuthenticated(req) {
    const session = cookieSession(req); const expires = session && sessions.get(session);
    if (!expires || expires <= Date.now()) { if (session) sessions.delete(session); return false; }
    sessions.set(session, Date.now() + SESSION_TTL_MS); return true;
  }
  function legacyAuthenticated(req) { return sameToken(req.headers.authorization?.replace(/^Bearer\s+/i, ''), expectedHash); }

  const server = http.createServer(async (req, res) => {
    responseHeaders(res);
    if (!isLoopback(req.socket.remoteAddress)) { res.writeHead(403); return res.end(JSON.stringify({ error: 'local access only' })); }
    if (await rejectOversized(req, res)) return;

    if (passwordAuthEnabled && req.method === 'POST' && req.url === '/v1/login') {
      try {
        const input = await readJson(req); const address = req.socket.remoteAddress || 'local'; const now = Date.now(); const state = failures.get(address);
        if (state && state.resetAt > now && state.count >= MAX_FAILED_LOGINS) { res.writeHead(429, { 'Retry-After': String(Math.ceil((state.resetAt - now) / 1000)) }); return res.end(JSON.stringify({ error: 'too many login attempts' })); }
        const valid = input.username === username && verifyAdminPassword(input.password, passwordHash);
        if (!valid) { const current = state && state.resetAt > now ? state : { count: 0, resetAt: now + FAILED_WINDOW_MS }; current.count += 1; failures.set(address, current); res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' })); }
        failures.delete(address); const session = createAdminSession(); sessions.set(session, now + SESSION_TTL_MS);
        res.setHeader('Set-Cookie', `mercora_admin_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
        res.writeHead(200); return res.end(JSON.stringify({ ok: true, expiresIn: SESSION_TTL_MS }));
      } catch (error) { const status = Number.isInteger(error.statusCode) ? error.statusCode : 400; res.writeHead(status); return res.end(JSON.stringify({ error: status === 413 ? 'request too large' : 'invalid request' })); }
    }
    if (req.method === 'POST' && req.url === '/v1/logout') {
      const session = cookieSession(req); if (session) sessions.delete(session); res.setHeader('Set-Cookie', 'mercora_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.writeHead(200); return res.end(JSON.stringify({ ok: true }));
    }

    const authenticated = sessionAuthenticated(req) || legacyAuthenticated(req);
    if (!authenticated) {
      if (req.method === 'POST' && req.url === '/v1/bootstrap' && canBootstrap) {
        try { const bootstrapSecret = await claimBootstrapToken(tokenFile, token); canBootstrap = false; res.writeHead(200); return res.end(JSON.stringify({ token: bootstrapSecret })); }
        catch (error) { canBootstrap = false; res.writeHead(409); return res.end(JSON.stringify({ error: String(error.message ?? 'bootstrap unavailable') })); }
      }
      res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (req.method !== 'POST' || req.url !== '/v1/control') { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })); }
    try {
      const input = await readJson(req); const action = String(input.action ?? '').toUpperCase(); const service = input.service === undefined ? undefined : String(input.service);
      if (!ACTIONS.has(action)) throw new Error('unsupported action'); if (service !== undefined && !SERVICES.has(service)) throw new Error('unsupported service');
      const result = action === 'HEALTH_CHECK' ? await control.healthCheck() : await control.run(action, service);
      res.writeHead(result.ok ? 200 : 503); return res.end(JSON.stringify(result));
    } catch (error) { const status = error?.statusCode ?? 400; res.writeHead(status); return res.end(JSON.stringify({ error: status === 413 ? 'request too large' : String(error.message ?? 'bad request') })); }
  });
  return { server, listen: () => new Promise((resolve) => server.listen(port, host, resolve)) };
}
