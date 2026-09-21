const invoke = window.__TAURI__?.core?.invoke;
const login = document.querySelector('#login');
const shell = document.querySelector('#app-shell');
const loginForm = document.querySelector('#login-form');
const tokenInput = document.querySelector('#token');
const loginError = document.querySelector('#login-error');
const pageTitle = document.querySelector('#page-title');
const systemBadge = document.querySelector('#system-badge');
const metricGrid = document.querySelector('#metric-grid');
const systemGrid = document.querySelector('#system-grid');
const systemOutput = document.querySelector('#system-output');
const nav = document.querySelector('#nav');
const output = document.querySelector('#system-control-output');
const SESSION_IDLE_MS = 15 * 60 * 1000;
const HEALTHY = new Set(['ONLINE','OK','RUNNING','CONFIGURED','PUBLIC']);
const BAD = new Set(['OFFLINE','ERROR','STOPPED','DEGRADED']);
let authenticated=false, lastActivity=0, refreshTimer=null, busy=false;

const viewTitles={
  dashboard:'Dashboard',users:'Usuarios',stores:'Tiendas',listings:'Anuncios',orders:'Pedidos',
  reports:'Reportes',promos:'Promociones',discounts:'Descuentos',categories:'Categorías',
  website:'Web',audit:'Auditoría',system:'Sistema'
};

function activity(){lastActivity=Date.now()}
function cls(value){const s=String(value||'UNKNOWN').toUpperCase();return HEALTHY.has(s)?'ok':BAD.has(s)?'bad':'unknown'}
function text(v){return v===null||v===undefined?'—':String(v)}
function shortId(v){const s=text(v);return s.length>14?s.slice(0,8)+'…'+s.slice(-4):s}
function date(v){if(!v)return'—';try{return new Date(v).toLocaleString()}catch{return text(v)}}
function moneyAtomic(v,a){if(a==='EUR')return (Number(v)/100).toFixed(2)+' EUR';return text(v)+' '+text(a)}
function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  document.querySelector('#view-'+name)?.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  pageTitle.textContent=viewTitles[name]||name;
  activity();
}
async function api(path,body=null){
  if(!invoke)throw new Error('Tauri runtime unavailable');
  activity();
  const raw=await invoke('admin_request',{method:body?'POST':'GET',path,body:body?JSON.stringify(body):null});
  return JSON.parse(raw);
}
async function management(action,payload={}){
  const result=await api('/v1/management',{action,payload});
  return result.result;
}
async function control(action,service){
  const r=await api('/v1/control',{action,service});
  return r;
}

function renderSystem(system){
  const src=(system&&system.components)?system.components:(system||{});
  const values=[
    ['MERCORA',src.mercora],['NODE.JS',src.node],['POSTGRESQL',src.postgres||src.postgresql],
    ['TOR',src.tor],['ONION SERVICE',src.onionService],['BACKEND',src.backend],
    ['STORAGE',src.storage],['HEALTH CHECKS',src.health]
  ];
  systemGrid.replaceChildren();
  values.forEach(([name,state])=>{
    const card=document.createElement('article');card.className='status-card';
    const n=document.createElement('div');n.className='name';n.textContent=name;
    const s=document.createElement('div');s.className='state '+cls(state);s.textContent=String(state??'UNKNOWN').toUpperCase();
    card.append(n,s);systemGrid.append(card);
  });
  const statusValues=values.slice(0,7).map(x=>String(x[1]??'').toUpperCase());
  const all=statusValues.filter(Boolean).length>0 && statusValues.every(v=>HEALTHY.has(v));
  systemBadge.textContent=all?'ONLINE':'DEGRADED';systemBadge.className='badge '+(all?'ok':'bad');
  document.querySelector('#system-overall').textContent=all?'ONLINE':'DEGRADED';
  document.querySelector('#system-overall').className='badge '+(all?'ok':'bad');
}

function renderMetrics(metrics){
  metricGrid.replaceChildren();
  const map=[
    ['Usuarios','users'],['Usuarios activos','active_users'],['Baneados','banned_users'],
    ['Tiendas','stores'],['Tiendas activas','active_stores'],['Anuncios activos','active_listings'],
    ['Anuncios bloqueados','blocked_listings'],['Reportes abiertos','open_reports'],
    ['Pedidos activos','active_orders'],['Promos activas','active_promos'],['Descuentos activos','active_discounts']
  ];
  map.forEach(([label,key])=>{
    const c=document.createElement('article');c.className='metric cardish';
    const l=document.createElement('span');l.textContent=label;
    const v=document.createElement('strong');v.textContent=text(metrics?.[key]??0);
    c.append(l,v);metricGrid.append(c);
  });
}

async function refreshDashboard(){
  try{
    const overview=await api('/v1/overview');
    renderSystem(overview.system);
    renderMetrics(overview.management);
    if(overview.managementError)systemOutput.textContent='Base de datos: '+overview.managementError;
  }catch(error){
    systemBadge.textContent='OFFLINE';systemBadge.className='badge bad';
    systemOutput.textContent=String(error.message||error);
  }
}

function rowCells(row,fields,actions){
  const tr=document.createElement('tr');
  fields.forEach(field=>{const td=document.createElement('td');td.textContent=field(row);tr.append(td)});
  const td=document.createElement('td');(actions||[]).forEach(a=>td.append(a));tr.append(td);return tr;
}

async function loadUsers(){
  const data=await management('LIST_USERS',{q:document.querySelector('#users-q').value,limit:100});
  const tbody=document.querySelector('#users-table');tbody.replaceChildren();
  data.forEach(u=>{
    const ban=document.createElement('button');ban.className='small danger';ban.textContent=u.banned?'UNBAN':'BAN';
    ban.onclick=async()=>{
      try{
        if(u.banned) await management('UNBAN_ACCOUNT',{account_id:u.id});
        else{const reason=window.prompt('Motivo del baneo:','Incumplimiento de las reglas del marketplace');if(reason===null)return;await management('BAN_ACCOUNT',{account_id:u.id,reason});}
        await loadUsers();await refreshDashboard();
      }catch(e){alert(String(e.message||e))}
    };
    const freeze=document.createElement('button');freeze.className='small secondary';freeze.textContent=u.status==='frozen'?'ACTIVAR':'CONGELAR';
    freeze.onclick=async()=>{try{await management('SET_ACCOUNT_STATUS',{account_id:u.id,status:u.status==='frozen'?'active':'frozen'});await loadUsers();}catch(e){alert(String(e.message||e))}};
    tbody.append(rowCells(u,[r=>r.username,r=>r.status,r=>r.banned?'SÍ':'NO',r=>date(r.created_at)],[ban,freeze]));
  });
}
async function loadStores(){
  const data=await management('LIST_STORES',{q:document.querySelector('#stores-q').value,limit:100});
  const tbody=document.querySelector('#stores-table');tbody.replaceChildren();
  data.forEach(s=>{
    const assign=document.createElement('button');assign.className='small';assign.textContent='ASIGNAR';
    assign.onclick=async()=>{const username=prompt('Usuario propietario: ',s.owner_username||'');if(!username)return;try{await management('ASSIGN_STORE',{store_id:s.id,owner_username:username});await loadStores();await refreshDashboard()}catch(e){alert(e.message||e)}};
    const toggle=document.createElement('button');toggle.className='small secondary';toggle.textContent=s.status==='active'?'SUSPENDER':'ACTIVAR';
    toggle.onclick=async()=>{try{await management('UPDATE_STORE',{store_id:s.id,status:s.status==='active'?'suspended':'active'});await loadStores();}catch(e){alert(e.message||e)}};
    const unassign=document.createElement('button');unassign.className='small secondary';unassign.textContent='DESASIGNAR';unassign.disabled=!s.owner_account_id;
    unassign.onclick=async()=>{if(!confirm('Desasignar el propietario de esta tienda?'))return;try{await management('UNASSIGN_STORE',{store_id:s.id});await loadStores();await refreshDashboard()}catch(e){alert(e.message||e)}};
    tbody.append(rowCells(s,[r=>r.name+' / '+r.slug,r=>r.owner_username||'SIN ASIGNAR',r=>r.status,r=>date(r.updated_at)],[assign,unassign,toggle]));
  });
}
async function loadListings(){
  const data=await management('LIST_LISTINGS',{q:document.querySelector('#listings-q').value,status:document.querySelector('#listings-status').value||null,limit:100});
  const tbody=document.querySelector('#listings-table');tbody.replaceChildren();
  data.forEach(l=>{
    const target=l.status==='blocked'?'active':'blocked';
    const b=document.createElement('button');b.className='small '+(target==='blocked'?'danger':'secondary');b.textContent=target==='blocked'?'BLOQUEAR':'DESBLOQUEAR';
    b.onclick=async()=>{try{await management('UPDATE_LISTING_STATUS',{listing_id:l.id,status:target});await loadListings();await refreshDashboard()}catch(e){alert(e.message||e)}};
    const assign=document.createElement('button');assign.className='small secondary';assign.textContent='TIENDA';
    assign.onclick=async()=>{const storeId=prompt('ID de la tienda del vendedor:',l.store_id||'');if(!storeId)return;try{await management('ASSIGN_LISTING_STORE',{listing_id:l.id,store_id:storeId});await loadListings()}catch(e){alert(e.message||String(e))}};
    tbody.append(rowCells(l,[r=>r.title,r=>r.seller||'—',r=>r.store_name||'—',r=>r.category||'—',r=>moneyAtomic(r.price_atomic,r.price_asset),r=>r.status],[assign,b]));
  });
}
const nextOrderStates={pending:['cancelled'],awaiting_payment:['cancelled'],paid:['processing','cancelled'],processing:['shipped','cancelled','disputed'],shipped:['completed','disputed'],disputed:['processing','shipped','completed','cancelled'],completed:[],cancelled:[]};
async function loadOrders(){
  const data=await management('LIST_ORDERS',{limit:100});
  const tbody=document.querySelector('#orders-table');tbody.replaceChildren();
  data.forEach(o=>{
    const select=document.createElement('select');(nextOrderStates[o.status]||[]).forEach(v=>{const opt=document.createElement('option');opt.value=v;opt.textContent=v;select.append(opt)});
    const b=document.createElement('button');b.className='small';b.textContent='GUARDAR';b.disabled=select.options.length===0;
    b.onclick=async()=>{try{await management('UPDATE_ORDER_STATUS',{order_id:o.id,status:select.value});await loadOrders();await refreshDashboard()}catch(e){alert(e.message||e)}};
    tbody.append(rowCells(o,[r=>shortId(r.id),r=>r.buyer_username,r=>moneyAtomic(r.total_atomic,r.total_asset),r=>r.item_count,r=>r.status],[select,b]));
  });
}
async function loadReports(){
  const data=await management('LIST_REPORTS',{limit:100});
  const tbody=document.querySelector('#reports-table');tbody.replaceChildren();
  data.forEach(r=>{
    const select=document.createElement('select');['open','reviewing','resolved','dismissed'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;o.selected=v===r.status;select.append(o)});
    const note=document.createElement('input');note.value=r.admin_note||'';note.maxLength=4000;note.placeholder='Nota interna';
    const b=document.createElement('button');b.className='small';b.textContent='GUARDAR';
    b.onclick=async()=>{try{await management('UPDATE_REPORT',{report_id:r.id,status:select.value,admin_note:note.value});await loadReports();await refreshDashboard()}catch(e){alert(e.message||e)}};
    const block=document.createElement('button');block.className='small danger';block.textContent='BLOQUEAR ANUNCIO';
    block.onclick=async()=>{if(!confirm('Bloquear el anuncio relacionado con este reporte?'))return;try{await management('UPDATE_LISTING_STATUS',{listing_id:r.listing_id,status:'blocked'});await refreshDashboard()}catch(e){alert(e.message||e)}};
    tbody.append(rowCells(r,[x=>shortId(x.id),x=>x.listing_title,x=>x.reason_code,x=>x.reporter_username||'anónimo',x=>x.status],[note,select,b,block]));
  });
}
async function loadPromos(){
  const data=await management('LIST_PROMOS',{limit:100});const tbody=document.querySelector('#promos-table');tbody.replaceChildren();
  data.forEach(p=>{
    const b=document.createElement('button');b.className='small danger';b.textContent='DESACTIVAR';b.disabled=!p.active;
    b.onclick=async()=>{try{await management('DISABLE_PROMO',{promotion_id:p.id});await loadPromos();await refreshDashboard()}catch(e){alert(e.message||e)}};
    const discount=p.discount_type==='percent'?((Number(p.discount_bps)/100).toFixed(2)+'%'):moneyAtomic(p.discount_atomic,p.discount_asset);
    tbody.append(rowCells(p,[x=>x.code_prefix+'…',x=>x.discount_type,x=>discount,x=>String(x.redeemed_count)+'/'+(x.max_redemptions??'∞'),x=>date(x.ends_at),x=>x.active?'ACTIVA':'INACTIVA'],[b]));
  });
}
async function loadDiscounts(){
  const data=await management('LIST_DISCOUNTS',{limit:100});const tbody=document.querySelector('#discounts-table');tbody.replaceChildren();
  data.forEach(d=>{
    const b=document.createElement('button');b.className='small danger';b.textContent='DESACTIVAR';b.disabled=!d.active;
    b.onclick=async()=>{try{await management('DISABLE_DISCOUNT',{discount_id:d.id});await loadDiscounts();await refreshDashboard()}catch(e){alert(e.message||e)}};
    const discount=d.discount_type==='percent'?((Number(d.discount_bps)/100).toFixed(2)+'%'):moneyAtomic(d.discount_atomic,d.discount_asset);
    tbody.append(rowCells(d,[x=>x.target_type+(x.target_id?' / '+shortId(x.target_id):''),x=>x.discount_type,x=>discount,x=>date(x.ends_at),x=>x.active?'ACTIVO':'INACTIVO'],[b]));
  });
}
async function loadCategories(){
  const data=await management('LIST_CATEGORIES');const tbody=document.querySelector('#categories-table');tbody.replaceChildren();
  data.forEach(c=>{
    const b=document.createElement('button');b.className='small secondary';b.textContent=c.active?'DESACTIVAR':'ACTIVAR';
    b.onclick=async()=>{try{await management('UPDATE_CATEGORY',{category_id:c.id,active:!c.active});await loadCategories()}catch(e){alert(e.message||e)}};
    tbody.append(rowCells(c,[x=>x.name,x=>x.slug,x=>x.active?'SÍ':'NO'],[b]));
  });
}
async function loadWebsite(){
  const settings=await management('SITE_GET');const form=document.querySelector('#site-settings');
  Object.keys(settings).forEach(k=>{const el=form.elements[k];if(el)el.value=settings[k]});
  const [featured,listings]=await Promise.all([
    management('LIST_FEATURED'),
    management('LIST_LISTINGS',{status:'active',limit:100})
  ]);
  const selected=new Set(featured.map(x=>x.listing_id));
  const picker=document.querySelector('#featured-picker');picker.replaceChildren();
  listings.forEach(x=>{
    const option=new Option(x.title+' — '+(x.seller||'—'),x.id);
    option.selected=selected.has(x.id);
    picker.append(option);
  });
  document.querySelector('#featured-list').textContent=featured.map(x=>x.position+'. '+x.title).join(' | ') || 'Sin destacados.';
}
async function loadAudit(){
  const data=await management('LIST_AUDIT',{limit:100});const tbody=document.querySelector('#audit-table');tbody.replaceChildren();
  data.forEach(a=>tbody.append(rowCells(a,[x=>date(x.created_at),x=>x.actor,x=>x.action,x=>x.resource_type+(x.resource_id?' / '+shortId(x.resource_id):''),x=>JSON.stringify(x.metadata||{})],[])));
}
async function loadFeatured(){
  const ids=document.querySelector('#featured-ids').value.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
  if(!ids.length){document.querySelector('#featured-list').textContent='';return}
}
async function loadModule(name){
  switch(name){
    case 'dashboard':return refreshDashboard();
    case 'users':return loadUsers();
    case 'stores':return loadStores();
    case 'listings':return loadListings();
    case 'orders':return loadOrders();
    case 'reports':return loadReports();
    case 'promos':await loadPromos();return loadDiscounts();
    case 'discounts':return loadDiscounts();
    case 'categories':return loadCategories();
    case 'website':return loadWebsite();
    case 'audit':return loadAudit();
    case 'system':return refreshDashboard();
  }
}
async function logout(){
  authenticated=false;if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null}
  await invoke?.('clear_token').catch(()=>{});
  shell.classList.add('hidden');login.classList.remove('hidden');tokenInput.value='';activity()
}
async function afterLogin(){
  authenticated=true;tokenInput.value='';login.classList.add('hidden');shell.classList.remove('hidden');showView('dashboard');
  await refreshDashboard();refreshTimer=setInterval(refreshDashboard,15000);
}
loginForm.addEventListener('submit',async e=>{
  e.preventDefault();loginError.hidden=true;
  try{await invoke('set_token',{token:tokenInput.value});await api('/v1/overview');await afterLogin()}
  catch(err){await invoke('clear_token').catch(()=>{});loginError.textContent=String(err.message||err);loginError.hidden=false}
});
nav.addEventListener('click',async e=>{
  const b=e.target.closest('[data-view]');if(!b)return;const name=b.dataset.view;showView(name);
  try{await loadModule(name)}catch(err){systemOutput.textContent=String(err.message||err)}
});
document.querySelectorAll('[data-view-jump]').forEach(b=>b.addEventListener('click',()=>{showView(b.dataset.viewJump);loadModule(b.dataset.viewJump)}));
document.querySelector('#refresh-all').addEventListener('click',()=>loadModule(document.querySelector('.nav-item.active')?.dataset.view||'dashboard'));
document.querySelector('#logout').addEventListener('click',logout);
document.querySelector('#dashboard-health').addEventListener('click',async()=>{try{const r=await control('HEALTH_CHECK');systemOutput.textContent=JSON.stringify(r,null,2);await refreshDashboard()}catch(e){systemOutput.textContent=e.message||String(e)}});
document.querySelectorAll('[data-control]').forEach(b=>b.addEventListener('click',async()=>{
  if(busy)return;busy=true;document.querySelectorAll('[data-control]').forEach(x=>x.disabled=true);
  try{const r=await control(b.dataset.control,b.dataset.service);output.textContent=JSON.stringify(r,null,2);await refreshDashboard()}catch(e){output.textContent=e.message||String(e)}
  finally{busy=false;document.querySelectorAll('[data-control]').forEach(x=>x.disabled=false)}
}));
document.querySelector('#users-search').addEventListener('click',()=>loadUsers());
document.querySelector('#stores-search').addEventListener('click',()=>loadStores());
document.querySelector('#listings-search').addEventListener('click',()=>loadListings());
document.querySelector('#logs-load').addEventListener('click',async()=>{
  try{
    const r=await api('/v1/system',{action:'LOGS',payload:{
      service:document.querySelector('#logs-service').value,
      lines:Number(document.querySelector('#logs-lines').value)
    }});
    document.querySelector('#logs-output').textContent=r.result.stdout || r.result.stderr || 'Sin salida.';
  }catch(e){document.querySelector('#logs-output').textContent=e.message||String(e)}
});
document.querySelector('#metrics-load').addEventListener('click',async()=>{
  try{
    const r=await api('/v1/system',{action:'METRICS',payload:{}});
    document.querySelector('#metrics-output').textContent=r.result.stdout || r.result.stderr || 'Sin datos.';
  }catch(e){document.querySelector('#metrics-output').textContent=e.message||String(e)}
});
document.querySelector('#migrate-db').addEventListener('click',async()=>{
  try{
    const r=await api('/v1/system',{action:'MIGRATE_DB',payload:{}});
    document.querySelector('#backup-output').textContent=r.result.stdout || r.result.stderr || 'Migración completada.';
  }catch(e){document.querySelector('#backup-output').textContent=e.message||String(e)}
});
async function reloadBackups(){
  try{
    const r=await api('/v1/system',{action:'LIST_BACKUPS',payload:{}});
    const select=document.querySelector('#backup-select');select.replaceChildren(new Option('Selecciona backup…',''));
    (r.result||[]).forEach(b=>{
      const o=new Option(b.id+' · '+Math.round(b.size_bytes/1024/1024)+' MB',b.id);select.append(o);
    });
    document.querySelector('#backup-output').textContent=(r.result||[]).length+' backup(s) disponibles.';
  }catch(e){document.querySelector('#backup-output').textContent=e.message||String(e)}
}
document.querySelector('#backup-db').addEventListener('click',async()=>{
  try{
    const r=await api('/v1/system',{action:'BACKUP_DB',payload:{}});
    document.querySelector('#backup-output').textContent='Backup creado: '+r.result.id+' ('+r.result.size_bytes+' bytes)';
    await reloadBackups();
  }catch(e){document.querySelector('#backup-output').textContent=e.message||String(e)}
});
document.querySelector('#list-backups').addEventListener('click',reloadBackups);
document.querySelector('#verify-backup').addEventListener('click',async()=>{
  const id=document.querySelector('#backup-select').value;if(!id)return;
  try{
    const r=await api('/v1/system',{action:'VERIFY_BACKUP',payload:{backup_id:id}});
    document.querySelector('#backup-output').textContent=JSON.stringify(r.result,null,2);
  }catch(e){document.querySelector('#backup-output').textContent=e.message||String(e)}
});
document.querySelector('#restore-backup').addEventListener('click',async()=>{
  const id=document.querySelector('#backup-select').value;if(!id)return;
  const first=confirm('RESTORE reemplaza el contenido actual de la base de datos. ¿Continuar?');
  if(!first)return;
  const second=prompt('Escribe RESTORE_MERCORA para confirmar:','');
  if(second!=='RESTORE_MERCORA')return;
  try{
    const r=await api('/v1/system',{action:'RESTORE_BACKUP',payload:{backup_id:id,confirm:second}});
    document.querySelector('#backup-output').textContent=JSON.stringify(r.result,null,2);
    await refreshDashboard();
  }catch(e){document.querySelector('#backup-output').textContent=e.message||String(e)}
});


document.querySelector('#store-create').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;
  try{await management('CREATE_STORE',{name:f.elements.name.value,slug:f.elements.slug.value,owner_username:f.elements.owner_username.value,status:f.elements.status.value});f.reset();await loadStores();await refreshDashboard()}catch(err){alert(err.message||String(err))}
});
document.querySelector('#store-assign').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;
  try{await management('ASSIGN_STORE',{store_id:f.elements.store_id.value,owner_username:f.elements.owner_username.value});f.reset();await loadStores();await refreshDashboard()}catch(err){alert(err.message||String(err))}
});
document.querySelector('#category-create').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;
  try{await management('CREATE_CATEGORY',{name:f.elements.name.value,slug:f.elements.slug.value});f.reset();await loadCategories()}catch(err){alert(err.message||String(err))}
});
document.querySelector('#promo-create').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;
  try{
    const p=await management('CREATE_PROMO',{
      code:f.elements.code.value||null,discount_type:f.elements.discount_type.value,
      discount_bps:f.elements.discount_bps.value?Number(f.elements.discount_bps.value):null,
      discount_atomic:f.elements.discount_atomic.value||null,discount_asset:f.elements.discount_asset.value||null,
      max_redemptions:f.elements.max_redemptions.value?Number(f.elements.max_redemptions.value):null,
      min_order_atomic:f.elements.min_order_atomic.value||'0'
    });
    f.reset();document.querySelector('#promo-once').textContent='CÓDIGO NUEVO (se muestra una sola vez): '+p.code;document.querySelector('#promo-once').classList.remove('hidden');
    await loadPromos();await refreshDashboard();
  }catch(err){alert(err.message||String(err))}
});
document.querySelector('#discount-create').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;
  try{
    await management('CREATE_DISCOUNT',{
      target_type:f.elements.target_type.value,target_id:f.elements.target_id.value||null,
      discount_type:f.elements.discount_type.value,discount_bps:f.elements.discount_bps.value?Number(f.elements.discount_bps.value):null,
      discount_atomic:f.elements.discount_atomic.value||null,discount_asset:f.elements.discount_asset.value||null
    });
    f.reset();await loadDiscounts();await refreshDashboard();
  }catch(err){alert(err.message||String(err))}
});
document.querySelector('#site-settings').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;
  try{for(const key of ['site_name','site_mode','announcement','maintenance_message','new_listings_enabled','seller_registration_enabled','footer_notice'])await management('SITE_SET',{key,value:f.elements[key].value});alert('Configuración guardada.');}catch(err){alert(err.message||String(err))}
});
document.querySelector('#featured-save').addEventListener('click',async()=>{
  const picker=document.querySelector('#featured-picker');
  const ids=Array.from(picker.selectedOptions).slice(0,48).map(o=>o.value);
  if(picker.selectedOptions.length>48){alert('Solo se pueden seleccionar 48 anuncios.');return}
  try{const r=await management('SET_FEATURED',{listing_ids:ids});document.querySelector('#featured-list').textContent='Destacados guardados: '+r.length;await loadWebsite();await refreshDashboard()}catch(err){alert(err.message||String(err))}
});
['pointerdown','keydown'].forEach(n=>document.addEventListener(n,()=>{if(authenticated)activity()},{passive:true}));
if(!invoke){loginError.textContent='La consola debe ejecutarse dentro de Tauri.';loginError.hidden=false}
