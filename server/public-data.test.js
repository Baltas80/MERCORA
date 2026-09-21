import test from 'node:test';
import assert from 'node:assert/strict';
import { publicLimit, publicOffset, publicSearch, publicCategory, createPublicData } from './public-data.js';

test('public catalog validates pagination',()=>{
  assert.equal(publicLimit(24),24);
  assert.equal(publicLimit(undefined),24);
  assert.throws(()=>publicLimit(0),/invalid/);
  assert.throws(()=>publicLimit(49),/invalid/);
  assert.equal(publicOffset(0),0);
  assert.throws(()=>publicOffset(-1),/invalid/);
});

test('public catalog validates search and category input',()=>{
  assert.equal(publicSearch('  camera  '),'camera');
  assert.equal(publicCategory('cameras-2026'),'cameras-2026');
  assert.throws(()=>publicSearch('x'.repeat(121)),/too long/);
  assert.throws(()=>publicCategory('bad category'),/format/);
  assert.throws(()=>publicSearch('bad\0value'),/invalid/);
});

test('public data layer uses fixed SQL and never accepts caller SQL',async()=>{
  const calls=[];
  const runner=async(file,args,options)=>{
    calls.push({file,args,options});
    const sql=args.at(-1);
    if(sql.includes('FROM categories')) return {ok:true,stdout:'[]',stderr:''};
    if(sql.includes('FROM site_settings')) return {ok:true,stdout:'{}',stderr:''};
    if(sql.includes('FROM listings')) return {ok:true,stdout:'[]',stderr:''};
    if(sql.includes('FROM seller_profiles')) return {ok:true,stdout:'null',stderr:''};
    return {ok:true,stdout:'null',stderr:''};
  };
  const data=createPublicData({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',runner});
  assert.deepEqual(await data.categories(),[]);
  assert.deepEqual(await data.siteConfig(),{});
  assert.deepEqual(await data.listings({q:'camera',category:'cameras'}),[]);
  assert.equal(await data.seller('seller'),null);
  assert.ok(calls.every(call=>call.file==='psql'));
  assert.ok(calls.every(call=>call.args.includes('ON_ERROR_STOP=1')));
  assert.ok(calls.every(call=>!call.args.some(arg=>String(arg).includes('postgresql://'))));
  assert.equal(calls[0].options.env.PGPASSWORD,'secret');
  assert.ok(calls.every(call=>call.args.at(-1)!=='DROP TABLE ledger_entries'));
});
