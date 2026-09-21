(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  const keys = [
    ['site_name','Nombre del sitio'],['announcement','Enunciado / aviso'],['maintenance_message','Mensaje de mantenimiento'],
    ['footer_notice','Aviso del pie'],['hero_title','Título de portada'],['hero_copy','Descripción de portada'],
    ['terms_of_use','Condiciones de uso'],['privacy_notice','Política de privacidad'],['publication_rules','Normas de publicación'],
    ['buy_cta','Botón comprar'],['sell_cta','Botón vender']
  ];
  let currentKey = 'announcement';
  const api = async (action,payload={}) => {
    if(!invoke) throw new Error('Tauri runtime unavailable');
    const raw = await invoke('admin_request',{method:'POST',path:'/v1/content',body:JSON.stringify({action,payload})});
    return JSON.parse(raw);
  };
  function el(tag,props={},children=[]){const n=document.createElement(tag);Object.assign(n,props);children.forEach(c=>n.append(c));return n;}
  function mount(){
    const view=document.querySelector('#view-website'); if(!view || document.querySelector('#content-editor')) return;
    const card=el('section',{className:'card',id:'content-editor'});
    const head=el('div',{className:'section-head'},[el('div',{},[el('div',{className:'eyebrow',textContent:'CONTROL EDITORIAL'}),el('h3',{textContent:'Textos públicos y versiones'})]),el('span',{className:'badge unknown',id:'content-status',textContent:'SIN CAMBIOS'})]);
    const grid=el('div',{className:'form-grid wide'});
    const select=el('select',{id:'content-key'});
    keys.forEach(([value,label])=>select.append(el('option',{value,textContent:label})));
    const textarea=el('textarea',{id:'content-value',rows:7,maxLength:6000,placeholder:'Texto que aparecerá en la web…'});
    const save=el('button',{id:'content-save',textContent:'GUARDAR NUEVA VERSIÓN'});
    const unpublish=el('button',{id:'content-unpublish',className:'danger',textContent:'DESPUBLICAR'});
    const refresh=el('button',{id:'content-refresh',className:'secondary',textContent:'ACTUALIZAR HISTORIAL'});
    const preview=el('pre',{id:'content-preview',className:'console-output',textContent:'Vista previa: —'});
    grid.append(el('label',{},[document.createTextNode('Contenido'),textarea]),el('div',{},[el('label',{},[document.createTextNode('Campo'),select]),el('div',{className:'buttons'},[save,unpublish,refresh])]));
    const history=el('div',{className:'table-wrap'});const table=el('table');table.innerHTML='<thead><tr><th>Fecha</th><th>Actor</th><th>Estado</th><th>Contenido</th><th>Acción</th></tr></thead><tbody id="content-history"></tbody>';history.append(table);
    card.append(head,grid,preview,history);view.append(card);
    select.addEventListener('change',()=>{currentKey=select.value;loadCurrent();});
    textarea.addEventListener('input',()=>{preview.textContent='Vista previa: '+textarea.value;});
    save.addEventListener('click',async()=>{try{if(!textarea.value.trim()&&!['announcement','maintenance_message','footer_notice'].includes(currentKey))throw new Error('Este campo no puede quedar vacío.');await api('UPDATE',{site_key:currentKey,value:textarea.value});setStatus('GUARDADO');await loadCurrent();}catch(e){setStatus(String(e.message||e),'bad');}});
    unpublish.addEventListener('click',async()=>{if(!['announcement','maintenance_message','footer_notice'].includes(currentKey)){setStatus('Solo se pueden despublicar avisos opcionales.','bad');return;}if(!confirm('¿Despublicar este texto inmediatamente?'))return;try{await api('UNPUBLISH',{site_key:currentKey});setStatus('DESPUBLICADO');await loadCurrent();}catch(e){setStatus(String(e.message||e),'bad');}});
    refresh.addEventListener('click',loadHistory);
    loadCurrent();
  }
  function setStatus(message,state='ok'){const n=document.querySelector('#content-status');if(!n)return;n.textContent=message;n.className='badge '+state;}
  async function loadCurrent(){try{const r=await api('CURRENT');const value=r.result?.[currentKey]??'';const t=document.querySelector('#content-value');if(t){t.value=value;document.querySelector('#content-preview').textContent='Vista previa: '+value;}await loadHistory();}catch(e){setStatus(String(e.message||e),'bad');}}
  async function loadHistory(){try{const r=await api('LIST',{site_key:currentKey});const body=document.querySelector('#content-history');if(!body)return;body.replaceChildren();(r.result||[]).forEach(v=>{const tr=document.createElement('tr');const preview=String(v.value||'').replace(/\s+/g,' ').slice(0,160);const restore=el('button',{className:'small secondary',textContent:'RESTAURAR'});restore.onclick=async()=>{if(!confirm('¿Restaurar esta versión? Se creará una nueva versión activa.'))return;try{await api('RESTORE',{version_id:v.id});setStatus('VERSIÓN RESTAURADA');await loadCurrent();}catch(e){setStatus(String(e.message||e),'bad');}};[new Date(v.created_at).toLocaleString(),v.actor,v.published?'PUBLICADO':'NO PUBLICADO',preview].forEach(x=>tr.append(el('td',{textContent:String(x)})));tr.append(el('td',{},[restore]));body.append(tr);});}catch(e){setStatus(String(e.message||e),'bad');}}
  function observe(){mount();const view=document.querySelector('#view-website');if(view)new MutationObserver(mount).observe(view,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe);else observe();
})();
