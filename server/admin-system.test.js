import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createAdminSystem } from './admin-system.js';

function fakeRunnerFactory(){
  const calls=[];
  const runner=async(file,args)=>{
    calls.push({file,args:[...args]});
    if(args.includes('psql') && args.includes('-f')) return {ok:true,code:0,stdout:'migration ok',stderr:''};
    if(args[0]==='stats') return {ok:true,code:0,stdout:'mercora-app|1.0%|32MiB / 1GiB|3%',stderr:''};
    if(args.includes('logs')) return {ok:true,code:0,stdout:'safe log line',stderr:''};
    if(args.includes('ps')) return {ok:true,code:0,stdout:'abc123\\ndef456',stderr:''};
    return {ok:true,code:0,stdout:'',stderr:''};
  };
  return {runner,calls};
}

test('logs only accepts the fixed service allowlist',async()=>{
  const {runner,calls}=fakeRunnerFactory();
  const system=createAdminSystem({runner});
  const result=await system.logs('tor',25);
  assert.equal(result.stdout,'safe log line');
  assert.ok(calls.at(-1).args.includes('tor'));
  await assert.rejects(()=>system.logs('bash',25),/unsupported service/);
  assert.equal(calls.length,1);
});

test('metrics uses compose IDs and a fixed docker stats format',async()=>{
  const {runner,calls}=fakeRunnerFactory();
  const system=createAdminSystem({runner});
  const result=await system.metrics();
  assert.equal(result.stdout,'mercora-app|1.0%|32MiB / 1GiB|3%');
  assert.equal(calls[0].args.at(-2),'ps');
  assert.equal(calls[1].args[0],'stats');
  assert.ok(calls[1].args.includes('--no-stream'));
});

test('database migration is fixed to the committed management migration',async()=>{
  const {runner,calls}=fakeRunnerFactory();
  const system=createAdminSystem({runner});
  const result=await system.migrateDb();
  assert.equal(result.ok,true);
  const args=calls.at(-1).args;
  assert.ok(args.includes('/docker-entrypoint-initdb.d/004_admin_management.sql'));
  assert.ok(args.includes('/docker-entrypoint-initdb.d/005_escrow.sql'));
});

test('backup identifiers cannot escape the managed backup directory',async()=>{
  const system=createAdminSystem({runner:async()=>({ok:true,code:0,stdout:'',stderr:''})});
  await assert.rejects(()=>system.verifyBackup('../secrets.dump'),/invalid backup id/);
  await assert.rejects(()=>system.verifyBackup('anything.dump'),/invalid backup id/);
});

test('verify backup accepts only managed files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-admin-'));
  const id='mercora-20260921T171000Z-abcdef123456.dump';
  await fs.writeFile(path.join(dir,id),'placeholder');
  const {runner,calls}=fakeRunnerFactory();
  const streamCalls=[];
  const system=createAdminSystem({
    runner,
    backupDir:dir,
    streamRunner:async(args)=>{streamCalls.push(args);return{ok:true,code:0,stdout:'archive valid',stderr:''}}
  });
  const result=await system.verifyBackup(id);
  assert.equal(result.id,id);
  assert.equal(result.ok,true);
  assert.equal(calls.length,0);
  assert.equal(streamCalls.length,1);
  assert.equal(streamCalls[0].file,'docker');
  await fs.rm(dir,{recursive:true,force:true});
});

test('verify backup rejects symlinked backup files outside the managed directory',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-admin-'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-outside-'));
  const id='mercora-20260921T171000Z-abcdef123456.dump';
  const target=path.join(outside,'outside.dump');
  await fs.writeFile(target,'sensitive');
  await fs.symlink(target,path.join(dir,id));
  const system=createAdminSystem({
    backupDir:dir,
    runner:async()=>({ok:true,code:0,stdout:'',stderr:''}),
    streamRunner:async()=>{throw new Error('stream should not be called')}
  });
  await assert.rejects(()=>system.verifyBackup(id),/invalid backup path/);
  await fs.rm(dir,{recursive:true,force:true});
  await fs.rm(outside,{recursive:true,force:true});
});

test('restore requires an explicit confirmation phrase',async()=>{
  const system=createAdminSystem();
  await assert.rejects(()=>system.restoreBackup('mercora-20260921T171000Z-abcdef123456.dump','YES'),/restore confirmation required/);
});

test('restore rejects symlinked backup before stopping the backend',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-admin-'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-outside-'));
  const id='mercora-20260921T171000Z-abcdef123456.dump';
  const target=path.join(outside,'outside.dump');
  await fs.writeFile(target,'sensitive');
  await fs.symlink(target,path.join(dir,id));
  let calls=0;
  const system=createAdminSystem({
    backupDir:dir,
    runner:async()=>{calls+=1;return{ok:true,code:0,stdout:'',stderr:''}}
  });
  await assert.rejects(()=>system.restoreBackup(id,'RESTORE_MERCORA'),/invalid backup path/);
  assert.equal(calls,0);
  await fs.rm(dir,{recursive:true,force:true});
  await fs.rm(outside,{recursive:true,force:true});
});

test('restore stops the backend before the safety backup and always starts it afterwards',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-admin-'));
  const id='mercora-20260921T171000Z-abcdef123456.dump';
  await fs.writeFile(path.join(dir,id),'placeholder');
  const events=[];
  const runner=async(file,args)=>{
    if(args.includes('stop')) events.push('stop');
    if(args.includes('start')) events.push('start');
    return {ok:true,code:0,stdout:'',stderr:''};
  };
  const system=createAdminSystem({
    backupDir:dir,
    runner,
    backupRunner:async()=>{events.push('safety-backup');return{id:'mercora-safety.dump',size_bytes:1};},
    streamRunner:async()=>{events.push('restore');return{ok:true,code:0,stdout:'restore ok',stderr:''}},
    audit:async()=>{events.push('audit')}
  });
  const result=await system.restoreBackup(id,'RESTORE_MERCORA');
  assert.equal(result.ok,true);
  assert.equal(result.pre_restore_backup,'mercora-safety.dump');
  assert.deepEqual(events,['stop','safety-backup','restore','start','audit']);
  await fs.rm(dir,{recursive:true,force:true});
});

test('restore starts the backend again when pg_restore fails',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mercora-admin-'));
  const id='mercora-20260921T171000Z-abcdef123456.dump';
  await fs.writeFile(path.join(dir,id),'placeholder');
  const events=[];
  const system=createAdminSystem({
    backupDir:dir,
    runner:async(file,args)=>{
      if(args.includes('stop')) events.push('stop');
      if(args.includes('start')) events.push('start');
      return {ok:true,code:0,stdout:'',stderr:''};
    },
    backupRunner:async()=>{events.push('safety-backup');return{id:'mercora-safety.dump'};},
    streamRunner:async()=>{events.push('restore');return{ok:false,code:1,stdout:'',stderr:'restore failed'}},
    audit:async()=>{events.push('audit')}
  });
  const result=await system.restoreBackup(id,'RESTORE_MERCORA');
  assert.equal(result.ok,false);
  assert.equal(result.backend_restart.ok,true);
  assert.deepEqual(events,['stop','safety-backup','restore','start','audit']);
  await fs.rm(dir,{recursive:true,force:true});
});
