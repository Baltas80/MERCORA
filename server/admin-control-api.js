import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createAdminController } from './admin-control.js';
import { createAdminManagement } from './admin-management.js';

const ACTIONS = new Set(['START','STOP','RESTART','STATUS','HEALTH_CHECK','RECOVER']);
const SERVICES = new Set(['app','postgres','tor']);
const MAX_BODY = 32 * 1024;

function localAddress(address){
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function tokenMatches(received, expected){
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a,b);
}

export function createAdminApi({ controller, management, token, host='127.0.0.1', port=8787 } = {}){
  if(!token || token.length < 32) throw new Error('MERCORA_ADMIN_TOKEN must be at least 32 characters');
  const control = controller ?? createAdminController();
  const manage = management ?? createAdminManagement();

  const server = http.createServer(async (req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');

    if(!localAddress(req.socket.remoteAddress)){
      res.writeHead(403); return res.end(JSON.stringify({error:'local access only'}));
    }
    const authorization = req.headers.authorization || '';
    const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if(!tokenMatches(provided,token)){
      res.writeHead(401); return res.end(JSON.stringify({error:'unauthorized'}));
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if(req.method === 'GET' && url.pathname === '/v1/overview'){
      try{
        const system = await control.healthCheck();
        let managementState = null;
        let managementError = null;
        try { managementState = await manage.run('OVERVIEW',{}); }
        catch(error){ managementError = String(error.message || 'database unavailable').slice(0,500); }
        res.writeHead(managementError ? 200 : 200);
        return res.end(JSON.stringify({system,management:managementState,managementError}));
      }catch(error){
        res.writeHead(503); return res.end(JSON.stringify({error:String(error.message || 'overview failed')}));
      }
    }

    let body = '';
    if(req.method === 'POST'){
      for await(const chunk of req){
        body += chunk;
        if(Buffer.byteLength(body) > MAX_BODY){
          res.writeHead(413); return res.end(JSON.stringify({error:'request too large'}));
        }
      }
    }

    try{
      const input = JSON.parse(body || '{}');

      if(req.method === 'POST' && url.pathname === '/v1/control'){
        const action = String(input.action || '').toUpperCase();
        const service = input.service === undefined ? undefined : String(input.service);
        if(!ACTIONS.has(action)) throw new Error('unsupported action');
        if(service !== undefined && !SERVICES.has(service)) throw new Error('unsupported service');
        const result = action === 'HEALTH_CHECK' ? await control.healthCheck() : await control.run(action,service);
        res.writeHead(result.ok ? 200 : 503);
        return res.end(JSON.stringify(result));
      }

      if(req.method === 'POST' && url.pathname === '/v1/management'){
        const action = String(input.action || '').toUpperCase();
        const result = await manage.run(action,input.payload || {});
        res.writeHead(200);
        return res.end(JSON.stringify({ok:true,action,result}));
      }

      res.writeHead(404); return res.end(JSON.stringify({error:'not found'}));
    }catch(error){
      const status = /not found|unsupported|invalid|must contain|is not|cannot|not allowed|transition/i.test(String(error.message || '')) ? 400 : 503;
      res.writeHead(status);
      return res.end(JSON.stringify({error:String(error.message || 'operation failed').slice(0,1500)}));
    }
  });

  return { server, listen:()=>new Promise((resolve)=>server.listen(port,host,resolve)) };
}
