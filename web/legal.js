const labels={
  terms_of_use:['CONDICIONES','Condiciones de uso'],
  privacy_notice:['PRIVACIDAD','Política de privacidad'],
  publication_rules:['NORMAS','Normas de publicación']
};
const key=new URLSearchParams(location.search).get('doc')||'terms_of_use';
const title=document.querySelector('#legalTitle');
const eyebrow=document.querySelector('#legalEyebrow');
const content=document.querySelector('#legalContent');

async function load(){
  const response=await fetch('./api/site-config',{cache:'no-store',headers:{Accept:'application/json'}});
  const config=await response.json().catch(()=>({}));
  const label=labels[key];
  if(!label){
    title.textContent='Información no disponible';
    content.textContent='El documento solicitado no existe.';
    return;
  }
  eyebrow.textContent=label[0];
  title.textContent=label[1];
  content.textContent=config[key]||'Este documento todavía no tiene contenido publicado.';
}
load().catch(()=>{content.textContent='No se ha podido cargar el documento en este momento.';});
