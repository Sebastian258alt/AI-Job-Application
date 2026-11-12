class ApiError extends Error{constructor(m,status,code){super(m);this.status=status;this.code=code}}
// Todas as decisões Premium são do servidor. Aqui só se envia o pedido e se mostra o resultado.
async function api(task,code){const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),CONFIG.API_TIMEOUT_MS);let r;
try{r=await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},signal:ctl.signal,body:JSON.stringify(task=="verify"?{task,code}:{task,cv:S.cv,vacancy:S.vac,code:code??S.code,lang:LANG})})}
catch(e){throw new ApiError(e&&e.name=="AbortError"?t("e.timeout"):t("e.offline"),0)}finally{clearTimeout(tm)}
const j=await r.json().catch(()=>({}));
if(!r.ok){if(r.status==402)throw new ApiError(t("e.badcode"),402,j.code);throw new ApiError(srvMsg(j),r.status,j.code)}
return j}
// Em PT mostra-se a mensagem do servidor (como antes); em EN traduz-se pelo código estável do erro.
const srvMsg=j=>LANG=="en"?(I18N.en["srv."+j.code]||t("e.generic")):(typeof j.error=="string"&&j.error?j.error:t("e.generic"));
const revoke=e=>{if(e&&e.status==402){S.premium=false;S.code=""}};
async function runAnalysis(){if(S.busy)return;S.busy=true;S.err="";go(3);track("analysis_started");try{const j=await api("analyze");S.res=j.data;S.resPremium=!!j.premium;track("analysis_completed")}catch(e){S.err=e.message;revoke(e)}S.busy=false;render()}
async function gen(task,key,step){if(S.busy)return;S.busy=true;S.err="";render();try{S[key]=(await api(task)).data}catch(e){S.err=e.message;revoke(e)}S.busy=false;S.step=step;render()}
// CV adaptado (Premium, validado e verificado no servidor). Mantém o kit visível enquanto gera; o erro fica junto ao botão.
async function genCv(){if(S.busy)return;S.busy=true;S.busyCv=true;S.cvErr="";S.cvOk=false;render();try{S.cvdoc=(await api("cv")).data;track("cv_generated")}catch(e){S.cvErr=e.message;revoke(e)}S.busy=false;S.busyCv=false;S.step=4;render()}
// Desbloqueio: o servidor valida o código; a interface só fica "Premium" se o servidor responder OK.
async function unlock(){if(S.verifying)return;const c=($("#code")?.value||"").trim();
if(!c){S.err=t("e.nocode");return render()}
S.verifying=true;S.err="";render();
try{await api("verify",c);S.code=c;S.premium=true;track("premium_unlocked");
if(S.res&&!S.demo&&!S.resPremium){try{const j=await api("analyze");S.res=j.data;S.resPremium=!!j.premium}catch{}}} // o servidor só envia a análise completa a quem tem código válido
catch(e){S.premium=false;S.code="";S.err=e.message}
S.verifying=false;render()}
