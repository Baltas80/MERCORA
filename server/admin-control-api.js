import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createAdminController } from './admin-control.js';
import { createAdminManagement } from './admin-management.js';
import { createAdminReputation } from './admin-reputation.js';
import { createAdminSystem } from './admin-system.js';
import { createAdminEscrow } from './admin-escrow.js';

const ACTIONS = new Set(['START','STOP','RESTART','STATUS','HEALTH_CHECK','RECOVER']);
const SERVICES = new Set(['app','postgres','tor']);
const MAX_BODY = 32 * 1024;
const SYSTEM_ACTIONS = new Set(['LOGS','METRICS','MIGRATE_DB','BACKUP_DB','LIST_BACKUPS','VERIFY_BACKUP','RESTORE_BACKUP']);

function localAddress(address){
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function tokenMatches(received, expected){
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a,b);
}

export function createAdminApi({ controller, management, reputation: reputationOverride, system: systemOverride, escrow: escrowOverride, token, host='127.0.0.1', port=8787 } = {}){
  if(!token || token.length < 32) throw new Error('MERCORA_ADMIN_TOKEN must be at least 32 characters');
  const control = controller ?? createAdminController();
  const manage = management ?? createAdminManagement();
  const reputation = reputationOverride ?? createAdminReputation();
  const system = systemOverride ?? createAdminSystem();
  const escrow = escrowOverride ?? createAdminEscrow();

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
        let reputationState = null;
        let reputationError = null;
        try { reputationState = await reputation.run('OVERVIEW',{}); }
        catch(error){ reputationError = String(error.message || 'reputation database unavailable').slice(0,500); }
        res.writeHead(200);
        return res.end(JSON.stringify({system,management:managementState,managementError,reputation:reputationState,reputationError}));
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

      if(req.method === 'POST' && url.pathname === '/v1/reputation'){
        const action = String(input.action || '').toUpperCase();
        const result = await reputation.run(action,input.payload || {});
        res.writeHead(200);
        return res.end(JSON.stringify({ok:true,action,result}));
      }

      if(req.method === 'POST' && url.pathname === '/v1/escrow'){
        const action = String(input.action || '').toUpperCase();
        const result = await escrow.run(action,input.payload || {});
        res.writeHead(200);
        return res.end(JSON.stringify({ok:true,action,result}));
      }

      if(req.method === 'POST' && url.pathname === '/v1/system'){
        const action = String(input.action || '').toUpperCase();
        const payload = input.payload || {};
        if(!SYSTEM_ACTIONS.has(action)) throw new Error('unsupported system action');
        let result;
        switch(action){
          case 'LOGS': result=await system.logs(payload.service,payload.lines); break;
          case 'METRICS': result=await system.metrics(); break;
          case 'MIGRATE_DB': result=await system.migrateDb(); break;
          case 'BACKUP_DB': result=await system.backupDb(); break;
          case 'LIST_BACKUPS': result=await system.listBackups(); break;
          case 'VERIFY_BACKUP': result=await system.verifyBackup(payload.backup_id); break;
          case 'RESTORE_BACKUP': result=await system.restoreBackup(payload.backup_id,payload.confirm); break;
          default: throw new Error('unsupported system action');
        }
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
