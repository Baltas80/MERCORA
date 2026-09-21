import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApi } from './admin-control-api.js';

const token = 'x'.repeat(32);

function makeApi(overrides={}){
  return createAdminApi({
    token,
    controller:{run:async()=>({ok:true}),healthCheck:async()=>({ok:true})},
    management:{run:async(action,payload)=>({action,payload})},
    system:{logs:async()=>({ok:true}),metrics:async()=>({ok:true}),migrateDb:async()=>({ok:true}),backupDb:async()=>({ok:true,id:'backup'}),listBackups:async()=>[],verifyBackup:async()=>({ok:true}),restoreBackup:async()=>({ok:true})},
    escrow:{run:async(action,payload)=>({action,payload})},
    port:0,
    ...overrides
  });
}
async function start(api){
  await api.listen();
  return api.server.address();
}

test('admin API rejects short tokens',()=>{
  assert.throws(()=>createAdminApi({token:'short'}),/at least 32/);
});

test('admin API requires bearer authentication',async()=>{
  const api=makeApi(); const address=await start(api);
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/control',{method:'POST',body:'{}'});
  assert.equal(response.status,401);
  api.server.close();
});

test('admin API validates control service before calling controller',async()=>{
  let calls=0;
  const api=makeApi({controller:{run:async()=>{calls+=1;return{ok:true}},healthCheck:async()=>({ok:true})}});
  const address=await start(api);
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/control',{method:'POST',headers,body:JSON.stringify({action:'RESTART',service:'nope'})});
  assert.equal(response.status,400);
  assert.equal(calls,0);
  api.server.close();
});

test('overview combines system and management status',async()=>{
  const api=makeApi({
    controller:{run:async()=>({ok:true}),healthCheck:async()=>({ok:true,components:{backend:'ONLINE'}})},
    management:{run:async()=>({users:2,open_reports:1})}
  });
  const address=await start(api);
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/overview',{headers:{authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.management.users,2);
  assert.equal(body.management.open_reports,1);
  api.server.close();
});

test('management endpoint receives only explicit action and payload objects',async()=>{
  let received=null;
  const api=makeApi({management:{run:async(action,payload)=>{received={action,payload};return{saved:true}}}});
  const address=await start(api);
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/management',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({action:'SITE_SET',payload:{key:'announcement',value:'hello'}})
  });
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.result.saved,true);
  assert.deepEqual(received,{action:'SITE_SET',payload:{key:'announcement',value:'hello'}});
  api.server.close();
});

test('admin API enforces request body limit',async()=>{
  const api=makeApi(); const address=await start(api);
  const huge='x'.repeat(33*1024);
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/management',{
    method:'POST',
    headers:{authorization:'Bearer '+token},
    body:JSON.stringify({action:'LIST_USERS',payload:{q:huge}})
  });
  assert.equal(response.status,413);
  api.server.close();
});


test('system endpoint enforces its fixed action surface',async()=>{
  let calls=0;
  const api=makeApi({system:{
    logs:async(service,lines)=>{calls+=1;return{service,lines}},
    metrics:async()=>({ok:true}),migrateDb:async()=>({ok:true}),backupDb:async()=>({ok:true}),
    listBackups:async()=>[],verifyBackup:async()=>({ok:true}),restoreBackup:async()=>({ok:true})
  }});
  const address=await start(api);
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/system',{method:'POST',headers,body:JSON.stringify({
    action:'LOGS',payload:{service:'tor',lines:20}
  })});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.result,{service:'tor',lines:20});
  assert.equal(calls,1);
  api.server.close();
});

test('system endpoint rejects non-allowlisted actions',async()=>{
  let calls=0;
  const api=makeApi({system:{logs:async()=>{calls+=1},metrics:async()=>({}),migrateDb:async()=>({}),backupDb:async()=>({}),listBackups:async()=>[],verifyBackup:async()=>({}),restoreBackup:async()=>({})}});
  const address=await start(api);
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/system',{method:'POST',headers,body:JSON.stringify({action:'EXEC',payload:{command:'id'}})});
  assert.equal(response.status,400);
  assert.equal(calls,0);
  api.server.close();
});


test('escrow endpoint receives only explicit action and payload objects',async()=>{
  let received=null;
  const api=makeApi({escrow:{run:async(action,payload)=>{received={action,payload};return{authorized:true}}}});
  const address=await start(api);
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/escrow',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({action:'AUTHORIZE_EARLY_PAY',payload:{order_id:'11111111-1111-4111-8111-111111111111'}})
  });
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.result.authorized,true);
  assert.deepEqual(received,{action:'AUTHORIZE_EARLY_PAY',payload:{order_id:'11111111-1111-4111-8111-111111111111'}});
  api.server.close();
});

test('escrow endpoint rejects unknown actions',async()=>{
  let calls=0;
  const api=makeApi({escrow:{run:async()=>{calls+=1;return{}}}});
  const address=await start(api);
  const response=await fetch('http://127.0.0.1:'+address.port+'/v1/escrow',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({action:'EXEC',payload:{sql:'DROP TABLE ledger_entries'}})
  });
  assert.equal(response.status,400);
  assert.equal(calls,0);
  api.server.close();
});
