(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  const nav = document.querySelector('#nav');
  const shell = document.querySelector('#app-shell');
  if (!invoke || !nav || !shell) return;

  const panel = document.createElement('section');
  panel.id = 'view-reputation';
  panel.className = 'view hidden';
  panel.innerHTML = `
    <section class="card">
      <div class="section-head">
        <div>
          <div class="eyebrow">VENDEDORES</div>
          <h3>Reputación y ventas verificadas</h3>
          <p class="muted">Las ventas proceden de pedidos completados. Las valoraciones solo pueden nacer de una compra verificada.</p>
        </div>
        <div class="buttons">
          <button id="reputation-refresh" class="secondary">ACTUALIZAR</button>
          <button id="reputation-recalculate" class="secondary">RECALCULAR</button>
        </div>
      </div>
      <div id="reputation-metrics" class="metric-grid"></div>
      <div class="toolbar">
        <input id="reputation-seller-q" placeholder="Buscar vendedor…" maxlength="80">
        <button id="reputation-seller-search">BUSCAR</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Vendedor</th><th>Ventas verificadas</th><th>Unidades</th><th>Reputación</th><th>Valoraciones</th></tr></thead>
          <tbody id="reputation-sellers-table"></tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <div>
          <div class="eyebrow">COMENTARIOS</div>
          <h3>Valoraciones de compradores</h3>
          <p class="muted">Cada fila lleva el estado de moderación y el vínculo interno con el pedido verificado.</p>
        </div>
        <div class="buttons">
          <select id="reputation-review-status">
            <option value="">Todos</option><option value="published">publicados</option>
            <option value="under_review">en revisión</option><option value="hidden">ocultos</option>
          </select>
          <button id="reputation-review-refresh" class="secondary">ACTUALIZAR</button>
        </div>
      </div>
      <div class="toolbar">
        <input id="reputation-review-q" placeholder="Buscar vendedor o comentario…" maxlength="80">
        <button id="reputation-review-search">BUSCAR</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Vendedor</th><th>Pedido</th><th>Nota</th><th>Comentario</th><th>Estado</th><th>Gestión</th></tr></thead>
          <tbody id="reputation-reviews-table"></tbody>
        </table>
      </div>
    </section>
    <pre id="reputation-output" class="console-output">Listo.</pre>
  `;
  shell.querySelector('main')?.append(panel);

  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.view = 'reputation';
  button.textContent = 'Reputación';
  const auditButton = nav.querySelector('[data-view="audit"]');
  nav.insertBefore(button, auditButton || null);

  const esc = value => String(value ?? '—');
  const date = value => { try { return value ? new Date(value).toLocaleString() : '—'; } catch { return esc(value); } };
  const shortId = value => { const s=esc(value); return s.length>14 ? s.slice(0,8)+'…'+s.slice(-4) : s; };
  const invokeApi = async (path, payload) => {
    const raw = await invoke('admin_request', { method: 'POST', path, body: JSON.stringify(payload || {}) });
    return JSON.parse(raw);
  };
  const reputation = async (action, payload={}) => {
    const result = await invokeApi('/v1/reputation', { action, payload });
    return result.result;
  };
  const metric = (label, value) => {
    const card=document.createElement('article'); card.className='metric cardish';
    const span=document.createElement('span'); span.textContent=label;
    const strong=document.createElement('strong'); strong.textContent=esc(value);
    card.append(span,strong); return card;
  };
  const rating = row => row.rating_average == null ? 'Sin valoraciones' : '★ '+Number(row.rating_average).toFixed(2)+' / 5';
  const renderOverview = data => {
    const wrap=document.querySelector('#reputation-metrics'); wrap.replaceChildren();
    [['Vendedores',data?.sellers],['Ventas verificadas',data?.verified_sales],['Valoraciones publicadas',data?.published_reviews],['En revisión',data?.under_review],['Ocultas',data?.hidden_reviews]]
      .forEach(([label,value])=>wrap.append(metric(label,value ?? 0)));
  };

  async function loadSellers(){
    const rows=await reputation('LIST_SELLER_REPUTATION',{
      q:document.querySelector('#reputation-seller-q').value,limit:100
    });
    const tbody=document.querySelector('#reputation-sellers-table'); tbody.replaceChildren();
    (rows||[]).forEach(row=>{
      const name=document.createElement('button');
      name.className='small secondary';
      name.textContent=row.display_name;
      name.title='Filtrar comentarios de este vendedor';
      name.onclick=async()=>{
        document.querySelector('#reputation-review-q').value=row.display_name;
        document.querySelector('#reputation-review-status').value='';
        await loadReviews();
      };
      const tr=document.createElement('tr');
      [name,esc(row.verified_sales_count),esc(row.verified_units_sold),rating(row),esc(row.verified_rating_count)]
        .forEach((cell,i)=>{const td=document.createElement('td'); if(cell instanceof Node) td.append(cell); else td.textContent=cell; tr.append(td);});
      tbody.append(tr);
    });
  }

  async function loadReviews(){
    const status=document.querySelector('#reputation-review-status').value;
    const rows=await reputation('LIST_SELLER_REVIEWS',{
      q:document.querySelector('#reputation-review-q').value,
      status:status||null,limit:100
    });
    const tbody=document.querySelector('#reputation-reviews-table'); tbody.replaceChildren();
    (rows||[]).forEach(row=>{
      const state=document.createElement('select');
      ['published','under_review','hidden'].forEach(v=>{
        const option=new Option(v,v); option.selected=v===row.status; state.append(option);
      });
      const reason=document.createElement('input');
      reason.placeholder='Motivo si se oculta/revisa'; reason.maxLength=2000;
      const save=document.createElement('button'); save.className='small';
      save.textContent='GUARDAR';
      save.onclick=async()=>{
        try{
          await reputation('MODERATE_SELLER_REVIEW',{review_id:row.id,status:state.value,reason:reason.value||null});
          await loadReviews();
          await loadOverview();
        }catch(error){document.querySelector('#reputation-output').textContent=error.message||String(error);}
      };
      const actions=document.createElement('div'); actions.className='buttons'; actions.append(state,reason,save);
      const tr=document.createElement('tr');
      [
        date(row.created_at),row.seller,shortId(row.order_id),
        '★ '.repeat(Number(row.score)).trim(),
        row.comment||'—', row.status, actions
      ].forEach((cell,i)=>{const td=document.createElement('td'); if(cell instanceof Node) td.append(cell); else td.textContent=cell; tr.append(td);});
      tbody.append(tr);
    });
  }

  async function loadOverview(){
    const data=await reputation('OVERVIEW',{});
    renderOverview(data);
  }

  async function loadAll(){
    try{await Promise.all([loadOverview(),loadSellers(),loadReviews()]);}
    catch(error){document.querySelector('#reputation-output').textContent=error.message||String(error);}
  }

  button.addEventListener('click',()=>setTimeout(loadAll,0));
  document.querySelector('#reputation-refresh').addEventListener('click',loadAll);
  document.querySelector('#reputation-seller-search').addEventListener('click',loadSellers);
  document.querySelector('#reputation-review-search').addEventListener('click',loadReviews);
  document.querySelector('#reputation-review-refresh').addEventListener('click',loadReviews);
  document.querySelector('#reputation-recalculate').addEventListener('click',async()=>{
    if(!confirm('Recalcular los contadores denormalizados de reputación?')) return;
    try{
      const result=await reputation('RECALCULATE_SELLER_REPUTATION',{});
      document.querySelector('#reputation-output').textContent='Recalculación completada.';
      renderOverview(result);
      await loadSellers();
    }catch(error){document.querySelector('#reputation-output').textContent=error.message||String(error);}
  });
})();
