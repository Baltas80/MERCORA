import path from 'node:path';
import { spawn } from 'node:child_process';

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.onion.yml'];
const ACTIONS = new Set([
  'OVERVIEW',
  'LIST_SELLER_REPUTATION',
  'GET_SELLER_REPUTATION',
  'LIST_SELLER_REVIEWS',
  'MODERATE_SELLER_REVIEW',
  'RECALCULATE_SELLER_REPUTATION'
]);
const REVIEW_STATUSES = new Set(['published','under_review','hidden']);

function assertAction(value){
  const action=String(value||'').toUpperCase();
  if(!ACTIONS.has(action)) throw new Error('unsupported reputation action');
  return action;
}
function assertString(value,name,min,max){
  if(typeof value!=='string' || value.length<min || value.length>max) throw new Error(name+' must contain '+min+'-'+max+' characters');
  if(value.includes('\0')) throw new Error(name+' contains an invalid character');
  return value;
}
function sqlString(value){ return "'" + String(value).replaceAll("'","''") + "'"; }
function sqlNullable(value){ return value===null || value===undefined ? 'NULL' : sqlString(value); }
function uuid(value,name){
  const text=assertString(value,name,36,36);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(name+' is not a valid UUID');
  return text;
}
function positiveInteger(value,name,max=1000000000){
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>max) throw new Error(name+' is invalid');
  return n;
}
function limit(value,fallback=50){return value===undefined?fallback:positiveInteger(value,'limit',100);}
function offset(value){
  const n=value===undefined?0:Number(value);
  if(!Number.isInteger(n)||n<0||n>100000) throw new Error('offset is invalid');
  return n;
}
function parseJson(stdout){
  const value=String(stdout||'').trim();
  if(!value) return null;
  try{return JSON.parse(value);}catch{throw new Error('database returned invalid JSON');}
}
function parseRow(stdout){
  const value=parseJson(stdout);
  if(!value) return null;
  return Array.isArray(value)?(value[0]||null):value;
}
function cleanError(value){
  return String(value||'').split(/\r?\n/).filter(line=>!/(password|secret|token|private.?key|mnemonic|authorization)/i.test(line)).join('\n').slice(0,1500);
}
async function defaultRunner(file,args,options){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stdout=[];const stderr=[];let total=0;const MAX=4*1024*1024;
    const push=(target,chunk)=>{total+=chunk.length;if(total>MAX){child.kill();return;}target.push(chunk);};
    child.stdout.on('data',chunk=>push(stdout,chunk));
    child.stderr.on('data',chunk=>push(stderr,chunk));
    child.on('error',error=>resolve({ok:false,code:null,stdout:'',stderr:error.message}));
    child.on('close',code=>resolve({ok:code===0,code,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
  });
}

export function createAdminReputation({cwd=path.resolve(process.cwd()),runner=defaultRunner,actor=process.env.MERCORA_ADMIN_ACTOR||'admin'}={}){
  async function db(sql){
    const result=await runner('docker',COMPOSE.concat([
      'exec','-T','postgres','psql','-U','mercora','-d','mercora',
      '-v','ON_ERROR_STOP=1','-At','-q','-c',sql
    ]),{cwd});
    if(!result.ok) throw new Error(cleanError(result.stderr||result.stdout||'database operation failed'));
    return result;
  }
  async function queryJson(sql){return parseJson((await db(sql)).stdout);}
  async function queryRow(sql){return parseRow((await db(sql)).stdout);}
  async function audit(action,resourceId,metadata){
    await db(
      'INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata) VALUES ('+
      sqlString(actor)+','+sqlString(action)+','+sqlString('seller_reputation')+','+
      sqlNullable(resourceId)+','+sqlString(JSON.stringify(metadata||{}))+'::jsonb)'
    );
  }

  async function overview(){
    return queryJson(
      "SELECT json_build_object("+
      "'sellers',(SELECT count(*) FROM seller_profiles),"+
      "'verified_sales',(SELECT COALESCE(sum(verified_sales_count),0) FROM seller_reputation),"+
      "'published_reviews',(SELECT count(*) FROM seller_ratings WHERE status='published' AND verified_purchase_at IS NOT NULL),"+
      "'under_review',(SELECT count(*) FROM seller_ratings WHERE status='under_review'),"+
      "'hidden_reviews',(SELECT count(*) FROM seller_ratings WHERE status='hidden')"+
      ")::text"
    );
  }

  async function listSellerReputation(payload){
    payload=payload||{};
    const q=assertString(String(payload.q||''),'q',0,80);
    const where=q ? "WHERE display_name ILIKE "+sqlString('%'+q+'%') : '';
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.verified_sales_count DESC,x.display_name),'[]'::json)::text FROM ("+
      "SELECT account_id,display_name,verified_sales_count,verified_units_sold,verified_rating_count,verified_rating_sum,rating_average "+
      "FROM seller_reputation "+where+
      " ORDER BY verified_sales_count DESC,display_name ASC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }

  async function getSellerReputation(payload){
    const id=uuid(payload.seller_account_id,'seller_account_id');
    const row=await queryRow("SELECT account_id,display_name,verified_sales_count,verified_units_sold,verified_rating_count,verified_rating_sum,rating_average FROM seller_reputation WHERE account_id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('seller not found');
    return row;
  }

  async function listSellerReviews(payload){
    payload=payload||{};
    const clauses=["r.verified_purchase_at IS NOT NULL"];
    if(payload.seller_account_id!==undefined && payload.seller_account_id!==null) clauses.push("r.seller_account_id="+sqlString(uuid(payload.seller_account_id,'seller_account_id'))+"::uuid");
    if(payload.status!==undefined && payload.status!==null){
      if(!REVIEW_STATUSES.has(payload.status)) throw new Error('unsupported review status');
      clauses.push("r.status="+sqlString(payload.status));
    }
    const q=assertString(String(payload.q||''),'q',0,80);
    if(q) clauses.push("(sp.display_name ILIKE "+sqlString('%'+q+'%')+" OR COALESCE(r.comment,'') ILIKE "+sqlString('%'+q+'%')+")");
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM ("+
      "SELECT r.id,r.order_id,r.seller_account_id,r.buyer_account_id,r.score,r.comment,r.status,r.verified_purchase_at,r.created_at,r.moderated_at,r.moderated_by,r.moderation_reason,sp.display_name AS seller "+
      "FROM seller_ratings r JOIN seller_profiles sp ON sp.account_id=r.seller_account_id WHERE "+clauses.join(' AND ')+
      " ORDER BY r.created_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }

  async function moderateSellerReview(payload){
    const id=uuid(payload.review_id,'review_id');
    if(!REVIEW_STATUSES.has(payload.status)) throw new Error('unsupported review status');
    const reason=payload.reason===undefined||payload.reason===null ? null : assertString(payload.reason,'reason',3,2000);
    if((payload.status==='hidden'||payload.status==='under_review')&&!reason) throw new Error('reason required for hidden or under_review review');
    const row=await queryRow("SELECT id,seller_account_id FROM seller_ratings WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('review not found');
    await db(
      "UPDATE seller_ratings SET status="+sqlString(payload.status)+
      ",moderated_at=now(),moderated_by="+sqlString(actor)+
      ",moderation_reason="+sqlNullable(reason)+
      " WHERE id="+sqlString(id)+"::uuid"
    );
    await audit('MODERATE_SELLER_REVIEW',id,{status:payload.status,reason:reason});
    return await queryRow(
      "SELECT r.id,r.order_id,r.seller_account_id,r.score,r.comment,r.status,r.verified_purchase_at,r.moderated_at,r.moderated_by,r.moderation_reason,sp.display_name AS seller "+
      "FROM seller_ratings r JOIN seller_profiles sp ON sp.account_id=r.seller_account_id WHERE r.id="+sqlString(id)+"::uuid"
    );
  }

  async function recalculateSellerReputation(payload){
    const id=payload?.seller_account_id===undefined||payload?.seller_account_id===null ? null : uuid(payload.seller_account_id,'seller_account_id');
    if(id){
      await db("SELECT mercora_refresh_seller_rating_totals("+sqlString(id)+"::uuid)");
      await audit('RECALCULATE_SELLER_REPUTATION',id,{});
      return getSellerReputation({seller_account_id:id});
    }
    await db("SELECT mercora_refresh_seller_rating_totals(account_id) FROM seller_profiles");
    await audit('RECALCULATE_SELLER_REPUTATION',null,{scope:'all'});
    return overview();
  }

  async function run(action,payload){
    switch(assertAction(action)){
      case 'OVERVIEW':return overview();
      case 'LIST_SELLER_REPUTATION':return listSellerReputation(payload);
      case 'GET_SELLER_REPUTATION':return getSellerReputation(payload);
      case 'LIST_SELLER_REVIEWS':return listSellerReviews(payload);
      case 'MODERATE_SELLER_REVIEW':return moderateSellerReview(payload);
      case 'RECALCULATE_SELLER_REPUTATION':return recalculateSellerReputation(payload);
      default:throw new Error('unsupported reputation action');
    }
  }

  return Object.freeze({run});
}

export const REPUTATION_ACTIONS=Object.freeze(Array.from(ACTIONS));
