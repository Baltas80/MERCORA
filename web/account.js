const message=document.querySelector('#message');
const loginForm=document.querySelector('#loginForm');
const registerForm=document.querySelector('#registerForm');
const authPanel=document.querySelector('#authPanel');
const accountPanel=document.querySelector('#accountPanel');
const accountName=document.querySelector('#accountName');
const accountStatus=document.querySelector('#accountStatus');
const sellerLink=document.querySelector('#sellerLink');

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
async function refresh(){
  const body=await api('./api/auth/me');
  const account=body.account;
  authPanel.hidden=Boolean(account);
  accountPanel.hidden=!account;
  if(account){
    accountName.textContent=account.username;
    accountStatus.textContent=account.status;
    sellerLink.hidden=false;
  }else{
    sellerLink.hidden=true;
  }
}
loginForm.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('./api/auth/login',{method:'POST',body:JSON.stringify({username:loginForm.elements.username.value,password:loginForm.elements.password.value})});
    loginForm.reset();
    showMessage('Sesión iniciada.',true);
    await refresh();
  }catch(error){showMessage(error.message);}
});
registerForm.addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('./api/auth/register',{method:'POST',body:JSON.stringify({username:registerForm.elements.username.value,password:registerForm.elements.password.value})});
    registerForm.reset();
    showMessage('Cuenta creada y sesión iniciada.',true);
    await refresh();
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
