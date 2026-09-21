const name=new URLSearchParams(location.search).get('name');
const title=document.querySelector('#sellerName');
const stats=document.querySelector('#sellerStats');
const grid=document.querySelector('#sellerListings');
const message=document.querySelector('#sellerMessage');

function money(amount,asset){
  const scale={BTC:8,LTC:8,XMR:12}[asset]??0;
  const raw=String(amount??'0'),digits=raw.replace(/^-/,'');
  const padded=digits.padStart(scale+1,'0');
  const whole=padded.slice(0,-scale||padded.length);
  const fraction=scale?'.'+padded.slice(-scale).replace(/0+$/,''):'';
  return (raw.startsWith('-')?'-':'')+whole+fraction+' '+asset;
}

async function load(){
  if(!name){title.textContent='Vendedor no encontrado';return;}
  try{
    const response=await fetch('./api/sellers/'+encodeURIComponent(name),{cache:'no-store',headers:{Accept:'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Vendedor no disponible');
    title.textContent=data.display_name||name;
    document.title=(data.display_name||name)+' — MERCORA';
    const rating=data.rating_average===null||data.rating_average===undefined?'': ' · ★ '+data.rating_average;
    stats.textContent='✓ '+(data.verified_sales_count||'0')+' ventas verificadas · '+(data.verified_units_sold||'0')+' unidades · '+(data.verified_rating_count||'0')+' valoraciones'+rating;
    grid.replaceChildren();
    for(const item of data.listings||[]){
      const card=document.createElement('article');
      card.className='product';
      const art=document.createElement('div');art.className='product-art';art.textContent=String(item.category||'MRC').slice(0,3).toUpperCase();
      const body=document.createElement('div');body.className='product-body';
      const h=document.createElement('h3');h.className='product-title';
      const link=document.createElement('a');link.href='./listing.html?id='+encodeURIComponent(item.id);link.textContent=item.title;
      h.append(link);
      const meta=document.createElement('div');meta.className='product-meta';meta.textContent=(item.category||'')+' · '+(item.condition||'');
      const foot=document.createElement('div');foot.className='product-footer';
      const price=document.createElement('span');price.className='price';price.textContent=money(item.price_atomic,item.price_asset);
      foot.append(price);body.append(h,meta,foot);card.append(art,body);grid.append(card);
    }
    message.textContent=(data.listings||[]).length?'':'No hay anuncios activos.';
  }catch(error){message.textContent=error.message||String(error);}
}
load();
