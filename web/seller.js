const message=document.querySelector('#sellerMessage');
const authState=document.querySelector('#authState');
const storeForm=document.querySelector('#storeForm');
const listingForm=document.querySelector('#listingForm');
const storeSelect=document.querySelector('#storeSelect');
const categorySelect=document.querySelector('#categorySelect');
const storesList=document.querySelector('#storesList');
const listingsList=document.querySelector('#listingsList');

async function api(path,options={}){
  const response=await fetch(path,{cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',...(options.headers||{})},...options});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||('HTTP '+response.status));
  return body;
}
function show(value,ok=false){
  message.textContent=value;
  message.className=ok?'success':'error';
}
function render(state){
  authState.textContent=state?.account?('Conectado como '+state.account.username):'Necesitas una cuenta activa.';
  storeSelect.replaceChildren(new Option('Selecciona tienda…',''));
  (state?.stores||[]).forEach(s=>storeSelect.append(new Option(s.name+' — '+s.status,s.id)));
  storesList.replaceChildren();
  (state?.stores||[]).forEach(s=>{
    const li=document.createElement('li');
    li.textContent=s.name+' / '+s.slug+' · '+s.status;
    storesList.append(li);
  });
  listingsList.replaceChildren();
  (state?.listings||[]).forEach(l=>{
    const li=document.createElement('li');
    li.textContent=l.title+' · '+l.price_atomic+' '+l.price_asset+' · '+l.status;
    listingsList.append(li);
  });
}
async function refresh(){
  try{
    const state=await api('./api/seller');
    render(state);
    storeForm.hidden=!state.account;
    listingForm.hidden=!state.account;
  }catch(error){show(error.message);}
}
async function loadCategories(){
  try{
    const response=await api('./api/categories');
    categorySelect.replaceChildren(new Option('Selecciona categoría…',''));
    (response.categories||[]).forEach(c=>categorySelect.append(new Option(c.name,c.slug)));
  }catch(error){show(error.message);}
}
storeForm.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('./api/seller/store',{method:'POST',body:JSON.stringify({
      name:storeForm.elements.name.value,
      slug:storeForm.elements.slug.value,
      display_name:storeForm.elements.display_name.value
    })});
    storeForm.reset();
    show('Tienda creada.',true);
    await refresh();
  }catch(error){show(error.message);}
});
listingForm.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('./api/seller/listings',{method:'POST',body:JSON.stringify({
      store_id:storeSelect.value,
      title:listingForm.elements.title.value,
      description:listingForm.elements.description.value,
      condition:listingForm.elements.condition.value,
      price_atomic:listingForm.elements.price_atomic.value,
      price_asset:listingForm.elements.price_asset.value,
      category_slug:categorySelect.value,
      publish:listingForm.elements.publish.checked
    })});
    listingForm.reset();
    show('Anuncio guardado.',true);
    await refresh();
  }catch(error){show(error.message);}
});
document.querySelector('#sellerLogout').addEventListener('click',async()=>{
  await api('./api/auth/logout',{method:'POST',body:'{}'}).catch(()=>{});
  location.href='./account.html';
});
Promise.all([refresh(),loadCategories()]);
