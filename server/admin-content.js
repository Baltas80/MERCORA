import path from 'node:path';
import { spawn } from 'node:child_process';

const COMPOSE = ['compose','-f','docker-compose.yml','-f','docker-compose.onion.yml'];
const KEYS = new Set(['site_name','announcement','maintenance_message','footer_notice','hero_title','hero_copy','buy_cta','sell_cta','terms_of_use','privacy_notice','publication_rules']);
const MAX_VALUE = 6000;
const KEY_LIMITS = Object.freeze({
  site_name: 120,
  announcement: 4000,
  maintenance_message: 4000,
  footer_notice: 4000,
  hero_title: 180,
  hero_copy: 600,
  buy_cta: 80,
  sell_cta: 80,
  terms_of_use: 6000,
  privacy_notice: 6000,
  publication_rules: 6000
});
const OPTIONAL_NOTICE_KEYS = new Set(['announcement','maintenance_message','footer_notice']);

function assertKey(value){
  const key=String(value||'');
  if(!KEYS.has(key)) throw new Error('unsupported content key');
  return key;
}
function assertText(value,name='value'){
  if(typeof value!=='string') throw new Error(name+' must be text');
  const keyLimit=KEY_LIMITS[name]??MAX_VALUE;
  if(value.length>keyLimit) throw new Error(name+' must not exceed '+keyLimit+' characters');
  if(value.includes('\0')) throw new Error(name+' contains an invalid character');
  if(/<\/?[a-z][^>]*>/i.test(value) || /javascript\s*:/i.test(value)) throw new Error(name+' must not contain HTML or javascript');
  return value;
}
function id(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n) || n<1) throw new Error('version_id is invalid');
  return n;
}
function cleanError(text){
  return String(text||'').split(/\r?\n/).filter(line=>!/(password|secret|token|private.?key|mnemonic|authorization)/i.test(line)).join('\n').slice(0,1500);
}
async function defaultRunner(file,args,options={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const out=[];const err=[];
    child.stdout.on('data',c=>out.push(c));child.stderr.on('data',c=>err.push(c));
    child.on('error',e=>resolve({ok:false,code:null,stdout:'',stderr:e.message}));
    child.on('close',code=>resolve({ok:code===0,code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')}));
  });
}

export function createAdminContent({cwd=path.resolve(process.cwd()),runner=defaultRunner,actor=process.env.MERCORA_ADMIN_ACTOR||'admin'}={}){
  async function db(sql){
    const result=await runner('docker',COMPOSE.concat(['exec','-T','postgres','psql','-U','mercora','-d','mercora','-v','ON_ERROR_STOP=1','-At','-q','-c',sql]),{cwd});
    if(!result.ok) throw new Error(cleanError(result.stderr||result.stdout||'database operation failed'));
    return result.stdout;
  }
  function sql(value){return "'"+String(value).replaceAll("'","''")+"'";}
  function json(stdout){try{return JSON.parse(String(stdout||'').trim()||'null')}catch{throw new Error('database returned invalid JSON')}}
  async function audit(action,resourceId,metadata={}){
    await db(`INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata) VALUES (${sql(actor)},${sql(action)},'site_content',${resourceId===null?'NULL':sql(resourceId)},${sql(JSON.stringify(metadata))}::jsonb)`);
  }
  async function list(payload={}){
    const key=payload.site_key===undefined?null:assertKey(payload.site_key);
    const where=key?`WHERE site_key=${sql(key)}`:'';
    return json(await db(`SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM (SELECT id,site_key,value,published,actor,created_at FROM site_content_versions ${where} ORDER BY created_at DESC LIMIT 200) x`));
  }
  async function current(){
    return json(await db("SELECT COALESCE(json_object_agg(key,value),'{}'::json)::text FROM site_settings WHERE key IN ('site_name','announcement','maintenance_message','footer_notice','hero_title','hero_copy','buy_cta','sell_cta','terms_of_use','privacy_notice','publication_rules')"));
  }
  async function update(payload={}){
    const key=assertKey(payload.site_key);
    const value=assertText(payload.value,key);
    if(!value.trim() && !OPTIONAL_NOTICE_KEYS.has(key)) throw new Error(key+' cannot be empty');
    const result=json(await db(
      'BEGIN;'+
      `INSERT INTO site_settings(key,value,updated_at,updated_by) VALUES (${sql(key)},${sql(value)},now(),${sql(actor)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(),updated_by=EXCLUDED.updated_by;`+
      `WITH revoked AS (UPDATE site_content_versions SET published=false WHERE site_key=${sql(key)} AND published=true),
        inserted AS (
          INSERT INTO site_content_versions(site_key,value,published,actor)
          VALUES (${sql(key)},${sql(value)},true,${sql(actor)})
          RETURNING id,site_key,value,published,actor,created_at
        ),
        audited AS (
          INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata)
          SELECT ${sql(actor)},'UPDATE_SITE_CONTENT','site_content',id,${sql('{"site_key":"'+key+'"}')}::jsonb FROM inserted
          RETURNING id
        )
        SELECT row_to_json(inserted) FROM inserted;`+
      'COMMIT;'
    ));
    const row=Array.isArray(result)?result.find(v=>v&&v.id):result;
    return row;
  }
  async function unpublish(payload={}){
    const key=assertKey(payload.site_key);
    if(!OPTIONAL_NOTICE_KEYS.has(key)) throw new Error('only optional public notices can be unpublished');
    await db('BEGIN;'+`WITH revoked AS (
        UPDATE site_content_versions SET published=false WHERE site_key=${sql(key)} AND published=true
      ), cleared AS (
        UPDATE site_settings SET value='',updated_at=now(),updated_by=${sql(actor)} WHERE key=${sql(key)}
      )
      INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata)
      VALUES (${sql(actor)},'UNPUBLISH_SITE_CONTENT','site_content',${sql(key)},${sql('{"site_key":"'+key+'"}')}::jsonb);`+'COMMIT;');
    return {site_key:key,published:false};
  }
  async function restore(payload={}){
    const version=id(payload.version_id);
    const row=json(await db(`SELECT json_build_object('id',id,'site_key',site_key,'value',value,'published',published,'actor',actor,'created_at',created_at)::text FROM site_content_versions WHERE id=${version}`));
    if(!row) throw new Error('content version not found');
    const value=assertText(row.value);
    const key=assertKey(row.site_key);
    await db('BEGIN;'+
      `UPDATE site_settings SET value=${sql(value)},updated_at=now(),updated_by=${sql(actor)} WHERE key=${sql(key)};`+
      `WITH revoked AS (
        UPDATE site_content_versions SET published=false WHERE site_key=${sql(key)} AND published=true
      ), inserted AS (
        INSERT INTO site_content_versions(site_key,value,published,actor)
        VALUES (${sql(key)},${sql(value)},true,${sql(actor)})
        RETURNING id,site_key,value,published,actor,created_at
      )
      INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata)
      SELECT ${sql(actor)},'RESTORE_SITE_CONTENT','site_content',id,${sql('{"site_key":"'+key+'","source_version_id":'+String(version)+'}')}::jsonb
      FROM inserted;`+
      'COMMIT;'
    );
    return {site_key:key,value,published:true,restored_from:version};
  }
  async function run(action,payload={}){
    const a=String(action||'').toUpperCase();
    if(a==='CURRENT') return current();
    if(a==='LIST') return list(payload);
    if(a==='UPDATE') return update(payload);
    if(a==='UNPUBLISH') return unpublish(payload);
    if(a==='RESTORE') return restore(payload);
    throw new Error('unsupported content action');
  }
  return Object.freeze({run});
}
