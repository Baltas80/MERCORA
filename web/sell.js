import {applyTranslations,getLocale,setLocale} from "./i18n.js";
const form=document.querySelector("#sellerForm"),language=document.querySelector("#languageSelect"),message=document.querySelector("#formMessage"),fee=document.querySelector("#feeSummary");
function csrf(){const m=document.cookie.match(/(?:^|; )mercora_csrf=([^;]+)/);return m?decodeURIComponent(m[1]):""}
async function api(path,options={}){const r=await fetch("/api"+path,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.detail||"request_failed");return d}
function normalize(v){return String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)}
function render(){const l=getLocale();language.value=l;applyTranslations(l)}
form.addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));data.store_slug=normalize(data.store_slug);try{const d=await api("/stores",{method:"POST",headers:{"X-CSRF-Token":csrf()},body:JSON.stringify(data)});fee.textContent=d.status==="activated"?"Tienda activada":"Pago requerido: "+d.fee_atomic+" "+d.asset_code;message.textContent=d.status==="activated"?"Tienda activa":"Payment intent: "+(d.payment_intent_id||"pendiente")}catch(err){message.textContent=err.message}});
language.addEventListener("change",()=>{setLocale(language.value);render()});render();
