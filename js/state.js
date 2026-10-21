const CONFIG={WHATSAPP:"258845713020",PRICE:"199 MT",CV_MAX:20000,VAC_MAX:12000,MIN_CHARS:50,FILE_MAX:5e6,PDF_MAX_PAGES:15,API_TIMEOUT_MS:65000}; // limites alinhados com services/validate.js // <- número de WhatsApp do negócio (só aqui)
const track=(e,p={})=>{try{window.dispatchEvent(new CustomEvent('copilot:event',{detail:{e,...p}}))}catch{}}; // pronto para analytics, sem tracking invasivo
const S={step:0,cv:"",vac:"",res:null,kit:null,iv:null,code:"",premium:false,resPremium:false,demo:false,err:"",busy:false,verifying:false};
const $=s=>document.querySelector(s),esc=t=>String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const wa=()=>`https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent("Olá! Quero desbloquear o Premium do ApplyPro. Preço: "+CONFIG.PRICE+".")}`;
