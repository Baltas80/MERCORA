import test from "node:test";
import assert from "node:assert/strict";
import { createOrderApi } from "./api.js";

const ACCOUNT="11111111-1111-4111-8111-111111111111";
const LISTING="22222222-2222-4222-8222-222222222222";

function fakeRunner(){
  const calls=[];
  const runner=async(file,args,options)=>{
    calls.push({file,args,options});
    const sql=args.at(-1);
    if(sql.includes("site_settings"))return{ok:true,stdout:'{"value":"public"}',stderr:""};
    if(sql.includes("WITH selected"))return{ok:true,stdout:'{"id":"33333333-3333-4333-8333-333333333333","buyer_account_id":"11111111-1111-4111-8111-111111111111","status":"awaiting_payment","total_atomic":"100000","total_asset":"BTC"}',stderr:""};
    if(sql.includes("FROM orders"))return{ok:true,stdout:"[]",stderr:""};
    return{ok:true,stdout:"null",stderr:""};
  };
  return{runner,calls};
}

test("order rejects invalid account id before database",async()=>{
  const {runner,calls}=fakeRunner();
  const api=createOrderApi({databaseUrl:"postgresql://u:p@db/mercora",run:runner});
  await assert.rejects(()=>api.createOrder("bad",{items:[{listing_id:LISTING}]}),/valid UUID/);
  assert.equal(calls.length,0);
});

test("order keeps database connection URL out of child arguments",async()=>{
  const {runner,calls}=fakeRunner();
  const api=createOrderApi({databaseUrl:"postgresql://u:p@db/mercora",run:runner});
  const result=await api.createOrder(ACCOUNT,{items:[{listing_id:LISTING}]});
  assert.equal(result.status,"awaiting_payment");
  assert.ok(calls.every(call=>!call.args.join(" ").includes("postgresql://")));
  assert.equal(calls[0].options.env.PGPASSWORD,"p");
});

test("order SQL requires active listings and one payment asset",async()=>{
  const {runner,calls}=fakeRunner();
  const api=createOrderApi({databaseUrl:"postgresql://u:p@db/mercora",run:runner});
  await api.createOrder(ACCOUNT,{items:[{listing_id:LISTING}]});
  const sql=calls.find(c=>c.args.at(-1).includes("WITH selected")).args.at(-1);
  assert.ok(sql.includes("l.status='active'"));
  assert.ok(sql.includes("COUNT(DISTINCT price_asset) AS asset_count"));
  assert.ok(sql.includes("e.asset_count=1"));
});

test("order rejects quantity above one because listings are single-item inventory",async()=>{
  const {runner,calls}=fakeRunner();
  const api=createOrderApi({databaseUrl:"postgresql://u:p@db/mercora",run:runner});
  await assert.rejects(()=>api.createOrder(ACCOUNT,{items:[{listing_id:LISTING,quantity:2}]}),/must be 1/);
  assert.equal(calls.length,1);
});

test("order creation is blocked outside public site mode",async()=>{
  const calls=[];
  const runner=async(file,args,options)=>{
    calls.push({file,args,options});
    if(args.at(-1).includes("site_settings"))return{ok:true,stdout:'{"value":"maintenance"}',stderr:""};
    return{ok:true,stdout:"null",stderr:""};
  };
  const api=createOrderApi({databaseUrl:"postgresql://u:p@db/mercora",run:runner});
  await assert.rejects(()=>api.createOrder(ACCOUNT,{items:[{listing_id:LISTING}]}),/orders are disabled/);
  assert.equal(calls.length,1);
});
