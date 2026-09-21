(() => {
  const stats = Object.freeze({
    northstar: {sales:'1.284',rating:'4,92',reviews:'247'},
    grainlab: {sales:'862',rating:'4,88',reviews:'153'},
    keystatic: {sales:'421',rating:'4,97',reviews:'98'},
    atelier7: {sales:'196',rating:'4,81',reviews:'44'},
    signalroom: {sales:'1.917',rating:'4,94',reviews:'318'},
    analogworks: {sales:'73',rating:'4,76',reviews:'21'},
    northline: {sales:'544',rating:'4,90',reviews:'117'},
    benchmarks: {sales:'305',rating:'4,86',reviews:'67'}
  });

  function decorate(){
    document.querySelectorAll('#productGrid .product').forEach(card=>{
      const meta=card.querySelector('.product-meta');
      const itemSeller=(meta?.textContent||'').split(' · ')[0].trim();
      const value=stats[itemSeller];
      if(!value || card.querySelector('.seller-reputation')) return;
      const meta=card.querySelector('.product-meta');
      if(!meta) return;
      const parts=(meta.textContent||'').split(' · ');
      const seller=parts.shift()?.trim();
      const details=parts.join(' · ');
      meta.replaceChildren();
      const sellerLine=document.createElement('div');
      sellerLine.className='seller-reputation';
      sellerLine.textContent=(seller||'Vendedor')+' · ✓ '+value.sales+' ventas verificadas · ★ '+value.rating+' · '+value.reviews+' valoraciones';
      meta.append(sellerLine);
      if(details){
        const detailsLine=document.createElement('div');
        detailsLine.textContent=details;
        meta.append(detailsLine);
      }
    });
  }

  decorate();
  const grid=document.querySelector('#productGrid');
  if(grid) new MutationObserver(decorate).observe(grid,{childList:true});
})();
