const invoke = window.__TAURI__?.core?.invoke;
const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const form = document.querySelector('#login-form');
const tokenInput = document.querySelector('#token');
const loginError = document.querySelector('#login-error');
const output = document.querySelector('#output');
const grid = document.querySelector('#status-grid');
const overall = document.querySelector('#overall');
const services = ['MERCORA','TOR','BACKEND','POSTGRESQL','ONION SERVICE','STORAGE','HEALTH CHECKS'];
const healthyStates = new Set(['ONLINE','OK','RUNNING','CONFIGURED']);
const badStates = new Set(['OFFLINE','ERROR','STOPPED']);
const SESSION_IDLE_MS = 15 * 60 * 1000;
const ACTIONS = Object.freeze({
  start: { action: 'START', service: 'app' },
  restart: { action: 'RESTART', service: 'app' },
  stop: { action: 'STOP', service: 'app' },
  torStart: { action: 'START', service: 'tor' },
  torRestart: { action: 'RESTART', service: 'tor' },
  recover: { action: 'RECOVER', service: 'app' },
  health: { action: 'HEALTH_CHECK' }
});
let authenticated = false, lastActivity = 0, refreshTimer = null, actionInProgress = false;
function markActivity(){lastActivity=Date.now()}
function showDashboard(){login.classList.add('hidden');dashboard.classList.remove('hidden');markActivity()}
function stateClass(state){if(healthyStates.has(state))return'ok';if(badStates.has(state))return'bad';return'unknown'}
function render(status){const values={MERCORA:status.mercora??'unknown',TOR:status.tor??'unknown',BACKEND:status.backend??'unknown',POSTGRESQL:status.postgresql??'unknown','ONION SERVICE':status.onionService??'unknown',STORAGE:status.storage??'unknown','HEALTH CHECKS':status.health??'unknown'};grid.replaceChildren();for(const name of services){const state=String(values[name]).toUpperCase();const card=document.createElement('article');card.className='status-card';const nameElement=document.createElement('div');nameElement.className='name';nameElement.textContent=name;const stateElement=document.createElement('div');stateElement.className=`state ${stateClass(state)}`;stateElement.textContent=state;card.append(nameElement,stateElement);grid.appendChild(card)}const allGood=['MERCORA','TOR','BACKEND','POSTGRESQL','HEALTH CHECKS'].every(key=>healthyStates.has(String(values[key]).toUpperCase()));overall.textContent=allGood?'ONLINE':'DEGRADED';overall.className=`badge ${allGood?'ok':'bad'}`}
async function request(method,path,body){if(!invoke)throw new Error('Tauri runtime unavailable');markActivity();return JSON.parse(await invoke('admin_request',{method,path,body:body?JSON.stringify(body):null}))}
async function refresh(){if(!authenticated)return;if(Date.now()-lastActivity>SESSION_IDLE_MS){await logout();loginError.textContent='Session expired due to inactivity.';loginError.hidden=false;return}try{render(await request('GET','/api/admin/status'))}catch(error){overall.textContent='OFFLINE';overall.className='badge bad';output.textContent=String(error.message||error)}}
async function logout(){authenticated=false;if(refreshTimer){window.clearInterval(refreshTimer);refreshTimer=null}await invoke?.('clear_token').catch(()=>{});dashboard.classList.add('hidden');login.classList.remove('hidden');tokenInput.value='';markActivity()}
form.addEventListener('submit',async event=>{event.preventDefault();loginError.hidden=true;try{await invoke('set_token',{token:tokenInput.value});await request('GET','/api/admin/status');authenticated=true;tokenInput.value='';showDashboard();await refresh();refreshTimer=window.setInterval(refresh,15000)}catch(error){await invoke('clear_token').catch(()=>{});loginError.textContent='Connection failed. Check the local Admin Control API and token.';loginError.hidden=false}});
document.querySelector('#logout').addEventListener('click',logout);
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{if(!authenticated||actionInProgress)return;actionInProgress=true;for(const candidate of document.querySelectorAll('[data-action]'))candidate.disabled=true;markActivity();const action=ACTIONS[button.dataset.action];output.textContent=`Executing ${action?.action??'UNKNOWN'}...`;try{if(!action)throw new Error('Unsupported console action');const result=await request('POST','/api/admin/action',action);output.textContent=JSON.stringify(result,null,2);await refresh()}catch(error){output.textContent=String(error.message||error)}finally{actionInProgress=false;for(const candidate of document.querySelectorAll('[data-action]'))candidate.disabled=false}}));
['pointerdown','keydown'].forEach(eventName=>document.addEventListener(eventName,()=>{if(authenticated)markActivity()},{passive:true}));
render({});
