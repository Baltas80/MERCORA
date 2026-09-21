const message=document.querySelector('#message');
const loginForm=document.querySelector('#loginForm');
const registerForm=document.querySelector('#registerForm');
const authPanel=document.querySelector('#authPanel');
const accountPanel=document.querySelector('#accountPanel');
const accountName=document.querySelector('#accountName');
const accountStatus=document.querySelector('#accountStatus');
const sellerLink=document.querySelector('#sellerLink');
const ordersList=document.querySelector('#ordersList');

async function api(path,options={}){
  const response=await fetch(path,{cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',...(options.headers||{})},...options});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||('HTTP '+response.status));
  return body;
}
function showMessage(value,ok=false){
  message.textContent=value;
  message.className=ok?'success':'error';
}
async function loadOrders(){
  try{
    const response=await api('./api/orders');
    ordersList.replaceChildren();
    for(const order of response.orders||[]){
      const row=document.createElement('div');
      row.className='cart-line';
      const label=document.createElement('span');
      label.textContent=order.id+' · '+order.status+' · '+order.total_atomic+' '+order.total_asset+' · '+order.item_count+' artículo(s)';
      row.append(label);
      if(['pending','awaiting_payment'].includes(order.status)){
        const cancel=document.createElement('button');
        cancel.className='button button-ghost';
        cancel.type='button';
        cancel.textContent='CANCELAR';
        cancel.onclick=async()=>{
          if(!confirm('¿Cancelar este pedido?'))return;
          try{
            await api('./api/orders/'+encodeURIComponent(order.id)+'/cancel',{method:'POST',body:'{}'});
            showMessage('Pedido cancelado.',true);
            await loadOrders();
          }catch(error){showMessage(error.message);}
        };
        row.append(cancel);
      }
      ordersList.append(row);
    }
    if(!(response.orders||[]).length){
      const empty=document.createElement('p');empty.className='muted';empty.textContent='Todavía no hay pedidos.';ordersList.append(empty);
    }
  }catch(error){ordersList.textContent=error.message||String(error);}
}
async function refresh(){
  const body=await api('./api/auth/me');
  const account=body.account;
  authPanel.hidden=Boolean(account);
  accountPanel.hidden=!account;
  if(account){
    accountName.textContent=account.username;
    accountStatus.textContent=account.status;
    sellerLink.hidden=false;
    await loadOrders();
  }else{
    sellerLink.hidden=true;
    ordersList.replaceChildren();
  }
}
loginForm.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('./api/auth/login',{method:'POST',body:JSON.stringify({username:loginForm.elements.username.value,password:loginForm.elements.password.value})});
    loginForm.reset();
    showMessage('Sesión iniciada.',true);
    await refresh();
    if(sessionStorage.getItem('mercora_checkout_return')==='1'){
      sessionStorage.removeItem('mercora_checkout_return');
      location.href='./#catalog';
    }
  }catch(error){showMessage(error.message);}
});
registerForm.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('./api/auth/register',{method:'POST',body:JSON.stringify({username:registerForm.elements.username.value,password:registerForm.elements.password.value})});
    registerForm.reset();
    showMessage('Cuenta creada y sesión iniciada.',true);
    await refresh();
    if(sessionStorage.getItem('mercora_checkout_return')==='1'){
      sessionStorage.removeItem('mercora_checkout_return');
      location.href='./#catalog';
    }
  }catch(error){showMessage(error.message);}
});
document.querySelector('#logout').addEventListener('click',async()=>{
  try{
    await api('./api/auth/logout',{method:'POST',body:'{}'});
    showMessage('Sesión cerrada.',true);
    await refresh();
  }catch(error){showMessage(error.message);}
});
refresh().catch(error=>showMessage(error.message));
