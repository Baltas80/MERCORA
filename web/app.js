async function applySiteConfig(){
  try{
    const response=await fetch('./api/site-config',{cache:'no-store'});
    if(!response.ok)return;
    const config=await response.json();
    document.title=(config.site_name||'MERCORA')+' — Marketplace';
    const brand=document.querySelector('.brand');if(brand)brand.textContent=config.site_name||'MERCORA';
    const heroTitle=document.querySelector('#heroTitle');if(heroTitle&&config.hero_title)heroTitle.textContent=config.hero_title;
    const heroCopy=document.querySelector('#heroCopy');if(heroCopy&&config.hero_copy)heroCopy.textContent=config.hero_copy;
    const buyCta=document.querySelector('#buyCta');if(buyCta&&config.buy_cta)buyCta.textContent=config.buy_cta;
    const sellCta=document.querySelector('#sellCta');if(sellCta&&config.sell_cta)sellCta.textContent=config.sell_cta;
    const announcement=document.querySelector('#siteAnnouncement');
    if(announcement&&config.announcement){announcement.textContent=config.announcement;announcement.hidden=false;}
    const maintenance=document.querySelector('#maintenanceNotice');
    if(maintenance&&config.site_mode==='maintenance'){
      maintenance.textContent=config.maintenance_message||'El marketplace está temporalmente en mantenimiento.';
      maintenance.hidden=false;
      document.querySelectorAll('.add,.hero-actions .button-primary,#checkoutButton').forEach(el=>{el.setAttribute('aria-disabled','true');el.classList.add('disabled')});
    }
    if(config.site_mode==='restricted'){
      const heroCopy=document.querySelector('.hero-copy');
      if(heroCopy)heroCopy.textContent='Acceso restringido. Algunas funciones del marketplace no están disponibles.';
    }
    const sellButton=document.querySelector('#sell .button-primary');
    if(sellButton&&config.seller_registration_enabled==='false'){sellButton.textContent='Registro de vendedores cerrado';sellButton.classList.add('disabled');sellButton.removeAttribute('href')}
    const footerName=document.querySelector('#footerSiteName');if(footerName)footerName.textContent=config.site_name||'MERCORA';
    const footerNotice=document.querySelector('#footerNotice');if(footerNotice&&config.footer_notice)footerNotice.textContent=config.footer_notice;
  }catch{}
}

import {applyTranslations,getLocale,t} from "./i18n.js";
const SAMPLE_ITEMS=[{id:"preview-1",title:"ThinkPad X1 Carbon Gen 9",seller_id:"northstar",currency:"EUR",price_minor:48900,category:"Computing"},{id:"preview-2",title:"Fujifilm X-T4 Body",seller_id:"grainlab",currency:"EUR",price_minor:92500,category:"Cameras"},{id:"preview-3",title:"Mechanical Keyboard — Brass Edition",seller_id:"keystatic",currency:"EUR",price_minor:17900,category:"Computing"},{id:"preview-4",title:"Vintage Desk Lamp",seller_id:"atelier7",currency:"EUR",price_minor:7400,category:"Home"},{id:"preview-5",title:"Sony WH-1000XM5",seller_id:"signalroom",currency:"EUR",price_minor:24900,category:"Electronics"},{id:"preview-6",title:"Leica M6 Strap",seller_id:"analogworks",currency:"EUR",price_minor:6200,category:"Collectibles"},{id:"preview-7",title:"Arc Utility Jacket",seller_id:"northline",currency:"EUR",price_minor:11800,category:"Clothing"},{id:"preview-8",title:"Precision Hand Tool Set",seller_id:"benchmarks",currency:"EUR",price_minor:15600,category:"Tools"}];
const state={items:[...SAMPLE_ITEMS],cart:[],locale:getLocale()};
const grid=document.querySelector("#productGrid"),count=document.querySelector("#resultCount"),cartCount=document.querySelector("#cartCount"),dialog=document.querySelector("#cartDialog"),cartItems=document.querySelector("#cartItems"),cartTotal=document.querySelector("#cartTotal"),searchInput=document.querySelector("#searchInput");
function money(minor,currency){return new Intl.NumberFormat(state.locale,{style:"currency",currency}).format(Number(minor)/100)}
function render(){applyTranslations(state.locale);if(count)count.textContent=state.items.length+" "+t("listings",state.locale);if(grid){grid.replaceChildren();for(const p of state.items){const card=document.createElement("article");card.className="product";const art=document.createElement("div");art.className="product-art";art.textContent=p.category.slice(0,3).toUpperCase();const body=document.createElement("div");body.className="product-body";const title=document.createElement("h3");title.className="product-title";title.textContent=p.title;const meta=document.createElement("div");meta.className="product-meta";meta.textContent=p.seller_id+" · "+p.currency+" · "+p.category;const foot=document.createElement("div");foot.className="product-footer";const price=document.createElement("span");price.className="price";price.textContent=money(p.price_minor,p.currency);const add=document.createElement("button");add.className="add";add.type="button";add.dataset.id=p.id;add.textContent="ADD";foot.append(price,add);body.append(title,meta,foot);card.append(art,body);grid.append(card)}}if(cartItems){cartItems.replaceChildren();let total=0;for(const item of state.cart){total+=item.price_minor*item.quantity;const row=document.createElement("div");row.className="cart-line";row.textContent=item.title+" × "+item.quantity+" — "+money(item.price_minor*item.quantity,item.currency);cartItems.append(row)}if(!state.cart.length){const e=document.createElement("p");e.className="muted";e.textContent="Your preview cart is empty.";cartItems.append(e)}cartTotal.textContent=state.cart[0]?money(total,state.cart[0].currency):"€0"}if(cartCount)cartCount.textContent=String(state.cart.reduce((n,x)=>n+x.quantity,0))}
grid?.addEventListener("click",e=>{const b=e.target.closest("[data-id]");if(!b)return;const item=SAMPLE_ITEMS.find(x=>x.id===b.dataset.id);const existing=state.cart.find(x=>x.id===item.id);if(existing)existing.quantity+=1;else state.cart.push({...item,quantity:1});render()});
document.querySelector("#searchForm")?.addEventListener("submit",e=>{e.preventDefault();const q=(searchInput?.value||"").trim().toLowerCase();state.items=q?SAMPLE_ITEMS.filter(p=>(p.title+" "+p.category+" "+p.seller_id).toLowerCase().includes(q)):[...SAMPLE_ITEMS];render()});
document.querySelectorAll(".category").forEach(b=>b.addEventListener("click",()=>{state.items=SAMPLE_ITEMS.filter(p=>p.category===b.dataset.category);render()}));
document.querySelector("#cartButton")?.addEventListener("click",()=>{render();dialog?.showModal()});document.querySelector("#closeCart")?.addEventListener("click",()=>dialog?.close());document.querySelector("#checkoutButton")?.addEventListener("click",()=>{if(state.cart.length)alert("PREVIEW: checkout simulada. No se crea ningún pedido ni pago real.")});render();


applySiteConfig();
