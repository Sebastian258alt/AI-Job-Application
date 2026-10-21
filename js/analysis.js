class ApiError extends Error{constructor(m,status,code){super(m);this.status=status;this.code=code}}
// Todas as decisões Premium são do servidor. Aqui só se envia o pedido e se mostra o resultado.
async function api(task,code){const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),CONFIG.API_TIMEOUT_MS);let r;
try{r=await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},signal:ctl.signal,body:JSON.stringify(task=="verify"?{task,code}:{task,cv:S.cv,vacancy:S.vac,code:code??S.code})})}
catch(e){throw new ApiError(e&&e.name=="AbortError"?"A análise demorou demasiado. Tenta novamente.":"Sem ligação à internet. Verifica a rede e tenta novamente.",0)}finally{clearTimeout(tm)}
const j=await r.json().catch(()=>({}));
if(!r.ok){if(r.status==402)throw new ApiError("Código Premium inválido.",402,j.code);throw new ApiError(typeof j.error=="string"&&j.error?j.error:"Não foi possível concluir a análise agora. Tenta novamente dentro de alguns instantes.",r.status,j.code)}
return j}
const revoke=e=>{if(e&&e.status==402){S.premium=false;S.code=""}};
async function runAnalysis(){if(S.busy)return;S.busy=true;S.err="";S.step=3;render();track("analysis_started");try{const j=await api("analyze");S.res=j.data;S.resPremium=!!j.premium;track("analysis_completed")}catch(e){S.err=e.message;revoke(e)}S.busy=false;render()}
async function gen(task,key,step){if(S.busy)return;S.busy=true;S.err="";render();try{S[key]=(await api(task)).data}catch(e){S.err=e.message;revoke(e)}S.busy=false;S.step=step;render()}
// Desbloqueio: o servidor valida o código; a interface só fica "Premium" se o servidor responder OK.
async function unlock(){if(S.verifying)return;const c=($("#code")?.value||"").trim();
if(!c){S.err="Introduz o teu código Premium.";return render()}
S.verifying=true;S.err="";render();
try{await api("verify",c);S.code=c;S.premium=true;track("premium_unlocked");
if(S.res&&!S.demo&&!S.resPremium){try{const j=await api("analyze");S.res=j.data;S.resPremium=!!j.premium}catch{}}} // o servidor só envia a análise completa a quem tem código válido
catch(e){S.premium=false;S.code="";S.err=e.message}
S.verifying=false;render()}
