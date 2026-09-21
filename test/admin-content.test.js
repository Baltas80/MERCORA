import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminContent } from '../server/admin-content.js';

function fakeDb(){
  const calls=[];
  return {
    calls,
    runner: async (_file,args) => {
      calls.push(args.join(' '));
      const sql=args[args.length-1];
      if(sql.includes('SELECT COALESCE(json_object_agg')) return {ok:true,stdout:'{"announcement":"hello"}',stderr:''};
      if(sql.includes('INSERT INTO site_content_versions') && sql.includes('RETURNING json_build_object')) return {ok:true,stdout:'{"id":1,"site_key":"announcement","value":"hello","published":true,"actor":"tester","created_at":"2026-09-22T00:00:00Z"}',stderr:''};
      if(sql.includes('SELECT COALESCE(json_agg(row_to_json')) return {ok:true,stdout:'[{"id":1,"site_key":"announcement","value":"hello","published":true,"actor":"tester","created_at":"2026-09-22T00:00:00Z"}]',stderr:''};
      if(sql.includes('SELECT json_build_object') && sql.includes('site_content_versions')) return {ok:true,stdout:'{"id":1,"site_key":"announcement","value":"hello","published":true,"actor":"tester","created_at":"2026-09-22T00:00:00Z"}',stderr:''};
      return {ok:true,stdout:'',stderr:''};
    }
  };
}

test('content editor rejects HTML and unsupported keys', async()=>{
  const db=fakeDb();
  const content=createAdminContent({runner:db.runner,actor:'tester'});
  await assert.rejects(()=>content.run('UPDATE',{site_key:'announcement',value:'<script>alert(1)</script>'}),/must not contain HTML/);
  await assert.rejects(()=>content.run('UPDATE',{site_key:'unknown',value:'hello'}),/unsupported content key/);
});

test('content editor updates and lists versioned plain text', async()=>{
  const db=fakeDb();
  const content=createAdminContent({runner:db.runner,actor:'tester'});
  const updated=await content.run('UPDATE',{site_key:'announcement',value:'hello'});
  assert.equal(updated.id,1);
  const history=await content.run('LIST',{site_key:'announcement'});
  assert.equal(history[0].value,'hello');
  assert.ok(db.calls.some(sql=>sql.includes('admin_audit_log')));
});

test('only optional notices may be unpublished', async()=>{
  const db=fakeDb();
  const content=createAdminContent({runner:db.runner,actor:'tester'});
  await assert.rejects(()=>content.run('UNPUBLISH',{site_key:'hero_title'}),/only optional public notices/);
});

test('new published version supersedes the previous version', async()=>{
  const db=fakeDb();
  db.runner=async (_file,args)=>{
    db.calls.push(args.join(' '));
    const sql=args[args.length-1];
    if(sql.includes('INSERT INTO site_content_versions')&&sql.includes('RETURNING json_build_object')){
      return {ok:true,stdout:'{"id":2,"site_key":"announcement","value":"new","published":true,"actor":"tester","created_at":"2026-09-22T01:00:00Z"}',stderr:''};
    }
    if(sql.includes('SELECT COALESCE(json_object_agg')) return {ok:true,stdout:'{"announcement":"new"}',stderr:''};
    if(sql.includes('SELECT COALESCE(json_agg(row_to_json')) return {ok:true,stdout:'[{"id":2,"site_key":"announcement","value":"new","published":true,"actor":"tester","created_at":"2026-09-22T01:00:00Z"}]',stderr:''};
    return {ok:true,stdout:'',stderr:''};
  };
  const content=createAdminContent({runner:db.runner,actor:'tester'});
  const result=await content.run('UPDATE',{site_key:'announcement',value:'new'});
  assert.equal(result.id,2);
  assert.ok(db.calls.some(sql=>sql.includes('UPDATE site_content_versions SET published=false')));
});
