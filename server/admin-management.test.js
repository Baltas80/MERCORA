import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminManagement, MANAGEMENT_ACTIONS } from './admin-management.js';

function fakeRunnerFactory(){
  const calls=[];
  const runner=async(file,args)=>{
    calls.push({file,args:[...args]});
    const sql=args.at(-1);
    if(sql.includes('INSERT INTO promotion_codes')) {
      return {ok:true,code:0,stdout:JSON.stringify({
        id:'11111111-1111-4111-8111-111111111111',
        code_prefix:'MERCO123',discount_type:'percent',discount_bps:1500,
        discount_atomic:null,discount_asset:null,max_redemptions:null,
        min_order_atomic:'0',starts_at:'2026-09-21T00:00:00Z',ends_at:null,active:true
      }),stderr:''};
    }
    if(sql.includes('SELECT json_build_object')) {
      return {ok:true,code:0,stdout:'{"users":3,"active_users":2,"banned_users":1,"stores":2,"active_stores":1,"active_listings":4,"blocked_listings":1,"open_reports":2,"active_orders":3,"active_promos":1,"active_discounts":2}',stderr:''};
    }
    if(sql.includes('SELECT id,username FROM accounts')) {
      return {ok:true,code:0,stdout:'{"id":"22222222-2222-4222-8222-222222222222","username":"seller"}',stderr:''};
    }
    return {ok:true,code:0,stdout:'{"id":"11111111-1111-4111-8111-111111111111","status":"ok"}',stderr:''};
  };
  return {calls,runner};
}

test('management action surface includes core administrative modules',()=>{
  for(const action of [
    'OVERVIEW','LIST_USERS','LIST_ACCOUNT_SESSIONS','REVOKE_ACCOUNT_SESSIONS','BAN_ACCOUNT','UNBAN_ACCOUNT','LIST_STORES',
    'CREATE_STORE','ASSIGN_STORE','UNASSIGN_STORE','ASSIGN_LISTING_STORE','LIST_REPORTS','UPDATE_REPORT',
    'LIST_PROMOS','CREATE_PROMO','DISABLE_PROMO','LIST_DISCOUNTS','CREATE_DISCOUNT',
    'LIST_CATEGORIES','CREATE_CATEGORY','SITE_GET','SITE_SET','LIST_FEATURED',
    'SET_FEATURED','LIST_AUDIT'
  ]) assert.ok(MANAGEMENT_ACTIONS.includes(action),action);
});

test('invalid management actions are rejected before database execution',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  await assert.rejects(()=>management.run('DROP_DATABASE',{}),/unsupported management action/);
  assert.equal(calls.length,0);
});

test('promotion codes are validated and only their hash is persisted',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  const code='MERCORA-TEST-2026';
  const result=await management.run('CREATE_PROMO',{
    code,discount_type:'percent',discount_bps:1500,max_redemptions:10
  });
  assert.equal(result.code,code);
  const insertCall=calls.find(c=>c.args.at(-1).includes('INSERT INTO promotion_codes'));
  assert.ok(insertCall);
  assert.ok(!insertCall.args.join(' ').includes(code));
});

test('promotion rejects command injection characters',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  await assert.rejects(
    ()=>management.run('CREATE_PROMO',{code:'BAD;DROP-01',discount_type:'percent',discount_bps:500}),
    /promotion code format is invalid/
  );
  assert.equal(calls.length,0);
});

test('site mode and boolean settings are constrained',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  await assert.rejects(()=>management.run('SITE_SET',{key:'site_mode',value:'run-anything'}),/unsupported site mode/);
  await assert.rejects(()=>management.run('SITE_SET',{key:'new_listings_enabled',value:'yes'}),/must be true or false/);
  assert.equal(calls.length,0);
});

test('store owner and UUID inputs are validated',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  await assert.rejects(()=>management.run('ASSIGN_STORE',{store_id:'not-a-uuid',owner_username:'seller'}),/must contain|valid UUID/);
  await assert.rejects(()=>management.run('BAN_ACCOUNT',{account_id:'11111111-1111-4111-8111-111111111111',reason:'x'}),/reason must contain/);
  assert.equal(calls.length,0);
});

test('overview uses the fixed management query surface',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  const result=await management.run('OVERVIEW',{});
  assert.equal(result.users,3);
  assert.equal(result.open_reports,2);
  assert.ok(calls.at(-1).args.at(-1).includes('json_build_object'));
});

test('store creation uses a fixed INSERT statement and not a free-form query',async()=>{
  const {calls,runner}=fakeRunnerFactory();
  const management=createAdminManagement({runner});
  const result=await management.run('CREATE_STORE',{
    name:'Test Store',slug:'test-store',status:'draft'
  });
  assert.equal(result.id,'11111111-1111-4111-8111-111111111111');
  assert.ok(calls.some(c=>c.args.at(-1).includes('INSERT INTO mercora_stores')));
  assert.ok(calls.every(c=>c.file==='docker'));
});


test('order cancellation releases reserved listings', async()=>{
  const {runner,calls}=fakeRunner();
  const service=createAdminManagement({runner});
  const result=await service.run('UPDATE_ORDER_STATUS',{order_id:'11111111-1111-4111-8111-111111111111',status:'cancelled'});
  assert.equal(result.status,'cancelled');
  assert.ok(calls.some(call=>call.args.at(-1).includes("UPDATE listings l SET status='active'")));
});
