import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthApi } from './api.js';

function fakeRunner(){
  const calls=[];
  const runner=async(file,args,options)=>{
    calls.push({file,args,options});
    const sql=args.at(-1);
    if(sql.includes('INSERT INTO accounts')) return {ok:true,stdout:'{"id":"11111111-1111-4111-8111-111111111111","username":"fran","status":"active","created_at":"2026-09-22T00:00:00Z"}',stderr:''};
    if(sql.includes('INSERT INTO sessions')) return {ok:true,stdout:'{"id":"22222222-2222-4222-8222-222222222222","expires_at":"2026-09-29T00:00:00Z"}',stderr:''};
    if(sql.includes('SELECT id,username,password_hash')) return {ok:true,stdout:'null',stderr:''};
    return {ok:true,stdout:'null',stderr:''};
  };
  return {runner,calls};
}

test('auth API validates usernames before database access',async()=>{
  const {runner,calls}=fakeRunner();
  const api=createAuthApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',runner});
  await assert.rejects(()=>api.register({username:'BAD NAME',password:'this-is-a-valid-password'}),/username/);
  assert.equal(calls.length,0);
});

test('auth API never puts raw password or database URL in child arguments',async()=>{
  const {runner,calls}=fakeRunner();
  const api=createAuthApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',runner});
  await api.register({username:'fran',password:'this-is-a-valid-password'});
  assert.ok(calls.length>=2);
  for(const call of calls){
    assert.ok(!call.args.join(' ').includes('postgresql://'));
    assert.ok(!call.args.join(' ').includes('this-is-a-valid-password'));
  }
  assert.equal(calls[0].options.env.PGPASSWORD,'secret');
});

test('auth cookie uses hardened browser attributes',async()=>{
  const {runner}=fakeRunner();
  const api=createAuthApi({databaseUrl:'postgresql://mercora:secret@postgres:5432/mercora',runner});
  const result=await api.register({username:'fran',password:'this-is-a-valid-password'});
  assert.match(result.session.cookie,/HttpOnly/);
  assert.match(result.session.cookie,/Secure/);
  assert.match(result.session.cookie,/SameSite=Strict/);
});
