// Arranque e eventos. Sem atributos on* no HTML (a CSP não permite scripts inline): um único ouvinte por tipo de evento.
const ACT={home:()=>go(0),start:()=>{track("start_application");go(1)},demo:()=>loadDemo(),next1:()=>next1(),next2:()=>next2(),retry:()=>runAnalysis(),
kit:()=>go(4),iv:()=>go(5),unlock:()=>unlock(),genkit:()=>gen("kit","kit",4),regenkit:()=>{S.kit=null;gen("kit","kit",4)},geniv:()=>gen("interview","iv",5),
copy:(el)=>cp(el.dataset.id,{target:el}),scanrot:(el)=>scanRot(+el.dataset.i),scandel:(el)=>scanDel(+el.dataset.i),scanrun:()=>scanRun(),goto:(el)=>go(+el.dataset.step),gencv:()=>genCv(),dl:(el)=>exportKit(el.dataset.id,el.dataset.fmt,el),cvdl:(el)=>exportCv(el.dataset.fmt,el),
about:()=>{go(0);setTimeout(()=>{const e=$("#sobre");if(e&&e.scrollIntoView)e.scrollIntoView()},0)},lang:(el)=>setLang(el.dataset.lang),wa:()=>{track("premium_clicked");track("whatsapp_clicked")}};
document.addEventListener("click",e=>{const el=e.target.closest&&e.target.closest("[data-act]");if(el&&ACT[el.dataset.act])ACT[el.dataset.act](el,e)});
document.addEventListener("input",e=>{const d=e.target.dataset||{};if(d.in=="cv"){S.cv=e.target.value;cnt("cv","c1")}else if(d.in=="vac"){S.vac=e.target.value;cnt("vac","c2")}else if(d.cv!==undefined)cvSet(d.cv,e.target.value)});
document.addEventListener("change",e=>{const d=e.target.dataset||{};if("file" in d)onFile(e.target.files&&e.target.files[0]);else if("scan" in d){const fl=[...(e.target.files||[])];e.target.value="";scanAdd(fl)}else if("scanlang" in d)S.scan.lang=e.target.value;else if("cvok" in d){S.cvOk=e.target.checked;document.querySelectorAll("[data-needok]").forEach(b=>{b.disabled=!S.cvOk})}else if(d.cv!==undefined)cvSet(d.cv,e.target.value)});
// Botão "voltar" do navegador/telemóvel: recua um passo em vez de sair da aplicação.
// Navegação só por âncora (#como, #sobre) na landing não tem estado nem deve repintar a página; voltar de outro passo para uma entrada assim volta à landing.
window.addEventListener("popstate",e=>{if(!e.state&&S.step===0)return;go((e.state&&e.state.s)||0,true)});
document.addEventListener("keydown",e=>{if(e.key=="Enter"&&e.target.id=="code")unlock()});
LANG=pickLang();applyStatic();track("landing_view");if(history.replaceState)history.replaceState({s:0},"");render();
