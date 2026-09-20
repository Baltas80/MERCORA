import {applyTranslations,getLocale,setLocale,t} from "./i18n.js";

const PREVIEW = location.hostname.endsWith(".github.io") || new URLSearchParams(location.search).has("preview");
const SAMPLE_ITEMS=[
  {id:"preview-1",title:"ThinkPad X1 Carbon Gen 9",seller_id:"northstar",currency:"EUR",price_minor:48900,category:"Computing"},
  {id:"preview-2",title:"Fujifilm X-T4 Body",seller_id:"grainlab",currency:"EUR",price_minor:92500,category:"Cameras"},
  {id:"preview-3",title:"Mechanical Keyboard — Brass Edition",seller_id:"keystatic",currency:"EUR",price_minor:17900,category:"Computing"},
  {id:"preview-4",title:"Vintage Desk Lamp",seller_id:"atelier7",currency:"EUR",price_minor:7400,category:"Home"},
  {id:"preview-5",title:"Sony WH-1000XM5",seller_id:"signalroom",currency:"EUR",price_minor:24900,category:"Electronics"},
  {id:"preview-6",title:"Leica M6 Strap",seller_id:"analogworks",currency:"EUR",price_minor:6200,category:"Collectibles"},
  {id:"preview-7",title:"Arc Utility Jacket",seller_id:"northline",currency:"EUR",price_minor:11800,category:"Clothing"},
  {id:"preview-8",title:"Precision Hand Tool Set",seller_id:"benchmarks",currency:"EUR",price_minor:15600,category:"Tools"}
];

const state={items:PREVIEW?[...SAMPLE_ITEMS]:[],cart:[],locale:getLocale(),authenticated:PREVIEW};
const grid=document.querySelector("#productGrid");
const count=document.querySelector("#resultCount");
const cartCount=document.querySelector("#cartCount");
const dialog=document.querySelector("#cartDialog");
const cartItems=document.querySelector("#cartItems");
const cartTotal=document.querySelector("#cartTotal");
const language=document.querySelector("#languageSelect");
const searchInput=document.querySelector("#searchInput");

function money(minor,currency,locale=state.locale){
  return new Intl.NumberFormat(locale,{style:"currency",currency}).format(Number(minor)/100);
}
async function api(path,options={}){
  const r=await fetch("/api"+path,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||d.detail||"request_failed");
  return d;
}
function csrf(){
  const m=document.cookie.match(/(?:^|; )mercora_csrf=([^;]+)/);
  return m?decodeURIComponent(m[1]):"";
}
function render(){
  applyTranslations(state.locale);
  if(language) language.value=state.locale;
  if(count) count.textContent=state.items.length+" "+t("listings",state.locale);
  if(grid){
    grid.replaceChildren();
    for(const p of state.items){
      const card=document.createElement("article");
      card.className="product";
      const art=document.createElement("div");
      art.className="product-art";
      art.textContent=p.category?.slice(0,3).toUpperCase()||"ITEM";
      const body=document.createElement("div");
      body.className="product-body";
      const title=document.createElement("h3");
      title.className="product-title";
      title.textContent=p.title;
      const meta=document.createElement("div");
      meta.className="product-meta";
      meta.textContent=p.seller_id+" · "+p.currency+" · "+p.category;
      const foot=document.createElement("div");
      foot.className="product-footer";
      const price=document.createElement("span");
      price.className="price";
      price.textContent=money(p.price_minor,p.currency);
      const add=document.createElement("button");
      add.className="add";
      add.type="button";
      add.dataset.id=p.id;
      add.textContent=PREVIEW?"Add to preview":"Add";
      foot.append(price,add);
      body.append(title,meta,foot);
      card.append(art,body);
      grid.append(card);
    }
  }
  if(cartItems){
    cartItems.replaceChildren();
    let total=0;
    for(const item of state.cart){
      total+=Number(item.price_minor)*Number(item.quantity);
      const row=document.createElement("div");
      row.className="cart-line";
      row.textContent=item.title+" × "+item.quantity+" — "+money(item.price_minor*item.quantity,item.currency);
      cartItems.append(row);
    }
    if(!state.cart.length){
      const e=document.createElement("p");
      e.className="muted";
      e.textContent=PREVIEW?"Your preview cart is empty.":"Cart is empty.";
      cartItems.append(e);
    }
    cartTotal.textContent=state.cart[0]?money(total,state.cart[0].currency):"€0";
  }
  if(cartCount) cartCount.textContent=String(state.cart.reduce((n,x)=>n+x.quantity,0));
}

async function load(){
  if(PREVIEW){render();return;}
  try{await api("/auth/me");state.authenticated=true}catch{state.authenticated=false}
  try{state.items=(await api("/listings")).items}catch{state.items=[]}
  if(state.authenticated){try{state.cart=(await api("/cart")).items}catch{state.cart=[]}}
  render();
}

grid?.addEventListener("click",async e=>{
  const b=e.target.closest("[data-id]");
  if(!b)return;
  const item=SAMPLE_ITEMS.find(x=>x.id===b.dataset.id)||state.items.find(x=>x.id===b.dataset.id);
  if(PREVIEW){
    const existing=state.cart.find(x=>x.id===item.id);
    if(existing) existing.quantity+=1; else state.cart.push({...item,quantity:1});
    render();
    return;
  }
  if(!state.authenticated){location.href="./account.html?next="+encodeURIComponent(location.pathname);return;}
  try{
    await api("/cart",{method:"POST",headers:{"X-CSRF-Token":csrf()},body:JSON.stringify({listing_id:b.dataset.id,quantity:1})});
    state.cart=(await api("/cart")).items;
    render();
  }catch(err){alert(err.message)}
});

document.querySelector("#searchForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const q=(searchInput?.value||"").trim().toLowerCase();
  if(PREVIEW){
    state.items=q?SAMPLE_ITEMS.filter(p=>(p.title+" "+p.category+" "+p.seller_id).toLowerCase().includes(q)):[...SAMPLE_ITEMS];
    render();
    return;
  }
  try{
    state.items=(await api("/listings"+(q?"?q="+encodeURIComponent(q):""))).items;
    render();
  }catch(err){alert(err.message)}
});

document.querySelectorAll(".category").forEach(button=>{
  button.addEventListener("click",()=>{
    const category=button.dataset.category;
    if(PREVIEW){
      state.items=SAMPLE_ITEMS.filter(p=>p.category===category);
      render();
    }
  });
});

document.querySelector("#cartButton")?.addEventListener("click",()=>{
  render();
  dialog?.showModal();
});
document.querySelector("#closeCart")?.addEventListener("click",()=>dialog?.close());
document.querySelector("#checkoutButton")?.addEventListener("click",async()=>{
  if(PREVIEW){
    if(!state.cart.length)return;
    alert("PREVIEW: checkout simulada. No se crea ningún pedido ni pago real.");
    return;
  }
  if(!state.authenticated){location.href="./account.html?next="+encodeURIComponent(location.pathname);return;}
  if(!state.cart.length)return;
  const key=crypto.randomUUID()+crypto.randomUUID();
  try{
    const order=await api("/checkout",{method:"POST",headers:{"X-CSRF-Token":csrf()},body:JSON.stringify({idempotency_key:key})});
    const asset=(prompt("Activo de pago: BTC, LTC o XMR","BTC")||"BTC").toUpperCase();
    if(!["BTC","LTC","XMR"].includes(asset))return;
    const quote=await api("/payments/quote",{method:"POST",headers:{"X-CSRF-Token":csrf()},body:JSON.stringify({order_id:order.order_id,asset_code:asset})});
    const intent=await api("/payments/intent",{method:"POST",headers:{"X-CSRF-Token":csrf()},body:JSON.stringify({quote_id:quote.quote_id,idempotency_key:key+"-payment"})});
    alert("Payment intent creado: "+intent.asset_code+" "+intent.amount_atomic);
    dialog?.close();
    state.cart=[];
  }catch(err){alert(err.message)}
});
language?.addEventListener("change",()=>{
  state.locale=setLocale(language.value);
  render();
});
load();