import http from 'node:http';
import { createAdminController } from './admin-control.js';

const ACTIONS = new Set(['START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER']);
const SERVICES = new Set(['app', 'postgres', 'tor']);
const MAX_BODY = 4096;

export function createAdminApi({ controller, token, host = '127.0.0.1', port = 8787 } = {}) {
  if (!token || token.length < 32) throw new Error('MERCORA_ADMIN_TOKEN must be at least 32 characters');
  const control = controller ?? createAdminController();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1') {
      res.writeHead(403); return res.end(JSON.stringify({ error: 'local access only' }));
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (req.method !== 'POST' || req.url !== '/v1/control') {
      res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' }));
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        res.writeHead(413); return res.end(JSON.stringify({ error: 'request too large' }));
      }
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
