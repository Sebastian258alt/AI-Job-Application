const CONFIG={WHATSAPP:"258845713020",PRICE:"199 MT"}; // <- número de WhatsApp do negócio (só aqui)
const track=(e,p={})=>{try{window.dispatchEvent(new CustomEvent('copilot:event',{detail:{e,...p}}))}catch{}}; // pronto para analytics, sem tracking invasivo
const S={step:0,cv:"",vac:"",res:null,kit:null,iv:null,code:"",demo:false,err:"",busy:false};
const $=s=>document.querySelector(s),esc=t=>String(t??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const wa=()=>`https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent("Olá! Quero desbloquear o Premium do AI Job Application Copilot. Preço: "+CONFIG.PRICE+".")}`;
