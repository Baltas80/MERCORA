import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.onion.yml'];
const SERVICES = new Set(['app', 'postgres', 'tor']);
const BACKUP_RE = /^mercora-\d{8}T\d{6}Z-[0-9a-f]{12}\.dump$/i;
const MAX_LOG_LINES = 500;
const MAX_BACKUP_BYTES = 8 * 1024 * 1024 * 1024;

function clean(text=''){
  return String(text).split(/\r?\n/)
    .filter(line => !/(password|secret|token|private.?key|mnemonic|authorization)/i.test(line))
    .join('\n').slice(0,12000);
}
function service(value){
  const v=String(value||'');
  if(!SERVICES.has(v)) throw new Error('unsupported service');
  return v;
}
export function validateBackupId(value){
  const v=String(value||'');
  if(!BACKUP_RE.test(v) || v.includes('/') || v.includes('\\')) throw new Error('invalid backup id');
  return v;
}
function logLines(value){
  const n=Number(value===undefined?100:value);
  if(!Number.isInteger(n)||n<1||n>MAX_LOG_LINES) throw new Error('lines must be 1-500');
  return n;
}
function commandResult(result){
  return {
    ok:Boolean(result?.ok),
    code:Number.isInteger(result?.code)?result.code:null,
    stdout:clean(result?.stdout),
    stderr:clean(result?.stderr)
  };
}

async function defaultRunner(file,args,options={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const out=[]; const err=[]; let total=0; const MAX=2*1024*1024;
    const collect=(target,chunk)=>{total+=chunk.length;if(total>MAX){child.kill();return;}target.push(chunk);};
    child.stdout.on('data',chunk=>collect(out,chunk));
    child.stderr.on('data',chunk=>collect(err,chunk));
    child.on('error',e=>resolve({ok:false,code:null,stdout:'',stderr:e.message}));
    child.on('close',code=>resolve({ok:code===0,code,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()}));
  });
}

async function defaultInputRunner({file,args,source,cwd}){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const out=[];const err=[];let outBytes=0;let errBytes=0;
    child.stdout.on('data',chunk=>{if(outBytes<524288){out.push(chunk);outBytes+=chunk.length}});
    child.stderr.on('data',chunk=>{if(errBytes<1048576){err.push(chunk);errBytes+=chunk.length}});
    const input=createReadStream(source,{flags:'r',mode:0o400});
    input.on('error',reject);
    child.on('error',reject);
    input.pipe(child.stdin);
    child.on('close',code=>resolve({
      ok:code===0,code,
      stdout:clean(Buffer.concat(out).toString()),
      stderr:clean(Buffer.concat(err).toString())
    }));
  });
}

export function createAdminSystem({cwd=path.resolve(process.cwd()),runner=defaultRunner,streamRunner=defaultInputRunner,backupDir=path.resolve(cwd,'backups'),audit=null,actor=process.env.MERCORA_ADMIN_ACTOR || 'admin'}={}){
  async function recordAudit(action,resourceType,resourceId,metadata){
    if(audit) await audit(action,resourceType,resourceId,metadata);
    else await runCommand(COMPOSE.concat(['exec','-T','postgres','psql','-U','mercora','-d','mercora','-v','ON_ERROR_STOP=1','-q','-c',
      'INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata) VALUES ('+
      sqlString(actor)+','+sqlString(action)+','+sqlString(resourceType)+','+sqlNullable(resourceId)+','+sqlString(JSON.stringify(metadata || {}))+'::jsonb)']));
  }
  async function runCommand(args){
    return commandResult(await runner('docker',args,{cwd}));
  }
  async function logs(value, lines){
    const target=service(value);
    const n=logLines(lines);
    return runCommand(COMPOSE.concat(['logs','--no-color','--tail',String(n),target]));
  }
  async function metrics(){
    const ps=await runCommand(COMPOSE.concat(['ps','-q']));
    if(!ps.ok) return ps;
    const ids=String(ps.stdout).split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,20);
    if(!ids.length) return {ok:true,code:0,stdout:'',stderr:''};
    return runCommand(['stats','--no-stream','--format','{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}'].concat(ids));
  }
  async function migrateDb(){
    return runCommand(COMPOSE.concat([
      'exec','-T','postgres','psql','-U','mercora','-d','mercora',
      '-v','ON_ERROR_STOP=1','-f','/docker-entrypoint-initdb.d/004_admin_management.sql'
    ]));
  }
  async function ensureBackupDir(){ await fs.mkdir(backupDir,{recursive:true,mode:0o700}); }
  async function listBackups(){
    await ensureBackupDir();
    const names=await fs.readdir(backupDir);
    const entries=[];
    for(const name of names.filter(n=>BACKUP_RE.test(n))){
      const stat=await fs.stat(path.join(backupDir,name));
      entries.push({id:name,size_bytes:stat.size,modified_at:stat.mtime.toISOString()});
    }
    return entries.sort((a,b)=>b.modified_at.localeCompare(a.modified_at));
  }
  async function backupDb(){
    await ensureBackupDir();
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const id='mercora-'+stamp+'-'+randomUUID().slice(0,12)+'.dump';
    const destination=path.join(backupDir,id);
    const child=spawn('docker',COMPOSE.concat(['exec','-T','postgres','pg_dump','-Fc','-U','mercora','-d','mercora']),{
      cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']
    });
    const output=createWriteStream(destination,{flags:'wx',mode:0o600});
    let bytes=0; const errors=[];
    child.stderr.on('data',chunk=>{if(Buffer.byteLength(errors.join(''))<65536)errors.push(chunk.toString())});
    const limiter=new Transform({
      transform(chunk,encoding,callback){
        bytes+=chunk.length;
        if(bytes>MAX_BACKUP_BYTES) return callback(new Error('backup size limit exceeded'));
        callback(null,chunk);
      }
    });
    const streamDone=new Promise((resolve,reject)=>{
      output.on('error',reject);
      limiter.on('error',reject);
      child.on('error',reject);
      child.on('close',code=>resolve(code));
    });
    child.stdout.pipe(limiter).pipe(output);
    let code;
    try { code=await streamDone; }
    catch(error){ child.kill('SIGTERM'); await new Promise(resolve=>output.end(resolve)); await fs.rm(destination,{force:true}); throw new Error(clean(error.message)); }
    await new Promise((resolve,reject)=>output.on('close',resolve).on('error',reject));
    if(code!==0 || bytes>MAX_BACKUP_BYTES){
      await fs.rm(destination,{force:true});
      throw new Error(clean(errors.join(' ')||'database backup failed'));
    }
    const stat=await fs.stat(destination);
    await recordAudit('BACKUP_DB','backup',id,{size_bytes:stat.size});
    return {ok:true,id,size_bytes:stat.size,created_at:stat.mtime.toISOString()};
  }
  async function withBackupInput(id,args){
    const safe=validateBackupId(id);
    const full=path.join(backupDir,safe);
    await fs.stat(full);
    return streamRunner({file:'docker',args,source:full,cwd});
  }
  async function verifyBackup(id){
    const result=await withBackupInput(id,COMPOSE.concat(['exec','-T','postgres','pg_restore','--list','-U','mercora']));
    return {ok:result.ok,id:validateBackupId(id),diagnostic:commandResult(result)};
  }
  async function restoreBackup(id,confirm){
    if(confirm!=='RESTORE_MERCORA') throw new Error('restore confirmation required');
    const safe=validateBackupId(id);
    await fs.stat(path.join(backupDir,safe));
    const safety=await backupDb();
    const result=await withBackupInput(safe,COMPOSE.concat([
      'exec','-T','postgres','pg_restore','--clean','--if-exists','--no-owner','-U','mercora','-d','mercora'
    ]));
    await recordAudit('RESTORE_DB','backup',safe,{pre_restore_backup:safety.id,ok:result.ok});
    return {ok:result.ok,backup_id:safe,pre_restore_backup:safety.id,diagnostic:commandResult(result)};
  }

  return Object.freeze({logs,metrics,migrateDb,backupDb,listBackups,verifyBackup,restoreBackup});
}

