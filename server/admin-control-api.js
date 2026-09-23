import crypto from 'node:crypto';
import http from 'node:http';
import { claimBootstrapToken, isValidAdminToken } from './auth/admin-credential.js';
import { createAdminController } from './admin-control.js';

const ACTIONS = new Set(['START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER']);
const SERVICES = new Set(['app', 'postgres', 'tor']);
const MAX_BODY = 4096;

function sameToken(provided, expected) {
  const providedBytes = Buffer.from(String(provided ?? ''));
  const expectedBytes = Buffer.from(String(expected ?? ''));
  return providedBytes.length === expectedBytes.length && crypto.timingSafeEqual(providedBytes, expectedBytes);
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function responseHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
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

export function createAdminApi({ controller, token, tokenFile = null, bootstrapPending = false, host = '127.0.0.1', port = 8787 } = {}) {
  if (!isValidAdminToken(token)) throw new Error('MERCORA_ADMIN_TOKEN must be at least 32 characters');
  const control = controller ?? createAdminController();
  let canBootstrap = Boolean(tokenFile && bootstrapPending);

  const server = http.createServer(async (req, res) => {
    responseHeaders(res);

    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403); return res.end(JSON.stringify({ error: 'local access only' }));
    }

    if (req.method === 'POST' && req.url === '/v1/bootstrap') {
      if (await rejectOversized(req, res)) return;
      if (!canBootstrap) {
        res.writeHead(409);
        return res.end(JSON.stringify({ error: 'bootstrap unavailable' }));
      }
      try {
        const bootstrapToken = await claimBootstrapToken(tokenFile);
        canBootstrap = false;
        res.writeHead(200);
        return res.end(JSON.stringify({ token: bootstrapToken }));
      } catch (error) {
        canBootstrap = false;
        res.writeHead(409);
        return res.end(JSON.stringify({ error: String(error.message ?? 'bootstrap unavailable') }));
      }
    }

    if (!sameToken(req.headers.authorization?.replace(/^Bearer\s+/i, ''), token)) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (req.method !== 'POST' || req.url !== '/v1/control') {
      res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' }));
    }

    if (await rejectOversized(req, res)) return;

    let body = '';
    let oversized = false;
    for await (const chunk of req) {
      if (oversized) continue;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) oversized = true;
    }
    if (oversized) {
      res.writeHead(413);
      return res.end(JSON.stringify({ error: 'request too large' }));
    }

    try {
      const input = JSON.parse(body || '{}');
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
      res.writeHead(400);
      return res.end(JSON.stringify({ error: String(error.message ?? 'bad request') }));
    }
  });

  return { server, listen: () => new Promise((resolve) => server.listen(port, host, resolve)) };
}
