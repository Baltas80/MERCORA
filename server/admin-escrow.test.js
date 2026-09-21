import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminEscrow, ESCROW_ADMIN_ACTIONS } from './admin-escrow.js';

function fake(){
  const calls=[];
  const runner=async(file,args)=>{
    calls.push({file,args:[...args]});
    const sql=args.at(-1);
    if(sql.includes("FROM escrow_policies")) return {ok:true,code:0,stdout:'{"id":1,"escrow_enabled":true,"mid_escrow_enabled":true,"mid_release_bps":5000,"early_pay_enabled":true,"early_pay_delay_hours":24,"early_pay_max_bps":8000,"dispute_window_hours":48,"auto_release_hours":72,"new_seller_escrow_required":true,"new_seller_hold_hours":168,"high_value_review_enabled":true,"high_value_threshold_atomic":"0","manual_release_required":false,"updated_at":"2026-09-21T18:00:00Z","updated_by":"admin"}',stderr:''};
    if(sql.includes("FROM system_state")) return {ok:true,code:0,stdout:'{"key":"custody_mode","value":"normal","updated_at":"2026-09-21T18:00:00Z"}',stderr:''};
    if(sql.includes("FROM orders o CROSS JOIN")) return {ok:true,code:0,stdout:'{"id":"11111111-1111-4111-8111-111111111111","status":"shipped","total_atomic":"100000","total_asset":"BTC","updated_at":"2026-09-20T12:00:00Z","escrow_enabled":true,"dispute_window_hours":48,"auto_release_hours":72}',stderr:''};
    if(sql.includes("SELECT order_id FROM order_escrows")) return {ok:true,code:0,stdout:'',stderr:''};
    if(sql.includes("FROM order_escrows e JOIN orders")) return {ok:true,code:0,stdout:'{"order_id":"11111111-1111-4111-8111-111111111111","asset_code":"BTC","escrowed_atomic":"100000","released_atomic":"0","refunded_atomic":"0","state":"held","order_status":"shipped","order_updated_at":"2026-09-20T12:00:00Z"}',stderr:''};
    if(sql.includes("INSERT INTO order_escrows")) return {ok:true,code:0,stdout:'{"order_id":"11111111-1111-4111-8111-111111111111","asset_code":"BTC","escrowed_atomic":"100000","released_atomic":"0","refunded_atomic":"0","state":"held","opened_at":"2026-09-21T18:00:00Z","release_available_at":"2026-09-23T12:00:00Z","dispute_until":"2026-09-22T12:00:00Z"}',stderr:''};
    if(sql.includes("INSERT INTO escrow_authorizations")) return {ok:true,code:0,stdout:'{"id":"22222222-2222-4222-8222-222222222222","order_id":"11111111-1111-4111-8111-111111111111","action":"early_pay","amount_atomic":"80000","actor":"admin","reason":"test","state":"authorized","created_at":"2026-09-21T18:00:00Z"}',stderr:''};
    return {ok:true,code:0,stdout:'{"ok":true}',stderr:''};
  };
  return {runner,calls};
}

test('escrow action surface exposes policy and settlement authorization controls',()=>{
  for(const action of ['GET_POLICY','SET_POLICY','GET_CUSTODY_STATE','SET_CUSTODY_STATE','LIST_CASES','OPEN_ESCROW','AUTHORIZE_MID_RELEASE','AUTHORIZE_EARLY_PAY','AUTHORIZE_RELEASE','AUTHORIZE_REFUND','FREEZE_CASE','UNFREEZE_CASE','LIST_AUTHORIZATIONS']){
    assert.ok(ESCROW_ADMIN_ACTIONS.includes(action),action);
  }
});
test('policy rejects invalid percentage values before SQL execution',async()=>{
  const {runner,calls}=fake(); const service=createAdminEscrow({runner});
  await assert.rejects(()=>service.run('SET_POLICY',{mid_release_bps:10000}),/out of range/);
  await assert.rejects(()=>service.run('SET_POLICY',{early_pay_max_bps:0}),/out of range/);
  assert.equal(calls.length,0);
});
test('policy returns real JSON booleans',async()=>{
  const {runner}=fake(); const service=createAdminEscrow({runner});
  const policy=await service.run('GET_POLICY',{});
  assert.equal(policy.escrow_enabled,true);
  assert.equal(policy.mid_escrow_enabled,true);
  assert.equal(policy.manual_release_required,false);
});
test('custody mode only accepts normal or frozen',async()=>{
  const {runner,calls}=fake(); const service=createAdminEscrow({runner});
  await assert.rejects(()=>service.run('SET_CUSTODY_STATE',{value:'disabled'}),/unsupported custody mode/);
  assert.equal(calls.length,0);
});
test('early pay is capped by policy and creates authorization without editing balances',async()=>{
  const {runner,calls}=fake(); const service=createAdminEscrow({runner});
  const result=await service.run('AUTHORIZE_EARLY_PAY',{order_id:'11111111-1111-4111-8111-111111111111',reason:'test'});
  assert.equal(result.action,'early_pay');
  const authSql=calls.find(c=>c.args.at(-1).includes('INSERT INTO escrow_authorizations'));
  assert.ok(authSql);
  assert.ok(authSql.args.at(-1).includes("'80000'"));
  assert.ok(!authSql.args.at(-1).includes('ledger_entries'));
});
test('unsupported escrow actions are rejected before the database',async()=>{
  const {runner,calls}=fake(); const service=createAdminEscrow({runner});
  await assert.rejects(()=>service.run('EXECUTE_ARBITRARY_SQL',{sql:'DROP TABLE ledger_entries'}),/unsupported escrow action/);
  assert.equal(calls.length,0);
});


test('policy rejects unknown keys',async()=>{
  const {runner,calls}=fake(); const service=createAdminEscrow({runner});
  await assert.rejects(()=>service.run('SET_POLICY',{drop_table:true}),/unsupported escrow policy key/);
  assert.equal(calls.length,0);
});

test('authorization amounts are returned as strings',async()=>{
  const {runner}=fake(); const service=createAdminEscrow({runner});
  const result=await service.run('AUTHORIZE_EARLY_PAY',{
    order_id:'11111111-1111-4111-8111-111111111111',
    idempotency_key:'22222222-2222-4222-8222-222222222222',
    reason:'precision'
  });
  assert.equal(typeof result.amount_atomic,'string');
  assert.equal(result.amount_atomic,'80000');
});

test('custody state can be switched only between normal and frozen',async()=>{
  const {runner}=fake(); const service=createAdminEscrow({runner});
  const result=await service.run('SET_CUSTODY_STATE',{value:'frozen',reason:'test'});
  assert.equal(result.value,'normal');
  assert.equal(result.key,'custody_mode');
});


test('open escrow derives release deadlines from the order timestamp',async()=>{
  const {runner,calls}=fake();
  const service=createAdminEscrow({runner});
  const result=await service.run('OPEN_ESCROW',{order_id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(result.asset_code,'BTC');
  assert.equal(result.escrowed_atomic,'100000');
  const insert=calls.find(c=>c.args.at(-1).includes('INSERT INTO order_escrows'));
  assert.ok(insert);
  assert.ok(insert.args.at(-1).includes("2026-09-20T12:00:00Z"));
  assert.ok(insert.args.at(-1).includes('make_interval(hours=>72)'));
  assert.ok(insert.args.at(-1).includes('make_interval(hours=>48)'));
});
