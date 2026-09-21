import { spawn } from "node:child_process";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSETS=new Set(["BTC","LTC","XMR"]);
const MAX_ITEMS=48;

function uuid(value,name){
  const v=String(value??"");
  if(!UUID_RE.test(v))throw new Error(name+" is not a valid UUID");
  return v;
}
function quantity(value,name){
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>1)throw new Error(name+" must be 1");
  return n;
}
function sql(value){return "'"+String(value).replaceAll("'","''")+"'";}
function dbConnection(url){
  if(!url)throw new Error("database is not configured");
  let c;try{c=new URL(url);}catch{throw new Error("database configuration is invalid");}
  if(!["postgres:","postgresql:"].includes(c.protocol)||!c.hostname||!c.pathname)throw new Error("database configuration is invalid");
  return {
    args:["-X","-q","-At","-v","ON_ERROR_STOP=1","--host",c.hostname,"--port",c.port||"5432","--username",decodeURIComponent(c.username),"--dbname",decodeURIComponent(c.pathname.replace(/^\//,""))],
    env:{...process.env,PGAPPNAME:"mercora-orders",PGPASSWORD:decodeURIComponent(c.password||"")}
  };
}
function runner(file,args,options={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"],env:options.env||process.env});
    const out=[];const err=[];
    child.stdout.on("data",c=>out.push(c));child.stderr.on("data",c=>err.push(c));
    child.on("error",e=>resolve({ok:false,code:null,stdout:"",stderr:e.message}));
    child.on("close",code=>resolve({ok:code===0,code,stdout:Buffer.concat(out).toString("utf8"),stderr:Buffer.concat(err).toString("utf8")}));
  });
}
function parse(stdout){
  const text=String(stdout||"").trim();
  if(!text)return null;
  try{const value=JSON.parse(text);return Array.isArray(value)?(value[0]||null):value;}catch{throw new Error("database returned invalid order JSON");}
}
function clean(text){
  return String(text||"").split(/\r?\n/)
    .filter(line=>!/(password|secret|token|private.?key|mnemonic|authorization|database_url)/i.test(line))
    .join(" ").slice(0,1500);
}

export function createOrderApi({databaseUrl=process.env.DATABASE_URL,run=runner}={}){
  async function query(statement,vars={}){
    const c=dbConnection(databaseUrl),args=[...c.args];
    for(const [key,value] of Object.entries(vars))args.push("-v",key+"="+String(value));
    args.push("-c",statement);
    const result=await run("psql",args,{env:c.env});
    if(!result.ok)throw new Error(clean(result.stderr||result.stdout||"database operation failed"));
    return String(result.stdout||"").trim();
  }
  async function json(statement,vars={}){return parse(await query(statement,vars));}

  async function siteMode(){
    const row=await json("SELECT row_to_json(x)::text FROM (SELECT value FROM site_settings WHERE key='site_mode' LIMIT 1) x");
    return row?.value||"public";
  }

  async function createOrder(accountId,payload={}){
    uuid(accountId,"account_id");
    const mode=await siteMode();
    if(mode!=="public")throw new Error("orders are disabled while the marketplace is not public");
    if(!Array.isArray(payload.items)||payload.items.length<1||payload.items.length>MAX_ITEMS)throw new Error("items must contain 1-48 listings");
    const items=payload.items.map((item,index)=>({
      index,
      listing_id:uuid(item?.listing_id,"items["+index+"].listing_id"),
      quantity:quantity(item?.quantity??1,"items["+index+"].quantity")
    }));
    const ids=items.map(item=>sql(item.listing_id)).join(",");
    const totalCount=items.length;
    const statement=`
      WITH selected AS (
        SELECT l.id,l.seller_account_id,l.price_atomic,l.price_asset
        FROM listings l
        WHERE l.id IN (${ids})
          AND l.status='active'
        FOR UPDATE
      ),
      eligible AS (
        SELECT
          COUNT(*) AS item_count,
          COUNT(DISTINCT price_asset) AS asset_count,
          MAX(price_asset) AS price_asset,
          SUM(price_atomic) AS total_atomic
        FROM selected
      ),
      inserted AS (
        INSERT INTO orders(buyer_account_id,status,total_atomic,total_asset)
        SELECT :'account_id'::uuid,'awaiting_payment',e.total_atomic,e.price_asset
        FROM eligible e
        WHERE e.item_count=${totalCount}
          AND e.asset_count=1
          AND e.total_atomic > 0
          AND length(e.total_atomic::text)<=78
        RETURNING id,buyer_account_id,status,total_atomic::text AS total_atomic,total_asset,created_at,updated_at
      ),
      inserted_items AS (
        INSERT INTO order_items(order_id,listing_id,seller_account_id,quantity,unit_price_atomic,asset_code)
        SELECT i.id,s.id,s.seller_account_id,1,s.price_atomic,s.price_asset
        FROM inserted i
        CROSS JOIN selected s
        RETURNING order_id
      ),
      reserved AS (
        UPDATE listings l
        SET status='reserved',updated_at=now()
        FROM selected s
        WHERE l.id=s.id
          AND EXISTS (SELECT 1 FROM inserted_items)
        RETURNING l.id
      )
      SELECT row_to_json(inserted)::text FROM inserted;
    `;
    const order=await json(statement,{account_id:accountId});
    if(!order){
      throw new Error("cart contains an unavailable listing, mixed assets, duplicate or invalid item");
    }
    return order;
  }

  async function listOrders(accountId){
    uuid(accountId,"account_id");
    return json(
      `SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::json)::text
       FROM (
         SELECT o.id,o.status,o.total_atomic::text AS total_atomic,o.total_asset,o.created_at,o.updated_at,
                COUNT(oi.listing_id)::integer AS item_count
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id=o.id
         WHERE o.buyer_account_id=:'account_id'::uuid
         GROUP BY o.id,o.status,o.total_atomic,o.total_asset,o.created_at,o.updated_at
         ORDER BY o.created_at DESC
         LIMIT 100
       ) x`,
      {account_id:accountId}
    );
  }

  return Object.freeze({createOrder,listOrders});
}
