const invoke = window.__TAURI__?.core?.invoke;
const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const form = document.querySelector('#login-form');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const loginError = document.querySelector('#login-error');
const output = document.querySelector('#output');
const grid = document.querySelector('#status-grid');
const overall = document.querySelector('#overall');
const services = ['MERCORA','NODE.JS','POSTGRESQL','TOR','BACKEND','ONION SERVICE','STORAGE','HEALTH CHECKS'];
const healthyStates = new Set(['ONLINE','OK','RUNNING','CONFIGURED']);
const badStates = new Set(['OFFLINE','ERROR','STOPPED']);
const SESSION_IDLE_MS = 15 * 60 * 1000;
const ACTIONS = Object.freeze({
  start: { action: 'START' },
  restart: { action: 'RESTART' },
  stop: { action: 'STOP' },
  postgresStart: { action: 'START', service: 'postgres' },
  postgresRestart: { action: 'RESTART', service: 'postgres' },
  postgresStop: { action: 'STOP', service: 'postgres' },
  torStart: { action: 'START', service: 'tor' },
  torRestart: { action: 'RESTART', service: 'tor' },
  torStop: { action: 'STOP', service: 'tor' },
  recover: { action: 'RECOVER' },
  postgresRecover: { action: 'RECOVER', service: 'postgres' },
  torRecover: { action: 'RECOVER', service: 'tor' },
  health: { action: 'HEALTH_CHECK' }
});
let authenticated = false, lastActivity = 0, refreshTimer = null, actionInProgress = false;
function markActivity(){lastActivity=Date.now()}
function showDashboard(){login.classList.add('hidden');dashboard.classList.remove('hidden');markActivity()}
function stateClass(state){if(healthyStates.has(state))return'ok';if(badStates.has(state))return'bad';return'unknown'}
function render(status){const values={MERCORA:status.mercora??'unknown','NODE.JS':status.node??'unknown',POSTGRESQL:status.postgresql??'unknown',TOR:status.tor??'unknown',BACKEND:status.backend??'unknown','ONION SERVICE':status.onionService??'unknown',STORAGE:status.storage??'unknown','HEALTH CHECKS':status.health??'unknown'};grid.replaceChildren();for(const name of services){const state=String(values[name]).toUpperCase();const card=document.createElement('article');card.className='status-card';const nameElement=document.createElement('div');nameElement.className='name';nameElement.textContent=name;const stateElement=document.createElement('div');stateElement.className=`state ${stateClass(state)}`;stateElement.textContent=state;card.append(nameElement,stateElement);grid.appendChild(card)}const allGood=['MERCORA','NODE.JS','POSTGRESQL','TOR','BACKEND','HEALTH CHECKS'].every(key=>healthyStates.has(String(values[key]).toUpperCase()));overall.textContent=allGood?'ONLINE':'DEGRADED';overall.className=`badge ${allGood?'ok':'bad'}`}
async function request(method,path,body){if(!invoke)throw new Error('Tauri runtime unavailable');markActivity();return JSON.parse(await invoke('admin_request',{method,path,body:body?JSON.stringify(body):null}))}
async function connect(){loginError.hidden=true;try{showDashboard();await refresh();refreshTimer=window.setInterval(refresh,15000)}catch(error){authenticated=false;dashboard.classList.add('hidden');login.classList.remove('hidden');const message=String(error?.message||error||'Unknown Admin Control API error');loginError.textContent=`Admin Control API error: ${message}`;loginError.hidden=false;await invoke?.('admin_logout').catch(()=>{})}}
async function refresh(){if(!authenticated)return;if(Date.now()-lastActivity>SESSION_IDLE_MS){await logout();loginError.textContent='Session expired due to inactivity.';loginError.hidden=false;return}try{render(await request('GET','/api/admin/status'))}catch(error){const message=String(error?.message||error||'Unknown Admin Control API error');if(message.includes('401')){await logout();loginError.textContent=`Session expired: ${message}`;loginError.hidden=false;return}overall.textContent='OFFLINE';overall.className='badge bad';output.textContent=message}}
async function logout(){authenticated=false;if(refreshTimer){window.clearInterval(refreshTimer);refreshTimer=null}await invoke?.('admin_logout').catch(()=>{});dashboard.classList.add('hidden');login.classList.remove('hidden');passwordInput.value='';markActivity();usernameInput.focus()}
form.addEventListener('submit',async event=>{event.preventDefault();loginError.hidden=true;const username=usernameInput.value.trim();const password=passwordInput.value;if(!username||!password){loginError.textContent='Username and password are required.';loginError.hidden=false;return}try{await invoke('admin_login',{username,password});authenticated=true;passwordInput.value='';await connect()}catch(error){authenticated=false;await invoke('admin_logout').catch(()=>{});loginError.textContent=String(error?.message||error||'Unable to authenticate with the Admin Control API.');loginError.hidden=false}});
document.querySelector('#logout').addEventListener('click',logout);
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{if(!authenticated||actionInProgress)return;actionInProgress=true;for(const candidate of document.querySelectorAll('[data-action]'))candidate.disabled=true;markActivity();const action=ACTIONS[button.dataset.action];output.textContent=`Executing ${action?.action??'UNKNOWN'}${action?.service?` ${action.service}`:''}...`;try{if(!action)throw new Error('Unsupported console action');const result=await request('POST','/api/admin/action',action);output.textContent=JSON.stringify(result,null,2);await refresh()}catch(error){output.textContent=String(error?.message||error||'Unknown Admin Control API error')}finally{actionInProgress=false;for(const candidate of document.querySelectorAll('[data-action]'))candidate.disabled=false}}));
['pointerdown','keydown'].forEach(eventName=>document.addEventListener(eventName,()=>{if(authenticated)markActivity()},{passive:true}));
render({});
usernameInput.focus();
