const invoke = window.__TAURI__?.core?.invoke;
const login = document.querySelector('#login');
const twofa = document.querySelector('#twofa');
const consoleRoot = document.querySelector('#console');
const form = document.querySelector('#login-form');
const twofaForm = document.querySelector('#twofa-form');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const totpInput = document.querySelector('#totp');
const loginError = document.querySelector('#login-error');
const twofaError = document.querySelector('#twofa-error');
const view = document.querySelector('#view');
const toast = document.querySelector('#toast');

const SESSION_IDLE_MS = 15 * 60 * 1000;
let authenticated = false;
let lastActivity = 0;
let refreshTimer = null;
let activeTab = 'dashboard';
let busy = false;

const TAB_META = Object.freeze({
  dashboard: ['Dashboard','Business KPIs, service health and critical alerts'],
  custody: ['Custody & Funds','BTC/XMR hot, cold and emergency custody'],
  catalog: ['Product Catalog','Single-store products, stock, variants, prices and categories'],
  orders: ['Orders','Order lifecycle, payment state and refund controls'],
  customers: ['Customers & CRM','Accounts, membership, risk and support'],
  store: ['Store Builder','Public content, menus, banners and visual settings'],
  infrastructure: ['Infrastructure & Tor','Node.js, PostgreSQL, Tor, Onion Service and storage'],
  settings: ['Settings & Emergency','RBAC, audit integrity and Panic Mode']
});

function markActivity(){lastActivity=Date.now()}
function esc(v){return String(v ?? '').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
function showLogin(){authenticated=false;if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null}consoleRoot.classList.add('hidden');twofa.classList.add('hidden');login.classList.remove('hidden');passwordInput.value='';totpInput.value='';loginError.hidden=true;twofaError.hidden=true;usernameInput.focus()}
function showTwoFactor(){login.classList.add('hidden');consoleRoot.classList.add('hidden');twofa.classList.remove('hidden');twofaError.hidden=true;totpInput.value='';totpInput.focus()}
function showConsole(){login.classList.add('hidden');twofa.classList.add('hidden');consoleRoot.classList.remove('hidden');authenticated=true;markActivity();loadTab('dashboard');if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(()=>loadTab(activeTab),15000)}
async function request(method,path,body){if(!invoke)throw new Error('Tauri runtime unavailable');markActivity();return JSON.parse(await invoke('admin_request',{method,path,body:body?JSON.stringify(body):null}))}
function header(tab){const [title,subtitle]=TAB_META[tab];return `<div class="section-head"><div><p class="eyebrow">MERCORA ADMIN</p><h2>${esc(title)}</h2><p class="muted">${esc(subtitle)}</p></div></div>`}
function card(title,value,meta=''){return `<article class="metric"><div class="metric-title">${esc(title)}</div><div class="metric-value">${esc(value)}</div><div class="metric-meta">${esc(meta)}</div></article>`}
function empty(message){return `<div class="empty-state"><strong>${esc(message)}</strong><span>This console does not invent data. The module will bind to the corresponding transactional backend surface when that domain is enabled.</span></div>`}
function setBusy(value){busy=value;document.querySelectorAll('.tab').forEach(b=>b.disabled=value)}

async function loadTab(tab){
  if(!authenticated)return;
  if(Date.now()-lastActivity>SESSION_IDLE_MS){await logout();return}
  activeTab=tab;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  view.innerHTML='<div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  try{
    if(tab==='dashboard'||tab==='infrastructure'){
      const status=await request('GET','/api/admin/status');
      renderStatus(tab,status);
    }else if(tab==='settings'){
      renderSettings();
    }else{
      view.innerHTML=header(tab)+empty(TAB_META[tab][0]+' backend integration pending');
    }
  }catch(error){
    view.innerHTML=header(tab)+`<div class="empty-state"><strong>Control plane unavailable</strong><span>${esc(error?.message||error)}</span></div>`;
  }
}

function state(value){return String(value||'UNKNOWN').toUpperCase()}
function renderStatus(tab,status){
  const names=['MERCORA','NODE.JS','POSTGRESQL','TOR','BACKEND','ONION SERVICE','STORAGE','HEALTH'];
  const values={'MERCORA':status.mercora,'NODE.JS':status.node,'POSTGRESQL':status.postgresql,'TOR':status.tor,'BACKEND':status.backend,'ONION SERVICE':status.onionService,'STORAGE':status.storage,'HEALTH':status.health};
  view.innerHTML=header(tab)+'<div class="metrics">'+names.map(n=>card(n,state(values[n]))).join('')+
    '<div class="card"><h3>Service actions</h3><div class="button-row">'+
    '<button data-action="HEALTH_CHECK">HEALTH CHECK</button><button data-action="RECOVER" class="secondary">RECOVER AFFECTED</button>'+
    '</div></div>'+
    '<div class="card"><h3>Security boundary</h3><p class="muted">This UI has no wallet signing privileges. Private keys, seeds, mnemonics, wallet credentials and HSM material are outside the console boundary.</p></div>';
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{if(busy)return;setBusy(true);try{await request('POST','/api/admin/action',{action:b.dataset.action});showToast('Operation submitted');await loadTab(tab)}catch{showToast('Operation failed','error')}finally{setBusy(false)}}))
}

function renderSettings(){
  view.innerHTML=header('settings')+
  '<div class="card emergency"><p class="eyebrow">SUPREME CONTROL</p><h3>PANIC MODE</h3><p class="muted">Single-owner emergency control. Critical actions require fresh second-factor verification and remain fail-closed unless the isolated custody service is available.</p><div class="danger-grid"><button id="panic-freeze" class="danger">GLOBAL FREEZE</button><button id="panic-sweep" class="danger" disabled>EMERGENCY SWEEP</button></div><p class="muted">The console can trigger a control operation, but it never reads or displays signing material.</p></div>'+
  '<div class="card"><h3>RBAC</h3><p class="muted">Current owner role: SUPER_ADMIN (Better Auth admin role). The architecture remains ready for future least-privilege roles.</p></div>'+
  '<div class="card"><h3>Audit integrity</h3><p class="muted">Critical events should be recorded with a chained cryptographic integrity value. Do not store secrets in audit rows.</p></div>';
  document.querySelector('#panic-freeze').addEventListener('click',()=>showToast('Emergency endpoint requires the backend custody boundary','error'));
  document.querySelector('#panic-sweep').addEventListener('click',()=>showToast('Emergency sweep is fail-closed until isolated custody signing is connected','error'));
}

function showToast(message,kind='ok'){toast.textContent=message;toast.dataset.kind=kind;toast.hidden=false;setTimeout(()=>toast.hidden=true,3000)}
async function logout(){authenticated=false;if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null}await invoke?.('admin_logout').catch(()=>{});showLogin()}
form.addEventListener('submit',async e=>{e.preventDefault();loginError.hidden=true;try{const body=JSON.parse(await invoke('admin_login',{username:usernameInput.value.trim(),password:passwordInput.value}));if(body?.twoFactorRequired){showTwoFactor();return}showConsole()}catch{loginError.textContent='Authentication failed.';loginError.hidden=false}});
twofaForm.addEventListener('submit',async e=>{e.preventDefault();twofaError.hidden=true;const code=totpInput.value.trim();if(!/^\d{6}$/.test(code)){twofaError.textContent='Enter the 6-digit authenticator code.';twofaError.hidden=false;return}setBusy(true);try{await request('POST','/api/admin/auth/verify-2fa',{code});const session=await request('GET','/api/admin/auth/status');if(session?.ok&&session?.user?.role==='admin'){showConsole()}else{throw new Error('Administrator session could not be verified.')}}catch{await invoke?.('admin_logout').catch(()=>{});twofaError.textContent='2FA verification failed.';twofaError.hidden=false;totpInput.select()}finally{setBusy(false)}});
document.querySelector('#logout').addEventListener('click',logout);
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>loadTab(b.dataset.tab)));
['pointerdown','keydown'].forEach(name=>document.addEventListener(name,()=>{if(authenticated)markActivity()},{passive:true}));
showLogin();
