import path from 'node:path';
import { spawn } from 'node:child_process';

const COMPOSE = ['compose','-f','docker-compose.yml','-f','docker-compose.onion.yml'];
const ACTIONS = new Set([
  'GET_POLICY','SET_POLICY','GET_CUSTODY_STATE','SET_CUSTODY_STATE','LIST_CASES','OPEN_ESCROW',
  'AUTHORIZE_MID_RELEASE','AUTHORIZE_EARLY_PAY','AUTHORIZE_RELEASE',
  'AUTHORIZE_REFUND','FREEZE_CASE','UNFREEZE_CASE','LIST_AUTHORIZATIONS'
]);
const POLICY_KEYS = new Set([
  'escrow_enabled','mid_escrow_enabled','mid_release_bps','early_pay_enabled',
  'early_pay_delay_hours','early_pay_max_bps','dispute_window_hours',
  'auto_release_hours','new_seller_escrow_required','new_seller_hold_hours',
  'high_value_review_enabled','high_value_threshold_atomic','manual_release_required'
]);
const BOOL_KEYS = new Set([
  'escrow_enabled','mid_escrow_enabled','early_pay_enabled',
  'new_seller_escrow_required','high_value_review_enabled','manual_release_required'
]);
const BPS_KEYS = new Set(['mid_release_bps','early_pay_max_bps']);
const HOURS_KEYS = new Set([
  'early_pay_delay_hours','dispute_window_hours','auto_release_hours','new_seller_hold_hours'
]);
const CASE_STATES = new Set([
  'pending','held','mid_release_authorized','early_pay_authorized',
  'release_authorized','refund_authorized','disputed','frozen','completed'
]);

function uuid(value,name){
  const text=String(value||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(name+' is not a valid UUID');
  return text;
}
function bool(value,name){
  if(typeof value!=='boolean') throw new Error(name+' must be boolean');
  return value;
}
function integer(value,name,min,max){
  const n=Number(value);
  if(!Number.isInteger(n)||n<min||n>max) throw new Error(name+' is out of range');
  return n;
}
function atomic(value,name){
  const text=String(value??'0');
  if(!/^\\d{1,78}$/.test(text)) throw new Error(name+' must be an unsigned integer');
  return text;
}
function sqlString(value){return "'"+String(value).replaceAll("'","''")+"'";}
function sqlNullable(value){return value===null||value===undefined?'NULL':sqlString(value);}
function parseJson(stdout){
  const text=String(stdout||'').trim();
  if(!text)return null;
  try{return JSON.parse(text);}catch{throw new Error('database returned invalid JSON');}
}
function parseRow(stdout){
  const value=parseJson(stdout);
  return Array.isArray(value)?(value[0]||null):value;
}
function clean(text=''){
  return String(text).split(/\\r?\\n/)
    .filter(line=>!/(password|secret|token|private.?key|mnemonic|authorization)/i.test(line))
    .join('\\n').slice(0,1500);
}

async function defaultRunner(file,args,options={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const out=[];const err=[];let bytes=0;
    const MAX=2*1024*1024;
    function add(target,chunk){bytes+=chunk.length;if(bytes>MAX){child.kill();return;}target.push(chunk);}
    child.stdout.on('data',chunk=>add(out,chunk));
    child.stderr.on('data',chunk=>add(err,chunk));
    child.on('error',error=>resolve({ok:false,code:null,stdout:'',stderr:error.message}));
    child.on('close',code=>resolve({ok:code===0,code,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()}));
  });
}

export function createAdminEscrow({
  cwd=path.resolve(process.cwd()),
  runner=defaultRunner,
  actor=process.env.MERCORA_ADMIN_ACTOR||'admin'
}={}){
  async function db(sql){
    const result=await runner('docker',COMPOSE.concat([
      'exec','-T','postgres','psql','-U','mercora','-d','mercora',
      '-v','ON_ERROR_STOP=1','-At','-q','-c',sql
    ]),{cwd});
    if(!result.ok) throw new Error(clean(result.stderr||result.stdout||'database operation failed'));
    return result;
  }
  async function json(sql){return parseJson((await db(sql)).stdout);}
  async function row(sql){return parseRow((await db(sql)).stdout);}
  async function audit(orderId,action,metadata={}){
    await db(
      'INSERT INTO escrow_audit_events(order_id,action,actor,metadata) VALUES ('+
      sqlNullable(orderId)+'::uuid,'+sqlString(action)+','+sqlString(actor)+','+
      sqlString(JSON.stringify(metadata))+'::jsonb)'
    );
  }
  async function authorized(orderId,action,amount,reason){
    const existing=await row(
      "SELECT id FROM escrow_authorizations WHERE order_id="+sqlString(orderId)+"::uuid AND action="+sqlString(action)+
      " AND state='authorized' LIMIT 1"
    );
    if(existing) throw new Error('an authorization of this type is already pending');
    const rowResult=await row(
      "INSERT INTO escrow_authorizations(order_id,action,amount_atomic,actor,reason) VALUES("+
      sqlString(orderId)+"::uuid,"+sqlString(action)+","+
      (amount===null?'NULL':sqlString(amount))+","+sqlString(actor)+","+sqlNullable(reason)+
      ") RETURNING id,order_id,action,amount_atomic,actor,reason,state,created_at"
    );
    return rowResult;
  }

  async function getPolicy(){
    return row("SELECT row_to_json(x) FROM (SELECT id,escrow_enabled,mid_escrow_enabled,mid_release_bps,early_pay_enabled,early_pay_delay_hours,early_pay_max_bps,dispute_window_hours,auto_release_hours,new_seller_escrow_required,new_seller_hold_hours,high_value_review_enabled,high_value_threshold_atomic,manual_release_required,updated_at,updated_by FROM escrow_policies WHERE id=1) x");
  }
  async function setPolicy(payload={}){
    const keys=Object.keys(payload).filter(k=>POLICY_KEYS.has(k));
    if(!keys.length) throw new Error('no escrow policy changes supplied');
    const sets=[];
    const meta={};
    for(const key of keys){
      let value=payload[key];
      if(BOOL_KEYS.has(key)) value=bool(value,key);
      else if(BPS_KEYS.has(key)) value=integer(value,key,1,9999);
      else if(HOURS_KEYS.has(key)) value=integer(value,key,0,8760);
      else if(key==='high_value_threshold_atomic') value=atomic(value,key);
      sets.push(key+'='+(typeof value==='boolean'?String(value):sqlString(String(value))));
      meta[key]=value;
    }
    await db(
      "UPDATE escrow_policies SET "+sets.join(',')+",updated_at=now(),updated_by="+sqlString(actor)+" WHERE id=1"
    );
    await audit(null,'SET_POLICY',meta);
    return getPolicy();
  }
  async function getCustodyState(){
    return row("SELECT row_to_json(x) FROM (SELECT key,value,updated_at FROM system_state WHERE key='custody_mode') x");
  }
  async function setCustodyState(payload={}){
    if(payload.value!=='normal' && payload.value!=='frozen') throw new Error('unsupported custody mode');
    const current=await getCustodyState();
    if(current?.value===payload.value) return current;
    await db("INSERT INTO system_state(key,value,updated_at) VALUES('custody_mode',"+sqlString(payload.value)+",now()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()");
    await audit(null,'SET_CUSTODY_MODE',{from:current?.value||null,to:payload.value,reason:payload.reason||'Administrative custody control'});
    return getCustodyState();
  }
  async function listCases(payload={}){
    const limit=integer(payload.limit??50,'limit',1,100);
    const offset=integer(payload.offset??0,'offset',0,100000);
    const where=payload.state===undefined||payload.state===null?'':"WHERE e.state="+sqlString(payload.state);
    if(payload.state!==undefined&&payload.state!==null&&!CASE_STATES.has(payload.state)) throw new Error('unsupported escrow state filter');
    return json(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.updated_at DESC),'[]'::json)::text FROM ("+
      "SELECT e.order_id,e.asset_code,e.escrowed_atomic,e.released_atomic,e.refunded_atomic,e.state,e.opened_at,e.release_available_at,e.dispute_until,e.updated_at,"+
      "o.status AS order_status,o.buyer_account_id,a.username AS buyer_username,o.total_atomic,o.total_asset,"+
      "EXISTS(SELECT 1 FROM escrow_authorizations ea WHERE ea.order_id=e.order_id AND ea.state='authorized') AS has_pending_authorization "+
      "FROM order_escrows e JOIN orders o ON o.id=e.order_id JOIN accounts a ON a.id=o.buyer_account_id "+
      where+" ORDER BY e.updated_at DESC LIMIT "+String(limit)+" OFFSET "+String(offset)+") x"
    );
  }
  async function openEscrow(payload){
    const orderId=uuid(payload.order_id,'order_id');
    const order=await row(
      "SELECT row_to_json(x) FROM (SELECT o.id,o.status,o.total_atomic,o.total_asset,o.updated_at,ep.escrow_enabled,ep.dispute_window_hours,ep.auto_release_hours "+
      "FROM orders o CROSS JOIN escrow_policies ep WHERE o.id="+sqlString(orderId)+"::uuid) x"
    );
    if(!order) throw new Error('order not found');
    if(!order.escrow_enabled) throw new Error('escrow is disabled');
    if(!['paid','processing','shipped','disputed','completed'].includes(order.status)) throw new Error('order is not eligible for escrow');
    const existing=await row("SELECT order_id FROM order_escrows WHERE order_id="+sqlString(orderId)+"::uuid");
    if(existing) throw new Error('escrow already exists for order');
    const rowResult=await row(
      "INSERT INTO order_escrows(order_id,asset_code,escrowed_atomic,state,release_available_at,dispute_until) VALUES("+
      sqlString(orderId)+"::uuid,"+sqlString(order.total_asset)+","+sqlString(String(order.total_atomic))+",'held',"+
      "(now()+make_interval(hours=>"+String(order.auto_release_hours)+")),"+
      "(now()+make_interval(hours=>"+String(order.dispute_window_hours)+"))"+
      ") RETURNING order_id,asset_code,escrowed_atomic,released_atomic,refunded_atomic,state,opened_at,release_available_at,dispute_until"
    );
    await audit(orderId,'OPEN_ESCROW',{amount_atomic:String(order.total_atomic),asset:order.total_asset});
    return rowResult;
  }
  async function caseRow(orderId){
    const id=uuid(orderId,'order_id');
    const result=await row(
      "SELECT e.*,o.status AS order_status,o.updated_at AS order_updated_at FROM order_escrows e JOIN orders o ON o.id=e.order_id WHERE e.order_id="+sqlString(id)+"::uuid"
    );
    if(!result) throw new Error('escrow not found');
    return result;
  }
  async function available(caseData){
    const escrowed=BigInt(caseData.escrowed_atomic);
    const released=BigInt(caseData.released_atomic);
    const refunded=BigInt(caseData.refunded_atomic);
    return escrowed-released-refunded;
  }
  async function authorizeMidRelease(payload){
    const id=uuid(payload.order_id,'order_id');
    const item=await caseRow(id);
    const policy=await getPolicy();
    const custody=await getCustodyState();
    if(custody?.value!=='normal') throw new Error('custody is frozen');
    if(!policy.mid_escrow_enabled) throw new Error('mid-escrow is disabled');
    if(!['shipped'].includes(item.order_status)) throw new Error('mid-escrow requires a shipped order');
    if(item.state==='frozen'||item.state==='completed') throw new Error('escrow cannot be released in its current state');
    const target=(BigInt(item.escrowed_atomic)*BigInt(policy.mid_release_bps))/10000n;
    const amount=target-(BigInt(item.released_atomic)+BigInt(item.refunded_atomic));
    if(amount<=0n) throw new Error('no amount remains for mid-escrow release');
    const auth=await authorized(id,'mid_release',amount.toString(),payload.reason||'Mid-escrow release authorized by admin');
    await db("UPDATE order_escrows SET state='mid_release_authorized',updated_at=now() WHERE order_id="+sqlString(id)+"::uuid AND state<>'completed'");
    await audit(id,'AUTHORIZE_MID_RELEASE',{amount_atomic:amount.toString(),authorization_id:auth.id});
    return auth;
  }
  async function authorizeEarlyPay(payload){
    const id=uuid(payload.order_id,'order_id');
    const item=await caseRow(id);
    const policy=await getPolicy();
    const custody=await getCustodyState();
    if(custody?.value!=='normal') throw new Error('custody is frozen');
    if(!policy.early_pay_enabled) throw new Error('early pay is disabled');
    if(item.order_status!=='shipped') throw new Error('early pay requires a shipped order');
    const shippedAt=new Date(item.order_updated_at).getTime();
    if(!Number.isFinite(shippedAt) || Date.now()<shippedAt+Number(policy.early_pay_delay_hours)*3600000) throw new Error('early pay delay has not elapsed');
    if(item.state==='frozen'||item.state==='completed') throw new Error('escrow cannot be paid early in its current state');
    const target=(BigInt(item.escrowed_atomic)*BigInt(policy.early_pay_max_bps))/10000n;
    const amount=target-(BigInt(item.released_atomic)+BigInt(item.refunded_atomic));
    if(amount<=0n) throw new Error('no amount remains for early pay');
    const auth=await authorized(id,'early_pay',amount.toString(),payload.reason||'Early pay authorized by admin');
    await db("UPDATE order_escrows SET state='early_pay_authorized',updated_at=now() WHERE order_id="+sqlString(id)+"::uuid AND state<>'completed'");
    await audit(id,'AUTHORIZE_EARLY_PAY',{amount_atomic:amount.toString(),authorization_id:auth.id});
    return auth;
  }
  async function authorizeRelease(payload){
    const id=uuid(payload.order_id,'order_id');
    const item=await caseRow(id);
    const policy=await getPolicy();
    const custody=await getCustodyState();
    if(custody?.value!=='normal') throw new Error('custody is frozen');
    if(item.state==='frozen') throw new Error('escrow is frozen');
    const disputeUntil=item.dispute_until?new Date(item.dispute_until).getTime():0;
    const eligible=item.order_status==='completed' || (disputeUntil>0 && Date.now()>=disputeUntil && item.order_status!=='disputed');
    if(policy.manual_release_required && !payload.confirm) throw new Error('manual release confirmation required');
    if(!eligible) throw new Error('escrow is not yet eligible for final release');
    const amount=(await available(item)).toString();
    if(amount==='0') throw new Error('no amount remains to release');
    const auth=await authorized(id,'release',amount,payload.reason||'Final escrow release authorized by admin');
    await db("UPDATE order_escrows SET state='release_authorized',updated_at=now() WHERE order_id="+sqlString(id)+"::uuid");
    await audit(id,'AUTHORIZE_RELEASE',{amount_atomic:amount,authorization_id:auth.id});
    return auth;
  }
  async function authorizeRefund(payload){
    const id=uuid(payload.order_id,'order_id');
    const item=await caseRow(id);
    const custody=await getCustodyState();
    if(custody?.value!=='normal') throw new Error('custody is frozen');
    if(item.state==='completed') throw new Error('completed escrow cannot be refunded');
    const eligible=['cancelled','disputed'].includes(item.order_status)||item.state==='disputed';
    if(!eligible) throw new Error('refund requires a cancelled or disputed order');
    const amount=(await available(item)).toString();
    if(amount==='0') throw new Error('no amount remains to refund');
    const auth=await authorized(id,'refund',amount,payload.reason||'Refund authorized by admin');
    await db("UPDATE order_escrows SET state='refund_authorized',updated_at=now() WHERE order_id="+sqlString(id)+"::uuid");
    await audit(id,'AUTHORIZE_REFUND',{amount_atomic:amount,authorization_id:auth.id});
    return auth;
  }
  async function freezeCase(payload){
    const id=uuid(payload.order_id,'order_id');
    await caseRow(id);
    await db("UPDATE order_escrows SET state='frozen',updated_at=now() WHERE order_id="+sqlString(id)+"::uuid");
    await audit(id,'FREEZE_CASE',{reason:payload.reason||'Administrative freeze'});
    return caseRow(id);
  }
  async function unfreezeCase(payload){
    const id=uuid(payload.order_id,'order_id');
    const item=await caseRow(id);
    if(item.state!=='frozen') throw new Error('escrow is not frozen');
    await db("UPDATE order_escrows SET state='held',updated_at=now() WHERE order_id="+sqlString(id)+"::uuid");
    await audit(id,'UNFREEZE_CASE',{});
    return caseRow(id);
  }
  async function listAuthorizations(payload={}){
    const limit=integer(payload.limit??50,'limit',1,100);
    const offset=integer(payload.offset??0,'offset',0,100000);
    return json(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM ("+
      "SELECT ea.id,ea.order_id,ea.action,ea.amount_atomic,ea.actor,ea.reason,ea.state,ea.created_at,ea.executed_at,o.status AS order_status "+
      "FROM escrow_authorizations ea JOIN orders o ON o.id=ea.order_id ORDER BY ea.created_at DESC LIMIT "+String(limit)+" OFFSET "+String(offset)+") x"
    );
  }
  async function run(action,payload={}){
    const op=String(action||'').toUpperCase();
    if(!ACTIONS.has(op)) throw new Error('unsupported escrow action');
    switch(op){
      case 'GET_POLICY': return getPolicy();
      case 'SET_POLICY': return setPolicy(payload);
      case 'GET_CUSTODY_STATE': return getCustodyState(); case 'SET_CUSTODY_STATE': return setCustodyState(payload);
      case 'LIST_CASES': return listCases(payload);
      case 'OPEN_ESCROW': return openEscrow(payload);
      case 'AUTHORIZE_MID_RELEASE': return authorizeMidRelease(payload);
      case 'AUTHORIZE_EARLY_PAY': return authorizeEarlyPay(payload);
      case 'AUTHORIZE_RELEASE': return authorizeRelease(payload);
      case 'AUTHORIZE_REFUND': return authorizeRefund(payload);
      case 'FREEZE_CASE': return freezeCase(payload);
      case 'UNFREEZE_CASE': return unfreezeCase(payload);
      case 'LIST_AUTHORIZATIONS': return listAuthorizations(payload);
      default: throw new Error('unsupported escrow action');
    }
  }
  return Object.freeze({run});
}

export const ESCROW_ADMIN_ACTIONS=Object.freeze(Array.from(ACTIONS));
