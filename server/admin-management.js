import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.onion.yml'];
const ACTIONS = new Set([
  'OVERVIEW','LIST_FEATURED','LIST_USERS','SET_ACCOUNT_STATUS','BAN_ACCOUNT','UNBAN_ACCOUNT',
  'LIST_STORES','CREATE_STORE','ASSIGN_STORE','UNASSIGN_STORE','UPDATE_STORE',
  'LIST_LISTINGS','UPDATE_LISTING_STATUS','LIST_ORDERS','UPDATE_ORDER_STATUS',
  'LIST_REPORTS','UPDATE_REPORT','LIST_PROMOS','CREATE_PROMO','DISABLE_PROMO',
  'LIST_DISCOUNTS','CREATE_DISCOUNT','DISABLE_DISCOUNT','LIST_CATEGORIES',
  'CREATE_CATEGORY','UPDATE_CATEGORY','SITE_GET','SITE_SET','SET_FEATURED','LIST_AUDIT'
]);
const ACCOUNT_STATUSES = new Set(['active','frozen','disabled']);
const STORE_STATUSES = new Set(['draft','active','suspended','closed']);
const LISTING_STATUSES = new Set(['draft','active','archived','blocked']);
const REPORT_STATUSES = new Set(['open','reviewing','resolved','dismissed']);
const MONEY_TYPES = new Set(['percent','fixed']);
const DISCOUNT_TARGETS = new Set(['global','store','listing','category']);
const SITE_KEYS = new Set([
  'site_name','site_mode','announcement','maintenance_message',
  'new_listings_enabled','seller_registration_enabled','footer_notice','hero_title','hero_copy','buy_cta','sell_cta'
]);
const SITE_MODES = new Set(['public','maintenance','restricted']);
const SITE_BOOLEAN_KEYS = new Set(['new_listings_enabled','seller_registration_enabled']);
const ORDER_TRANSITIONS = Object.freeze({
  pending: new Set(['cancelled']),
  awaiting_payment: new Set(['cancelled']),
  paid: new Set(['processing','cancelled']),
  processing: new Set(['shipped','cancelled','disputed']),
  shipped: new Set(['completed','disputed']),
  disputed: new Set(['processing','shipped','completed','cancelled']),
  completed: new Set(),
  cancelled: new Set()
});

function assertAction(value){
  const action = String(value || '').toUpperCase();
  if(!ACTIONS.has(action)) throw new Error('unsupported management action');
  return action;
}
function assertString(value,name,min,max){
  if(typeof value !== 'string' || value.length < min || value.length > max) throw new Error(name+' must contain '+min+'-'+max+' characters');
  if(value.includes('\0')) throw new Error(name+' contains an invalid character');
  return value;
}
function sqlString(value){ return "'" + String(value).replaceAll("'","''") + "'"; }
function sqlNullable(value){ return value === null || value === undefined ? 'NULL' : sqlString(value); }
function uuid(value,name){
  const text = assertString(value,name,36,36);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(name+' is not a valid UUID');
  return text;
}
function positiveInteger(value,name,max=1000000000){
  const n = Number(value);
  if(!Number.isInteger(n) || n < 1 || n > max) throw new Error(name+' is invalid');
  return n;
}
function limit(value,fallback=50){ return value === undefined ? fallback : positiveInteger(value,'limit',100); }
function offset(value){
  const n = value === undefined ? 0 : Number(value);
  if(!Number.isInteger(n) || n < 0 || n > 100000) throw new Error('offset is invalid');
  return n;
}
function slug(value){
  const text = assertString(value,'slug',3,63).toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(text)) throw new Error('slug format is invalid');
  return text;
}
function parseJson(stdout){
  const text = String(stdout || '').trim();
  if(!text) return null;
  try { return JSON.parse(text); } catch { throw new Error('database returned invalid JSON'); }
}
function parseRow(stdout){
  const row = parseJson(stdout);
  if(!row) return null;
  return Array.isArray(row) ? (row[0] || null) : row;
}
function cleanError(text){
  return String(text || '').split(/\r?\n/)
    .filter(function(line){ return !/(password|secret|token|private.?key|mnemonic|authorization)/i.test(line); })
    .join('\n').slice(0,1500);
}

async function defaultRunner(file,args,options){
  return new Promise(function(resolve){
    const child = spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stdout=[]; const stderr=[]; let total=0; const MAX=4*1024*1024;
    function push(target,chunk){
      total += chunk.length;
      if(total>MAX){ child.kill(); return; }
      target.push(chunk);
    }
    child.stdout.on('data',function(chunk){push(stdout,chunk);});
    child.stderr.on('data',function(chunk){push(stderr,chunk);});
    child.on('error',function(error){resolve({ok:false,code:null,stdout:'',stderr:error.message});});
    child.on('close',function(code){
      resolve({ok:code===0,code:code,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});
    });
  });
}

export function createAdminManagement({cwd=path.resolve(process.cwd()),runner=defaultRunner,actor=process.env.MERCORA_ADMIN_ACTOR || 'admin',runtimeConfig=path.resolve(cwd,'runtime','site-config.json')}={}){
  async function db(sql){
    const result = await runner('docker',COMPOSE.concat([
      'exec','-T','postgres','psql','-U','mercora','-d','mercora',
      '-v','ON_ERROR_STOP=1','-At','-q','-c',sql
    ]),{cwd});
    if(!result.ok) throw new Error(cleanError(result.stderr || result.stdout || 'database operation failed'));
    return result;
  }
  async function queryJson(sql){ return parseJson((await db(sql)).stdout); }
  async function queryRow(sql){ return parseRow((await db(sql)).stdout); }
  async function audit(action,resourceType,resourceId,metadata){
    await db(
      'INSERT INTO admin_audit_log(actor,action,resource_type,resource_id,metadata) VALUES ('+
      sqlString(actor)+','+sqlString(action)+','+sqlString(resourceType)+','+
      sqlNullable(resourceId)+','+sqlString(JSON.stringify(metadata || {}))+'::jsonb)'
    );
  }

  async function overview(){
    return queryJson(
      "SELECT json_build_object("+
      "'users',(SELECT count(*) FROM accounts),"+
      "'active_users',(SELECT count(*) FROM accounts WHERE status='active'),"+
      "'banned_users',(SELECT count(*) FROM account_bans WHERE active=true),"+
      "'stores',(SELECT count(*) FROM mercora_stores),"+
      "'active_stores',(SELECT count(*) FROM mercora_stores WHERE status='active'),"+
      "'active_listings',(SELECT count(*) FROM listings WHERE status='active'),"+
      "'blocked_listings',(SELECT count(*) FROM listings WHERE status='blocked'),"+
      "'open_reports',(SELECT count(*) FROM listing_reports WHERE status IN ('open','reviewing')),"+
      "'active_orders',(SELECT count(*) FROM orders WHERE status IN ('pending','awaiting_payment','paid','processing','shipped','disputed')),"+
      "'active_promos',(SELECT count(*) FROM promotion_codes WHERE active=true),"+
      "'active_discounts',(SELECT count(*) FROM discount_rules WHERE active=true)"+
      ")::text"
    );
  }

  async function listUsers(payload){
    payload=payload||{}; const q=assertString(String(payload.q||''),'q',0,80);
    const where=q ? "WHERE username ILIKE "+sqlString('%'+q+'%') : '';
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM ("+
      "SELECT id,username,status,created_at,EXISTS(SELECT 1 FROM account_bans b WHERE b.account_id=accounts.id AND b.active=true AND (b.expires_at IS NULL OR b.expires_at>now())) AS banned "+
      "FROM accounts "+where+" ORDER BY created_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function setAccountStatus(payload){
    const id=uuid(payload.account_id,'account_id');
    if(!ACCOUNT_STATUSES.has(payload.status)) throw new Error('unsupported account status');
    const row=await queryRow("SELECT id,username,status FROM accounts WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('account not found');
    await db("UPDATE accounts SET status="+sqlString(payload.status)+" WHERE id="+sqlString(id)+"::uuid");
    await audit('SET_ACCOUNT_STATUS','account',id,{status:payload.status});
    return {...row,status:payload.status};
  }
  async function banAccount(payload){
    const id=uuid(payload.account_id,'account_id');
    const reason=assertString(payload.reason,'reason',3,2000);
    const expiry=(payload.expires_at===undefined || payload.expires_at===null) ? null : assertString(payload.expires_at,'expires_at',10,40);
    const exists=await queryRow("SELECT id,username FROM accounts WHERE id="+sqlString(id)+"::uuid");
    if(!exists) throw new Error('account not found');
    await db(
      "INSERT INTO account_bans(account_id,reason,expires_at,active,actor) VALUES ("+
      sqlString(id)+"::uuid,"+sqlString(reason)+","+sqlNullable(expiry)+"::timestamptz,true,"+sqlString(actor)+")"
    );
    await db("UPDATE accounts SET status='disabled' WHERE id="+sqlString(id)+"::uuid");
    await audit('BAN_ACCOUNT','account',id,{reason:reason,expires_at:expiry});
    return {id:id,username:exists.username,status:'disabled'};
  }
  async function unbanAccount(payload){
    const id=uuid(payload.account_id,'account_id');
    const exists=await queryRow("SELECT id,username FROM accounts WHERE id="+sqlString(id)+"::uuid");
    if(!exists) throw new Error('account not found');
    await db("UPDATE account_bans SET active=false,lifted_at=now() WHERE account_id="+sqlString(id)+"::uuid AND active=true");
    await db(
      "UPDATE accounts SET status='active' WHERE id="+sqlString(id)+"::uuid "+
      "AND NOT EXISTS(SELECT 1 FROM account_bans WHERE account_id="+sqlString(id)+"::uuid AND active=true)"
    );
    const row=await queryRow("SELECT id,username,status FROM accounts WHERE id="+sqlString(id)+"::uuid");
    await audit('UNBAN_ACCOUNT','account',id,{});
    return row;
  }

  async function listStores(payload){
    payload=payload||{}; const q=assertString(String(payload.q||''),'q',0,80);
    const where=q ? "WHERE s.name ILIKE "+sqlString('%'+q+'%')+" OR s.slug ILIKE "+sqlString('%'+q+'%') : '';
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.updated_at DESC),'[]'::json)::text FROM ("+
      "SELECT s.id,s.slug,s.name,s.status,s.created_at,s.updated_at,a.username AS owner_username,a.id AS owner_account_id "+
      "FROM mercora_stores s LEFT JOIN accounts a ON a.id=s.owner_account_id "+where+
      " ORDER BY s.updated_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function createStore(payload){
    const s=slug(payload.slug); const n=assertString(payload.name,'name',2,120);
    const status=payload.status===undefined?'draft':payload.status;
    if(!STORE_STATUSES.has(status)) throw new Error('unsupported store status');
    const owner=payload.owner_username ? assertString(payload.owner_username,'owner_username',1,80) : null;
    if(owner && !await queryRow("SELECT id FROM accounts WHERE username="+sqlString(owner))) throw new Error('owner account not found');
    const row=await queryRow(
      "WITH inserted AS (INSERT INTO mercora_stores(slug,name,owner_account_id,status) VALUES("+
      sqlString(s)+","+sqlString(n)+","+(owner?"(SELECT id FROM accounts WHERE username="+sqlString(owner)+")":"NULL")+","+sqlString(status)+
      ") RETURNING id,slug,name,status,owner_account_id) SELECT id,slug,name,status,owner_account_id FROM inserted"
    );
    await audit('CREATE_STORE','store',row.id,{slug:s,name:n,status:status});
    return row;
  }
  async function assignStore(payload){
    const storeId=uuid(payload.store_id,'store_id'); const username=assertString(payload.owner_username,'owner_username',1,80);
    const owner=await queryRow("SELECT id FROM accounts WHERE username="+sqlString(username));
    if(!owner) throw new Error('owner account not found');
    const before=await queryRow("SELECT id FROM mercora_stores WHERE id="+sqlString(storeId)+"::uuid");
    if(!before) throw new Error('store not found');
    await db("UPDATE mercora_stores SET owner_account_id="+sqlString(owner.id)+"::uuid,status='active',updated_at=now() WHERE id="+sqlString(storeId)+"::uuid");
    await db("INSERT INTO store_assignments(store_id,owner_account_id,action,actor) VALUES("+sqlString(storeId)+"::uuid,"+sqlString(owner.id)+"::uuid,'assigned',"+sqlString(actor)+")");
    const row=await queryRow("SELECT id,slug,name,status,owner_account_id FROM mercora_stores WHERE id="+sqlString(storeId)+"::uuid");
    await audit('ASSIGN_STORE','store',storeId,{owner_username:username});
    return row;
  }
  async function unassignStore(payload){
    const storeId=uuid(payload.store_id,'store_id');
    const before=await queryRow("SELECT id,owner_account_id FROM mercora_stores WHERE id="+sqlString(storeId)+"::uuid");
    if(!before) throw new Error('store not found');
    await db("UPDATE mercora_stores SET owner_account_id=NULL,status='draft',updated_at=now() WHERE id="+sqlString(storeId)+"::uuid");
    await db("INSERT INTO store_assignments(store_id,owner_account_id,action,actor) VALUES("+sqlString(storeId)+"::uuid,NULL,'unassigned',"+sqlString(actor)+")");
    await audit('UNASSIGN_STORE','store',storeId,{});
    return await queryRow("SELECT id,slug,name,status,owner_account_id FROM mercora_stores WHERE id="+sqlString(storeId)+"::uuid");
  }

  async function updateStore(payload){
    const id=uuid(payload.store_id,'store_id'); const changes=[];
    if(payload.name!==undefined) changes.push("name="+sqlString(assertString(payload.name,'name',2,120)));
    if(payload.status!==undefined){if(!STORE_STATUSES.has(payload.status)) throw new Error('unsupported store status');changes.push("status="+sqlString(payload.status));}
    if(!changes.length) throw new Error('no store changes supplied');
    changes.push('updated_at=now()');
    await db("UPDATE mercora_stores SET "+changes.join(',')+" WHERE id="+sqlString(id)+"::uuid");
    const row=await queryRow("SELECT id,slug,name,status,owner_account_id,updated_at FROM mercora_stores WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('store not found');
    await audit('UPDATE_STORE','store',id,{name:payload.name,status:payload.status});
    return row;
  }

  async function listListings(payload){
    payload=payload||{}; const q=assertString(String(payload.q||''),'q',0,80); const clauses=[];
    if(q) clauses.push("(l.title ILIKE "+sqlString('%'+q+'%')+" OR sp.display_name ILIKE "+sqlString('%'+q+'%')+")");
    if(payload.status!==undefined && payload.status!==null){ if(!LISTING_STATUSES.has(payload.status) && !['reserved','sold'].includes(payload.status)) throw new Error('unsupported listing status filter'); clauses.push("l.status="+sqlString(payload.status));}
    const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.updated_at DESC),'[]'::json)::text FROM ("+
      "SELECT l.id,l.title,l.status,l.price_atomic,l.price_asset,l.condition,l.created_at,l.updated_at,sp.display_name AS seller,c.name AS category "+
      "FROM listings l LEFT JOIN seller_profiles sp ON sp.account_id=l.seller_account_id LEFT JOIN categories c ON c.id=l.category_id "+where+
      " ORDER BY l.updated_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function updateListingStatus(payload){
    const id=uuid(payload.listing_id,'listing_id'); if(!LISTING_STATUSES.has(payload.status)) throw new Error('unsupported listing status');
    const row=await queryRow("SELECT id,title,status FROM listings WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('listing not found');
    await db("UPDATE listings SET status="+sqlString(payload.status)+",updated_at=now() WHERE id="+sqlString(id)+"::uuid");
    await audit('UPDATE_LISTING_STATUS','listing',id,{status:payload.status});
    return {...row,status:payload.status};
  }

  async function listOrders(payload){
    payload=payload||{};
    if(payload.status!==undefined && payload.status!==null && !['pending','awaiting_payment','paid','processing','shipped','disputed','completed','cancelled'].includes(payload.status)) throw new Error('unsupported order status filter');
    const where=payload.status?"WHERE o.status="+sqlString(payload.status):'';
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.updated_at DESC),'[]'::json)::text FROM ("+
      "SELECT o.id,o.status,o.total_atomic,o.total_asset,o.created_at,o.updated_at,a.username AS buyer_username,(SELECT count(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count "+
      "FROM orders o JOIN accounts a ON a.id=o.buyer_account_id "+where+
      " ORDER BY o.updated_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function updateOrderStatus(payload){
    const id=uuid(payload.order_id,'order_id'); const target=assertString(payload.status,'status',3,30);
    const current=await queryRow("SELECT id,status FROM orders WHERE id="+sqlString(id)+"::uuid");
    if(!current) throw new Error('order not found');
    if(!ORDER_TRANSITIONS[current.status] || !ORDER_TRANSITIONS[current.status].has(target)) throw new Error('order transition is not allowed');
    await db("UPDATE orders SET status="+sqlString(target)+",updated_at=now() WHERE id="+sqlString(id)+"::uuid");
    await audit('UPDATE_ORDER_STATUS','order',id,{from:current.status,to:target});
    return {id:id,status:target};
  }

  async function listReports(payload){
    payload=payload||{}; if(payload.status!==undefined && payload.status!==null && !REPORT_STATUSES.has(payload.status)) throw new Error('unsupported report status');
    const where=payload.status?"WHERE r.status="+sqlString(payload.status):'';
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM ("+
      "SELECT r.id,r.listing_id,r.reason_code,r.status,r.admin_note,r.handled_by,r.handled_at,r.created_at,l.title AS listing_title,a.username AS reporter_username "+
      "FROM listing_reports r JOIN listings l ON l.id=r.listing_id LEFT JOIN accounts a ON a.id=r.reporter_account_id "+where+
      " ORDER BY r.created_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function updateReport(payload){
    const id=uuid(payload.report_id,'report_id'); if(!REPORT_STATUSES.has(payload.status)) throw new Error('unsupported report status');
    const note=payload.admin_note===null || payload.admin_note===undefined ? null : assertString(payload.admin_note,'admin_note',0,4000);
    const row=await queryRow("SELECT id,listing_id FROM listing_reports WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('report not found');
    await db(
      "UPDATE listing_reports SET status="+sqlString(payload.status)+",admin_note="+sqlNullable(note)+",handled_by="+sqlString(actor)+",handled_at=now() "+
      "WHERE id="+sqlString(id)+"::uuid"
    );
    await audit('UPDATE_REPORT','report',id,{status:payload.status});
    return await queryRow("SELECT id,listing_id,status,admin_note,handled_by,handled_at FROM listing_reports WHERE id="+sqlString(id)+"::uuid");
  }

  async function listPromos(payload){
    payload=payload||{};
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM ("+
      "SELECT id,code_prefix,discount_type,discount_bps,discount_atomic,discount_asset,max_redemptions,redeemed_count,min_order_atomic,starts_at,ends_at,active,created_at "+
      "FROM promotion_codes ORDER BY created_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function createPromo(payload){
    if(!MONEY_TYPES.has(payload.discount_type)) throw new Error('unsupported promotion type');
    const raw=payload.code ? assertString(payload.code,'code',10,64).toUpperCase() : crypto.randomBytes(12).toString('base64url').toUpperCase();
    if(!/^[A-Z0-9_-]{10,64}$/.test(raw)) throw new Error('promotion code format is invalid');
    const hash=crypto.createHash('sha256').update(raw,'utf8').digest('hex');
    const prefix=raw.slice(0,8);
    let bps=null,atomic=null,asset=null;
    if(payload.discount_type==='percent'){
      bps=Number(payload.discount_bps);
      if(!Number.isInteger(bps)||bps<1||bps>10000) throw new Error('discount_bps must be 1-10000');
    }else{
      atomic=String(payload.discount_atomic||'');
      if(!/^\d{1,78}$/.test(atomic)||BigInt(atomic)<=0n) throw new Error('discount_atomic is invalid');
      asset=assertString(String(payload.discount_asset||''),'discount_asset',3,12).toUpperCase();
    }
    const max=payload.max_redemptions===undefined||payload.max_redemptions===null?null:positiveInteger(payload.max_redemptions,'max_redemptions');
    const minimum=String(payload.min_order_atomic===undefined?'0':payload.min_order_atomic);
    if(!/^\d{1,78}$/.test(minimum)) throw new Error('min_order_atomic is invalid');
    const row=await queryRow(
      "INSERT INTO promotion_codes(code_hash,code_prefix,discount_type,discount_bps,discount_atomic,discount_asset,max_redemptions,min_order_atomic,starts_at,ends_at,active) VALUES("+
      sqlString(hash)+","+sqlString(prefix)+","+sqlString(payload.discount_type)+","+(bps===null?'NULL':String(bps))+","+(atomic===null?'NULL':sqlString(atomic))+","+(asset===null?'NULL':sqlString(asset))+","+
      (max===null?'NULL':String(max))+","+sqlString(minimum)+","+(payload.starts_at?sqlString(assertString(payload.starts_at,'starts_at',10,40)):'now()')+","+(payload.ends_at?sqlString(assertString(payload.ends_at,'ends_at',10,40)):'NULL')+",true) RETURNING id,code_prefix,discount_type,discount_bps,discount_atomic,discount_asset,max_redemptions,min_order_atomic,starts_at,ends_at,active"
    );
    await audit('CREATE_PROMO','promotion',row.id,{discount_type:payload.discount_type,discount_bps:bps,discount_asset:asset,max_redemptions:max});
    return {...row,code:raw,warning:'The full promotion code is returned once and is not stored in plaintext.'};
  }
  async function disablePromo(payload){
    const id=uuid(payload.promotion_id,'promotion_id');
    const row=await queryRow("SELECT id FROM promotion_codes WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('promotion not found');
    await db("UPDATE promotion_codes SET active=false WHERE id="+sqlString(id)+"::uuid");
    await audit('DISABLE_PROMO','promotion',id,{});
    return {id:id,active:false};
  }

  async function listDiscounts(payload){
    payload=payload||{};
    return queryJson(
      "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM ("+
      "SELECT id,target_type,target_id,discount_type,discount_bps,discount_atomic,discount_asset,starts_at,ends_at,active,created_at "+
      "FROM discount_rules ORDER BY created_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x"
    );
  }
  async function createDiscount(payload){
    if(!DISCOUNT_TARGETS.has(payload.target_type)) throw new Error('unsupported discount target');
    if(payload.target_type==='global' && payload.target_id!==null && payload.target_id!==undefined) throw new Error('global discount cannot have target_id');
    const target=payload.target_type==='global'?null:uuid(payload.target_id,'target_id');
    if(!MONEY_TYPES.has(payload.discount_type)) throw new Error('unsupported discount type');
    let bps=null,atomic=null,asset=null;
    if(payload.discount_type==='percent'){
      bps=Number(payload.discount_bps);
      if(!Number.isInteger(bps)||bps<1||bps>10000) throw new Error('discount_bps must be 1-10000');
    }else{
      atomic=String(payload.discount_atomic||'');
      if(!/^\d{1,78}$/.test(atomic)||BigInt(atomic)<=0n) throw new Error('discount_atomic is invalid');
      asset=assertString(String(payload.discount_asset||''),'discount_asset',3,12).toUpperCase();
    }
    const row=await queryRow(
      "INSERT INTO discount_rules(target_type,target_id,discount_type,discount_bps,discount_atomic,discount_asset,starts_at,ends_at,active) VALUES("+
      sqlString(payload.target_type)+","+(target?sqlString(target)+'::uuid':'NULL')+","+sqlString(payload.discount_type)+","+
      (bps===null?'NULL':String(bps))+","+(atomic===null?'NULL':sqlString(atomic))+","+(asset===null?'NULL':sqlString(asset))+","+
      (payload.starts_at?sqlString(assertString(payload.starts_at,'starts_at',10,40)):'now()')+","+(payload.ends_at?sqlString(assertString(payload.ends_at,'ends_at',10,40)):'NULL')+",true) "+
      "RETURNING id,target_type,target_id,discount_type,discount_bps,discount_atomic,discount_asset,starts_at,ends_at,active"
    );
    await audit('CREATE_DISCOUNT','discount',row.id,{target_type:payload.target_type,discount_type:payload.discount_type,discount_bps:bps,discount_asset:asset});
    return row;
  }
  async function disableDiscount(payload){
    const id=uuid(payload.discount_id,'discount_id');
    const row=await queryRow("SELECT id FROM discount_rules WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('discount not found');
    await db("UPDATE discount_rules SET active=false WHERE id="+sqlString(id)+"::uuid");
    await audit('DISABLE_DISCOUNT','discount',id,{});
    return {id:id,active:false};
  }

  async function listCategories(){
    return queryJson("SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.name),'[]'::json)::text FROM (SELECT id,slug,name,active FROM categories ORDER BY name) x");
  }
  async function createCategory(payload){
    const s=slug(payload.slug); const n=assertString(payload.name,'name',2,120);
    const row=await queryRow("INSERT INTO categories(slug,name,active) VALUES("+sqlString(s)+","+sqlString(n)+","+Boolean(payload.active!==false)+") RETURNING id,slug,name,active");
    await audit('CREATE_CATEGORY','category',row.id,{slug:s,name:n});
    return row;
  }
  async function updateCategory(payload){
    const id=uuid(payload.category_id,'category_id'); const changes=[];
    if(payload.name!==undefined) changes.push("name="+sqlString(assertString(payload.name,'name',2,120)));
    if(payload.active!==undefined) changes.push("active="+Boolean(payload.active));
    if(!changes.length) throw new Error('no category changes supplied');
    await db("UPDATE categories SET "+changes.join(',')+" WHERE id="+sqlString(id)+"::uuid");
    const row=await queryRow("SELECT id,slug,name,active FROM categories WHERE id="+sqlString(id)+"::uuid");
    if(!row) throw new Error('category not found');
    await audit('UPDATE_CATEGORY','category',id,{name:payload.name,active:payload.active});
    return row;
  }
  async function syncRuntimeConfig(){
    const settings=await queryJson("SELECT COALESCE(json_object_agg(key,value),'{}'::json)::text FROM site_settings");
    const directory=path.dirname(runtimeConfig);
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const temp=runtimeConfig+'.tmp-'+process.pid;
    await fs.writeFile(temp,JSON.stringify(settings,null,2)+'\n',{encoding:'utf8',mode:0o640});
    await fs.rename(temp,runtimeConfig);
    return settings;
  }
  async function siteGet(){ return queryJson("SELECT COALESCE(json_object_agg(key,value),'{}'::json)::text FROM site_settings"); }
  async function listFeatured(){ return queryJson("SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.position),'[]'::json)::text FROM (SELECT h.position,h.listing_id,l.title,l.status FROM homepage_featured_listings h JOIN listings l ON l.id=h.listing_id ORDER BY h.position) x"); }
  async function siteSet(payload){
    const key=assertString(payload.key,'key',1,64); if(!SITE_KEYS.has(key)) throw new Error('unsupported site setting');
    const value=assertString(String(payload.value===undefined?'':payload.value),'value',0,4000);
    if(key==='site_mode' && !SITE_MODES.has(value)) throw new Error('unsupported site mode');
    if(SITE_BOOLEAN_KEYS.has(key) && value!=='true' && value!=='false') throw new Error('site setting must be true or false');
    const row=await queryRow(
      "INSERT INTO site_settings(key,value,updated_at,updated_by) VALUES("+sqlString(key)+","+sqlString(value)+",now(),"+sqlString(actor)+") "+
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now(),updated_by=excluded.updated_by RETURNING key,value,updated_at,updated_by"
    );
    await syncRuntimeConfig();
    await audit('SITE_SET','site_setting',key,{});
    return row;
  }
  async function setFeatured(payload){
    const ids=Array.isArray(payload.listing_ids)?payload.listing_ids:[];
    if(ids.length>48) throw new Error('listing_ids must contain 0-48 UUIDs');
    const normalized=ids.map(function(id){return uuid(id,'listing_id');});
    const values=normalized.map(function(id,index){return '('+sqlString(id)+'::uuid,'+(index+1)+',now())';}).join(',');
    const transaction = normalized.length
      ? 'BEGIN; DELETE FROM homepage_featured_listings; INSERT INTO homepage_featured_listings(listing_id,position) VALUES '+values+'; COMMIT;'
      : 'BEGIN; DELETE FROM homepage_featured_listings; COMMIT;';
    await db(transaction);
    await audit('SET_FEATURED','homepage',null,{count:normalized.length});
    return queryJson("SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.position),'[]'::json)::text FROM (SELECT h.position,h.listing_id,l.title,l.status FROM homepage_featured_listings h JOIN listings l ON l.id=h.listing_id ORDER BY h.position) x");
  }
  async function listAudit(payload){
    payload=payload||{};
    return queryJson("SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text FROM (SELECT id,actor,action,resource_type,resource_id,metadata,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT "+limit(payload.limit)+" OFFSET "+offset(payload.offset)+") x");
  }

  async function run(action,payload){ 
    switch(assertAction(action)){
      case 'OVERVIEW': return overview(); case 'LIST_FEATURED': return listFeatured();
      case 'LIST_USERS': return listUsers(payload); case 'SET_ACCOUNT_STATUS': return setAccountStatus(payload);
      case 'BAN_ACCOUNT': return banAccount(payload); case 'UNBAN_ACCOUNT': return unbanAccount(payload);
      case 'LIST_STORES': return listStores(payload); case 'CREATE_STORE': return createStore(payload);
      case 'ASSIGN_STORE': return assignStore(payload); case 'UNASSIGN_STORE': return unassignStore(payload); case 'UPDATE_STORE': return updateStore(payload);
      case 'LIST_LISTINGS': return listListings(payload); case 'UPDATE_LISTING_STATUS': return updateListingStatus(payload);
      case 'LIST_ORDERS': return listOrders(payload); case 'UPDATE_ORDER_STATUS': return updateOrderStatus(payload);
      case 'LIST_REPORTS': return listReports(payload); case 'UPDATE_REPORT': return updateReport(payload);
      case 'LIST_PROMOS': return listPromos(payload); case 'CREATE_PROMO': return createPromo(payload);
      case 'DISABLE_PROMO': return disablePromo(payload); case 'LIST_DISCOUNTS': return listDiscounts(payload);
      case 'CREATE_DISCOUNT': return createDiscount(payload); case 'DISABLE_DISCOUNT': return disableDiscount(payload);
      case 'LIST_CATEGORIES': return listCategories(); case 'CREATE_CATEGORY': return createCategory(payload);
      case 'UPDATE_CATEGORY': return updateCategory(payload); case 'SITE_GET': return siteGet();
      case 'SITE_SET': return siteSet(payload); case 'SET_FEATURED': return setFeatured(payload);
      case 'LIST_AUDIT': return listAudit(payload); default: throw new Error('unsupported management action');
    }
  }
  return Object.freeze({run});
}

export const MANAGEMENT_ACTIONS = Object.freeze(Array.from(ACTIONS));
