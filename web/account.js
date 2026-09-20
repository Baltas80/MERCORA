const PREVIEW=location.hostname.endsWith(".github.io")||new URLSearchParams(location.search).has("preview");
async function api(path,options={}){const r=await fetch("/api"+path,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.detail||"request_failed");return d}
function csrf(){const m=document.cookie.match(/(?:^|; )mercora_csrf=([^;]+)/);return m?decodeURIComponent(m[1]):""}
const msg=document.querySelector("#message"),login=document.querySelector("#loginForm"),register=document.querySelector("#registerForm"),recovery=document.querySelector("#recoveryForm");
function previewMessage(text){if(msg)msg.textContent="PREVIEW — "+text}
login?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(PREVIEW){previewMessage("inicio de sesión simulado. No se crea ninguna cuenta.");return;}
  try{const d=await api("/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(login)))});msg.textContent="Sesión activa como "+d.pseudonym;setTimeout(()=>location.href=new URLSearchParams(location.search).get("next")||"./",300)}catch(err){msg.textContent=err.message}
});
register?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(PREVIEW){previewMessage("registro simulado. No se almacenan contraseñas ni códigos de recuperación.");return;}
  try{const d=await api("/auth/register",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(register)))});msg.textContent="Códigos de recuperación: "+d.recovery_codes.join(" · ")}catch(err){msg.textContent=err.message}
});
document.querySelector("#logout")?.addEventListener("click",async()=>{
  if(PREVIEW){previewMessage("sesión de demo cerrada.");return;}
  try{await api("/auth/logout",{method:"POST",headers:{"X-CSRF-Token":csrf()}});msg.textContent="Sesión cerrada"}catch(err){msg.textContent=err.message}
});
recovery?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(PREVIEW){previewMessage("recuperación simulada. No se modifica ninguna cuenta real.");return;}
  try{await api("/auth/recovery/reset",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(recovery)))});msg.textContent="Contraseña restablecida"}catch(err){msg.textContent=err.message}
});