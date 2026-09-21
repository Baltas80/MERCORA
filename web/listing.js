const params=new URLSearchParams(location.search);
const id=params.get('id');
const title=document.querySelector('#listingTitle');
const category=document.querySelector('#listingCategory');
const price=document.querySelector('#listingPrice');
const seller=document.querySelector('#listingSeller');
const description=document.querySelector('#listingDescription');
const art=document.querySelector('#listingArt');
const message=document.querySelector('#listingMessage');
const add=document.querySelector('#addButton');
let item=null;

function money(amount,asset){
  const scale={BTC:8,LTC:8,XMR:12}[asset]??0;
  const raw=String(amount??'0'),negative=raw.startsWith('-'),digits=negative?raw.slice(1):raw;
  const padded=digits.padStart(scale+1,'0');
  const whole=padded.slice(0,-scale||padded.length);
  const fraction=scale?'.'+padded.slice(-scale).replace(/0+$/,''):'';
  return (negative?'-':'')+whole+fraction+' '+asset;
}
async function load(){
  if(!id){message.textContent='Anuncio no encontrado.';add.disabled=true;return;}
  try{
    const response=await fetch('./api/listings/'+encodeURIComponent(id),{cache:'no-store',headers:{Accept:'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Anuncio no disponible');
    item=data;
    document.title=(data.title||'Anuncio')+' — MERCORA';
    title.textContent=data.title||'Anuncio';
    category.textContent=(data.category||'MERCORA').toUpperCase();
    price.textContent=money(data.price_atomic,data.price_asset);
    description.textContent=data.description||'';
    art.textContent=String(data.category||'MRC').slice(0,3).toUpperCase();
    const rating=data.rating_average===null||data.rating_average===undefined?'':' · ★ '+data.rating_average;
    seller.replaceChildren();
    const strong=document.createElement('strong');
    strong.textContent=data.seller||'Vendedor';
    const sellerLink=document.createElement('a');
    sellerLink.href='./seller.html?name='+encodeURIComponent(data.seller||'');
    sellerLink.className='muted';
    sellerLink.textContent='✓ '+(data.verified_sales_count||'0')+' ventas verificadas'+rating+' · '+(data.verified_rating_count||'0')+' valoraciones';
    seller.append(strong,sellerLink);
    add.disabled=false;
  }catch(error){
    message.textContent=error.message||String(error);
    add.disabled=true;
  }
}
add.addEventListener('click',()=>{
  if(!item)return;
  const key='mercora_cart';
  let cart=[];
  try{cart=JSON.parse(localStorage.getItem(key)||'[]');}catch{cart=[];}
  const existing=cart.find(x=>x.id===item.id);
  if(existing)existing.quantity+=1;else cart.push({...item,quantity:1});
  localStorage.setItem(key,JSON.stringify(cart));
  message.textContent='Añadido al carrito.';
});
load();
