import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createAdminController } from './admin-control.js';
import { createAdminManagement } from './admin-management.js';
import { createAdminReputation } from './admin-reputation.js';
import { createAdminSystem } from './admin-system.js';
import { createAdminEscrow } from './admin-escrow.js';
import { createAdminContent } from './admin-content.js';

const ACTIONS = new Set(['START','STOP','RESTART','STATUS','HEALTH_CHECK','RECOVER']);
const SERVICES = new Set(['app','postgres','tor']);
const MANAGEMENT_ACTIONS = new Set([
  'OVERVIEW','LIST_FEATURED','LIST_USERS','LIST_ACCOUNT_SESSIONS','REVOKE_ACCOUNT_SESSIONS','SET_ACCOUNT_STATUS','BAN_ACCOUNT','UNBAN_ACCOUNT',
  'LIST_STORES','CREATE_STORE','ASSIGN_STORE','UNASSIGN_STORE','UPDATE_STORE',
  'LIST_LISTINGS','UPDATE_LISTING_STATUS','ASSIGN_LISTING_STORE','LIST_ORDERS','UPDATE_ORDER_STATUS',
  'LIST_REPORTS','UPDATE_REPORT','LIST_PROMOS','CREATE_PROMO','DISABLE_PROMO',
  'LIST_DISCOUNTS','CREATE_DISCOUNT','DISABLE_DISCOUNT','LIST_CATEGORIES','CREATE_CATEGORY','UPDATE_CATEGORY',
  'SITE_GET','SITE_SET','SET_FEATURED','LIST_AUDIT'
]);
const REPUTATION_ACTIONS = new Set([
  'OVERVIEW','LIST_SELLER_REPUTATION','GET_SELLER_REPUTATION','LIST_SELLER_REVIEWS','MODERATE_SELLER_REVIEW','RECALCULATE_SELLER_REPUTATION'
]);
const ESCROW_ACTIONS = new Set([
  'GET_POLICY','SET_POLICY','GET_CUSTODY_STATE','SET_CUSTODY_STATE','LIST_CASES','OPEN_ESCROW',
  'AUTHORIZE_MID_RELEASE','AUTHORIZE_EARLY_PAY','AUTHORIZE_RELEASE','AUTHORIZE_REFUND','FREEZE_CASE','UNFREEZE_CASE','LIST_AUTHORIZATIONS'
]);
const SYSTEM_ACTIONS = new Set(['LOGS','METRICS','MIGRATE_DB','BACKUP_DB','LIST_BACKUPS','VERIFY_BACKUP','RESTORE_BACKUP']);
const CONTENT_ACTIONS = new Set(['CURRENT','LIST','UPDATE','UNPUBLISH','RESTORE']);
const MAX_BODY = 32 * 1024;
function localAddress(address){return address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';}
function tokenMatches(received,expected){const a=Buffer.from(String(received||''));const b=Buffer.from(String(expected||''));return a.length===b.length&&timingSafeEqual(a,b);}
function safeDiagnostic(error){
 const message=String(error?.message||'operation failed').replace(/[\r\n\t]+/g,' ').trim();
 if(!message)return 'operation failed';
 return message
  .replace(/(?:[A-Za-z]:)?[\\/](?:[^\s"']+[\\/])*[^\s"']+/g,'[path]')
  .replace(/(?:Bearer\s+|token[=:]\s*|password[=:]\s*|secret[=:]\s*)[^\s,;]+/gi,'[redacted]')
  .slice(0,500);
}
function rejectOversizedRequest(req,res){
 req.resume();
 res.writeHead(413);
 return res.end(JSON.stringify({error:'request too large'}));
}
export function createAdminApi({controller,management,reputation:reputationOverride,system:systemOverride,escrow:escrowOverride,content:contentOverride,token,host='127.0.0.1',port=8787}={}){
 if(!token||token.length<32)throw new Error('MERCORA_ADMIN_TOKEN must be at least 32 characters');
 if(!localAddress(host))throw new Error('Admin Control API must bind to localhost only');
 const control=controller??createAdminController(),manage=management??createAdminManagement(),reputation=reputationOverride??createAdminReputation(),system=systemOverride??createAdminSystem(),escrow=escrowOverride??createAdminEscrow(),content=contentOverride??createAdminContent();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  if(!localAddress(req.socket.remoteAddress)){res.writeHead(403);return res.end(JSON.stringify({error:'local access only'}));}
  const authorization=req.headers.authorization||'',provided=authorization.startsWith('Bearer ')?authorization.slice(7):'';if(!tokenMatches(provided,token)){res.writeHead(401);return res.end(JSON.stringify({error:'unauthorized'}));}
  const url=new URL(req.url||'/','http://127.0.0.1');
  if(req.method==='GET'&&url.pathname==='/v1/overview'){try{const systemState=await control.healthCheck();let managementState=null,managementError=null;try{managementState=await manage.run('OVERVIEW',{});}catch(error){managementError=safeDiagnostic(error);}let reputationState=null,reputationError=null;try{reputationState=await reputation.run('OVERVIEW',{});}catch(error){reputationError=safeDiagnostic(error);}res.writeHead(200);return res.end(JSON.stringify({system:systemState,management:managementState,managementError,reputation:reputationState,reputationError}));}catch(error){res.writeHead(503);return res.end(JSON.stringify({error:safeDiagnostic(error)}));}}
  let body='';if(req.method==='POST'){
   const contentLength=Number(req.headers['content-length']||0);
   if(Number.isFinite(contentLength)&&contentLength>MAX_BODY)return rejectOversizedRequest(req,res);
   for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>MAX_BODY)return rejectOversizedRequest(req,res);}
  }
  try{
   const input=JSON.parse(body||'{}');if(input===null||typeof input!=='object'||Array.isArray(input))throw new Error('request body must be a JSON object');
   if(req.method==='POST'&&url.pathname==='/v1/control'){const action=String(input.action||'').toUpperCase(),service=input.service===undefined?undefined:String(input.service);if(!ACTIONS.has(action))throw new Error('unsupported action');if(service!==undefined&&!SERVICES.has(service))throw new Error('unsupported service');const result=action==='HEALTH_CHECK'?await control.healthCheck():await control.run(action,service);res.writeHead(result.ok?200:503);return res.end(JSON.stringify(result));}
   if(req.method==='POST'&&url.pathname==='/v1/management'){const action=String(input.action||'').toUpperCase();if(!MANAGEMENT_ACTIONS.has(action))throw new Error('unsupported management action');const result=await manage.run(action,input.payload||{});res.writeHead(200);return res.end(JSON.stringify({ok:true,action,result}));}
   if(req.method==='POST'&&url.pathname==='/v1/reputation'){const action=String(input.action||'').toUpperCase();if(!REPUTATION_ACTIONS.has(action))throw new Error('unsupported reputation action');const result=await reputation.run(action,input.payload||{});res.writeHead(200);return res.end(JSON.stringify({ok:true,action,result}));}
   if(req.method==='POST'&&url.pathname==='/v1/escrow'){const action=String(input.action||'').toUpperCase();if(!ESCROW_ACTIONS.has(action))throw new Error('unsupported escrow action');const result=await escrow.run(action,input.payload||{});res.writeHead(200);return res.end(JSON.stringify({ok:true,action,result}));}
   if(req.method==='POST'&&url.pathname==='/v1/content'){const action=String(input.action||'').toUpperCase();if(!CONTENT_ACTIONS.has(action))throw new Error('unsupported content action');const result=await content.run(action,input.payload||{});res.writeHead(200);return res.end(JSON.stringify({ok:true,action,result}));}
   if(req.method==='POST'&&url.pathname==='/v1/system'){const action=String(input.action||'').toUpperCase(),payload=input.payload||{};if(!SYSTEM_ACTIONS.has(action))throw new Error('unsupported system action');let result;switch(action){case'LOGS':result=await system.logs(payload.service,payload.lines);break;case'METRICS':result=await system.metrics();break;case'MIGRATE_DB':result=await system.migrateDb();break;case'BACKUP_DB':result=await system.backupDb();break;case'LIST_BACKUPS':result=await system.listBackups();break;case'VERIFY_BACKUP':result=await system.verifyBackup(payload.backup_id);break;case'RESTORE_BACKUP':result=await system.restoreBackup(payload.backup_id,payload.confirm);break;default:throw new Error('unsupported system action');}res.writeHead(200);return res.end(JSON.stringify({ok:true,action,result}));}
   res.writeHead(404);return res.end(JSON.stringify({error:'not found'}));
  }catch(error){const message=String(error.message||'operation failed'),status=/JSON|request body|not found|unsupported|invalid|must contain|is not|cannot|not allowed|transition/i.test(message)?400:503;res.writeHead(status);return res.end(JSON.stringify({error:safeDiagnostic(error)}));}
 });
 return {server,listen:()=>new Promise(resolve=>server.listen(port,host,resolve))};
}
