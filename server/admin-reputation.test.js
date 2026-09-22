import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminReputation, REPUTATION_ACTIONS } from './admin-reputation.js';

function fakeRunnerFactory(){
  const calls=[];
  const runner=async(file,args)=>{
    calls.push({file,args:[...args]});
    const sql=args.at(-1);
    if(sql.includes("json_build_object")) return {ok:true,code:0,stdout:'{"sellers":2,"verified_sales":17,"published_reviews":9,"under_review":1,"hidden_reviews":2}',stderr:''};
    if(sql.includes("FROM seller_reputation")) return {ok:true,code:0,stdout:'{"account_id":"11111111-1111-4111-8111-111111111111","display_name":"Seller One","verified_sales_count":"12","verified_units_sold":"13","verified_rating_count":"9","verified_rating_sum":"45","rating_average":5}',stderr:''};
    return {ok:true,code:0,stdout:'{"id":"11111111-1111-4111-8111-111111111111","status":"ok"}',stderr:''};
  };
  return {calls,runner};
}

test('reputation action surface is explicit',()=>{for(const action of ['OVERVIEW','LIST_SELLER_REPUTATION','GET_SELLER_REPUTATION','LIST_SELLER_REVIEWS','MODERATE_SELLER_REVIEW','RECALCULATE_SELLER_REPUTATION']) assert.ok(REPUTATION_ACTIONS.includes(action),action);});
test('invalid actions are rejected before database execution',async()=>{const {calls,runner}=fakeRunnerFactory();const manager=createAdminReputation({runner});await assert.rejects(()=>manager.run('DROP_TABLE',{}),/unsupported reputation action/);assert.equal(calls.length,0);});
test('seller lookup validates UUID',async()=>{const {calls,runner}=fakeRunnerFactory();const manager=createAdminReputation({runner});await assert.rejects(()=>manager.run('GET_SELLER_REPUTATION',{seller_account_id:'bad'}),/36-36|valid UUID/);assert.equal(calls.length,0);});
test('review moderation requires a reason for hidden state',async()=>{const {calls,runner}=fakeRunnerFactory();const manager=createAdminReputation({runner});await assert.rejects(()=>manager.run('MODERATE_SELLER_REVIEW',{review_id:'11111111-1111-4111-8111-111111111111',status:'hidden'}),/reason required/);assert.equal(calls.length,0);});
test('review status is allow-listed',async()=>{const {calls,runner}=fakeRunnerFactory();const manager=createAdminReputation({runner});await assert.rejects(()=>manager.run('MODERATE_SELLER_REVIEW',{review_id:'11111111-1111-4111-8111-111111111111',status:'visible'}),/unsupported review status/);assert.equal(calls.length,0);});
test('reputation lookup returns sales as strings without JS numeric conversion',async()=>{const {runner}=fakeRunnerFactory();const manager=createAdminReputation({runner});const result=await manager.run('GET_SELLER_REPUTATION',{seller_account_id:'11111111-1111-4111-8111-111111111111'});assert.equal(result.verified_sales_count,'12');assert.equal(result.verified_units_sold,'13');});
test('free-form SQL is not exposed through the manager',async()=>{const {calls,runner}=fakeRunnerFactory();const manager=createAdminReputation({runner});await manager.run('OVERVIEW',{});assert.ok(calls.at(-1).args.at(-1).includes("json_build_object"));});
