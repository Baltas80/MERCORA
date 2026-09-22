import test from 'node:test';
import assert from 'node:assert/strict';
import { createSellerApi } from './api.js';

function fakeRunner(){
  const calls=[];
  const runner=async(file,args,options)=>{
    calls.push({file,args,options});
    const sql=args.at(-1);
    if(sql.includes("FROM site_settings"))return{ok:true,stdout:'[{"key":"seller_registration_enabled","value":"true"},{"key":"new_listings_enabled","value":"true"}]',stderr:''};
    if(sql.includes("FROM accounts WHERE id"))return{ok:true,stdout:'{"id":"11111111-1111-4111-8111-111111111111","status":"active"}',stderr:''};
    if(sql.includes("FROM mercora_stores WHERE id"))return{ok:true,stdout:'{"id":"22222222-2222-4222-8222-222222222222","status":"active"}',stderr:''};
    if(sql.includes("FROM categories WHERE slug"))return{ok:true,stdout:'{"id":"33333333-3333-4333-8333-333333333333"}',stderr:''};
    if(sql.includes("INSERT INTO mercora_stores"))return{ok:true,stdout:'{"id":"22222222-2222-4222-8222-222222222222","slug":"my-store","name":"My Store","status":"active","owner_account_id":"11111111-1111-4111-8111-111111111111"}',stderr:''};
    if(sql.includes("INSERT INTO listings"))return{ok:true,stdout:'{"id":"44444444-4444-4444-8444-444444444444","title":"Camera","price_atomic":"100000","price_asset":"BTC","status":"active"}',stderr:''};
    if(sql.includes("UPDATE listings SET status"))return{ok:true,stdout:'{"id":"44444444-4444-4444-8444-444444444444","title":"Camera","status":"archived"}',stderr:''};
    return{ok:true,stdout:'[]',stderr:''};
  };
  return{runner,calls};
}

const ACCOUNT='11111111-1111-4111-8111-111111111111';

test('seller rejects invalid account identifiers before database access',async()=>{const {runner,calls}=fakeRunner();const api=createSellerApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',run:runner});await assert.rejects(()=>api.current('not-a-uuid'),/36-36|valid UUID/);assert.equal(calls.length,0);});
test('seller API keeps database URL out of child arguments',async()=>{const {runner,calls}=fakeRunner();const api=createSellerApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',run:runner});await api.current(ACCOUNT);assert.ok(calls.length>=1);assert.ok(calls.every(c=>!c.args.join(' ').includes('postgresql://')));assert.ok(calls.every(c=>c.args.at(-1)!=='DROP TABLE listings'));assert.equal(calls[0].options.env.PGPASSWORD,'secret');});
test('listing creation rejects unsupported assets before INSERT',async()=>{const {runner,calls}=fakeRunner();const api=createSellerApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',run:runner});await assert.rejects(()=>api.createListing(ACCOUNT,{store_id:'22222222-2222-4222-8222-222222222222',category_slug:'cameras',title:'Camera',description:'Test',condition:'used',price_atomic:'100000',price_asset:'ETH',}),/unsupported price asset/);assert.equal(calls.filter(c=>c.args.at(-1).includes('INSERT INTO listings')).length,0);});
test('listing status changes are limited to owner and safe states',async()=>{const {runner,calls}=fakeRunner();const api=createSellerApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',run:runner});const result=await api.updateListingStatus(ACCOUNT,'44444444-4444-4444-8444-444444444444','archived');assert.equal(result.status,'archived');assert.ok(calls.some(c=>c.args.at(-1).includes('UPDATE listings SET status')));});
test('seller registration switch is enforced before store creation',async()=>{const {runner,calls}=fakeRunner();const api=createSellerApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',run:async(...args)=>{if(String(args[1]?.at?.(-1)).includes('seller_registration_enabled'))return{ok:true,stdout:'[{"key":"seller_registration_enabled","value":"false"}]',stderr:''};return runner(...args);}});await assert.rejects(()=>api.createStore(ACCOUNT,{slug:'my-store',name:'My Store'}),/seller registration is disabled/);assert.equal(calls.length,0);});
test('new listings switch is enforced before listing creation',async()=>{const {runner,calls}=fakeRunner();const api=createSellerApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',run:async(...args)=>{if(String(args[1]?.at?.(-1)).includes('new_listings_enabled'))return{ok:true,stdout:'[{"key":"new_listings_enabled","value":"false"}]',stderr:''};return runner(...args);}});await assert.rejects(()=>api.createListing(ACCOUNT,{store_id:'22222222-2222-4222-8222-222222222222',category_slug:'cameras',title:'Camera',description:'Test',condition:'used',price_atomic:'100000',price_asset:'BTC'}),/new listings are disabled/);assert.equal(calls.filter(c=>c.args.at(-1).includes('INSERT INTO listings')).length,0);});
