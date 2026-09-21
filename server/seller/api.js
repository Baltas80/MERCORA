import { spawn } from 'node:child_process';

const ASSETS=new Set(['BTC','LTC','XMR']);
const USERNAME_RE=/^[a-z0-9][a-z0-9_-]{2,31}$/;
const SLUG_RE=/^[a-z0-9][a-z0-9-]{1,62}$/;

function text(value,name,min,max){
  if(typeof value!=='string'||value.length<min||value.length>max||value.includes('\0'))throw new Error(name+' must contain '+min+'-'+max+' characters');
  return value;
}
function slug(value){const v=text(String(value||'').toLowerCase(),'slug',3,63);if(!SLUG_RE.test(v))throw new Error('slug format is invalid');return v;}
function atomic(value,name){const v=String(value??'');if(!/^\d{1,78}$/.test(v))throw new Error(name+' must be an unsigned integer');return v;}
function uuid(value,name){const v=text(value,name,36,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw new Error(name+' is not a valid UUID');return v;}
function sql(v){return "'"+String(v).replaceAll("'","''")+"'";}

function dbConnection(url){
  if(!url)throw new Error('database is not configured');
  let c;try{c=new URL(url);}catch{throw new Error('database configuration is invalid');}
  if(!['postgres:','postgresql:'].includes(c.protocol)||!c.hostname||!c.pathname)throw new Error('database configuration is invalid');
  return {
    args:['-X','-q','-At','-v','ON_ERROR_STOP=1','--host',c.hostname,'--port',c.port||'5432','--username',decodeURIComponent(c.username),'--dbname',decodeURIComponent(c.pathname.replace(/^\//,''))],
    env:{...process.env,PGAPPNAME:'mercora-seller',PGPASSWORD:decodeURIComponent(c.password||'')}
  };
}
function runner(file,args,options={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:options.env||process.env});
    const out=[];const err=[];
    child.stdout.on('data',c=>out.push(c));child.stderr.on('data',c=>err.push(c));
    child.on('error',e=>resolve({ok:false,code:null,stdout:'',stderr:e.message}));
    child.on('close',code=>resolve({ok:code===0,code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')}));
  });
}
function parse(stdout){const t=String(stdout||'').trim();if(!t)return null;try{const value=JSON.parse(t);return Array.isArray(value)?(value[0]||null):value;}catch{throw new Error('database returned invalid seller JSON');}}
function clean(text){return String(text||'').split(/\r?\n/).filter(line=>!/(password|secret|token|private.?key|mnemonic|authorization|database_url)/i.test(line)).join(' ').slice(0,1200);}

export function createSellerApi({databaseUrl=process.env.DATABASE_URL,run=runner}={}){
  async function query(statement,vars={}){
    const c=dbConnection(databaseUrl),args=[...c.args];
    for(const [k,v] of Object.entries(vars))args.push('-v',k+'='+String(v));
    args.push('-c',statement);
    const result=await run('psql',args,{env:c.env});
    if(!result.ok)throw new Error(clean(result.stderr||result.stdout||'database operation failed'));
    return String(result.stdout||'').trim();
  }
  async function json(statement,vars={}){return parse(await query(statement,vars));}
  async function current(accountId){
    uuid(accountId,'account_id');
    const account=await json("SELECT row_to_json(x)::text FROM (SELECT id,username,status,created_at FROM accounts WHERE id=:'id'::uuid) x",{id:accountId});
    if(!account)throw new Error('account not found');
    const stores=await json("SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.updated_at DESC),'[]'::json)::text FROM (SELECT id,slug,name,status,created_at,updated_at FROM mercora_stores WHERE owner_account_id=:'id'::uuid) x",{id:accountId});
    const listings=await json("SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.updated_at DESC),'[]'::json)::text FROM (SELECT l.id,l.title,l.status,l.price_atomic::text AS price_atomic,l.price_asset,l.condition,l.created_at,l.updated_at,c.name AS category,s.name AS store_name FROM listings l LEFT JOIN categories c ON c.id=l.category_id LEFT JOIN mercora_stores s ON s.id=l.store_id WHERE l.seller_account_id=:'id'::uuid ORDER BY l.updated_at DESC LIMIT 100) x",{id:accountId});
    return {account,stores:Array.isArray(stores)?stores:[],listings:Array.isArray(listings)?listings:[]};
  }
  async function siteSettingEnabled(key){
    const row=await json("SELECT row_to_json(x)::text FROM (SELECT value FROM site_settings WHERE key=:'key' LIMIT 1) x",{key});
    return row?.value==='true';
  }
  async function createStore(accountId,payload={}){
    uuid(accountId,'account_id');
    if(!await siteSettingEnabled('seller_registration_enabled'))throw new Error('seller registration is disabled');
    const name=text(payload.name,'name',2,120);
    const storeSlug=slug(payload.slug);
    const display=text(payload.display_name||name,'display_name',2,120);
    const account=await json("SELECT row_to_json(x)::text FROM (SELECT id,status FROM accounts WHERE id=:'id'::uuid) x",{id:accountId});
    if(!account||account.status!=='active')throw new Error('account is not active');
    const row=await json("WITH p AS (INSERT INTO seller_profiles(account_id,display_name) VALUES (:'id'::uuid,:'display') ON CONFLICT(account_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING account_id), s AS (INSERT INTO mercora_stores(slug,name,owner_account_id,status) VALUES (:'slug',:'name',:'id'::uuid,'active') RETURNING id,slug,name,status,owner_account_id,created_at,updated_at) SELECT row_to_json(s)::text FROM s",{id:accountId,display,slug:storeSlug,name});
    if(!row)throw new Error('store could not be created');
    return row;
  }
  async function createListing(accountId,payload={}){
    uuid(accountId,'account_id');
    if(!await siteSettingEnabled('new_listings_enabled'))throw new Error('new listings are disabled');
    const title=text(payload.title,'title',3,160);
    const description=text(payload.description,'description',1,10000);
    const condition=text(payload.condition||'used','condition',2,80);
    const asset=text(String(payload.price_asset||'').toUpperCase(),'price_asset',3,3);
    if(!ASSETS.has(asset))throw new Error('unsupported price asset');
    const amount=atomic(payload.price_atomic,'price_atomic');
    if(BigInt(amount)<=0n)throw new Error('price_atomic must be greater than zero');
    const category=text(String(payload.category_slug||'').toLowerCase(),'category_slug',3,63);
    const storeId=uuid(payload.store_id,'store_id');
    const store=await json("SELECT row_to_json(x)::text FROM (SELECT id,status FROM mercora_stores WHERE id=:'store'::uuid AND owner_account_id=:'account'::uuid) x",{store:storeId,account:accountId});
    if(!store)throw new Error('store not found or not owned by account');
    const categoryRow=await json("SELECT row_to_json(x)::text FROM (SELECT id FROM categories WHERE slug=:'category' AND active=true) x",{category});
    if(!categoryRow)throw new Error('category not found');
    const status=payload.publish&&store.status==='active'?'active':'draft';
    const row=await json("INSERT INTO listings(seller_account_id,category_id,title,description,price_atomic,price_asset,condition,status,store_id) VALUES (:'account'::uuid,:'category'::uuid,:'title',:'description',:'amount',:'asset',:'condition',:'status',:'store'::uuid) RETURNING id,title,description,price_atomic::text AS price_atomic,price_asset,condition,status,created_at,updated_at",{account:accountId,category:categoryRow.id,title,description,amount,asset,condition,status,store:storeId});
    if(!row)throw new Error('listing could not be created');
    return row;
  }
  async function setListingStatus(accountId,payload={}){
    uuid(accountId,'account_id');
    const listingId=uuid(payload.listing_id,'listing_id');
    const status=text(String(payload.status||'').toLowerCase(),'status',3,20);
    if(!['draft','active','archived'].includes(status))throw new Error('unsupported seller listing status');
    const row=await json("UPDATE listings SET status=:'status',updated_at=now() WHERE id=:'listing'::uuid AND seller_account_id=:'account'::uuid RETURNING id,title,status,updated_at",{status,listing:listingId,account:accountId});
    if(!row)throw new Error('listing not found or not owned by account');
    return row;
  }
  return Object.freeze({current,createStore,createListing,setListingStatus});
}
