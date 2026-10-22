const IMG="/assets/img/",sfx=()=>LANG=="en"?"-en":"";
const heroImg=()=>`<img class="heroimg" src="${IMG}hero-showcase${sfx()}-1600.webp" srcset="${IMG}hero-showcase${sfx()}-800.webp 800w, ${IMG}hero-showcase${sfx()}-1600.webp 1600w" sizes="(min-width:920px) 884px, calc(100vw - 36px)" width="1600" height="720" fetchpriority="high" decoding="async" alt="${esc(t("hero.alt"))}">`;
const FEATS=[["feature-cv-analysis","f1",0],["feature-application-kit","f2",1],["feature-interview-prep","f3",1]];
const features=()=>`<section class="feat" aria-label="${esc(t("feat.aria"))}">${FEATS.map(([f,k,p])=>`<div class="card"><img src="${IMG}${f}${sfx()}-1200.webp" srcset="${IMG}${f}${sfx()}-600.webp 600w, ${IMG}${f}${sfx()}-1200.webp 1200w" sizes="(min-width:700px) 290px, calc(100vw - 38px)" width="1200" height="900" loading="lazy" decoding="async" alt="${esc(t(k+".alt"))}"><div class="b"><span class="tag ${p?"PARTIAL":"MATCH"}">${t(p?"badge.prem":"badge.free")}</span><h3>${t(k+".t")}</h3><p>${t(k+".d")}</p></div></div>`).join("")}</section>`;
let histStep=0;
function go(n,pop){S.step=n;S.err="";if(!pop&&n!==histStep&&typeof history!=="undefined"&&history.pushState)history.pushState({s:n},"");histStep=n;render();scrollTo({top:0})}
const navRow=(to,extra="")=>`<div class="row nav"><button class="btn alt" data-act="goto" data-step="${to}">${t("btn.back")}</button>${extra}</div>`;
function prog(){return `<div class="prog">${[1,2,3,4,5].map(i=>`<div class="${S.step==i?"on":S.step>i?"done":""}">${i} ${t("prog."+i)}</div>`).join("")}</div>`}
const errBox=()=>`<div role="alert" class="err ${S.err?"":"hide"}">${esc(S.err)}</div>`;
const cntTxt=(n,m)=>t("cnt",{n,m});
function render(){const a=$("#app");let h="";
if(S.step==0)h=`<section class="hero"><div class="eyebrow">${t("hero.eyebrow")}</div><h1>${t("hero.h1")}</h1><p>${t("hero.p")}</p><div class="row"><button class="btn t" data-act="start">${t("hero.cta")}</button><a class="btn alt" href="#como">${t("hero.how")}</a><button class="btn alt" data-act="demo">${t("hero.demo")}</button></div></section>
${heroImg()}
<section id="como" class="steps3">${[["01","how.1"],["02","how.2"],["03","how.3"]].map(([n,k])=>`<div class="card"><div class="n">${n}</div>${t(k)}</div>`).join("")}</section>
${features()}
<div class="mock"><div class="ring" data-p="78"><i>78</i></div><div><b>${t("mock.t")}</b> <span class="demo">${t("mock.tag")}</span><br><span class="note">${t("mock.n")}</span></div></div>
<div class="card"><h3>${t("fp.h")}</h3><p>${t("fp.p",{price:CONFIG.PRICE})}</p></div>
<section id="sobre" class="card about"><h3>${t("about.h")}</h3><p>${t("about.p1")}</p><p>${t("about.p2")}</p><a class="btn alt" href="https://snhamoneque.vercel.app" target="_blank" rel="noopener">${t("about.cta")}: snhamoneque.vercel.app</a></section>`;
else if(S.step==1)h=prog()+`<h2>${t("s1.h")}</h2><div class="card"><label class="drop" for="f">${t("s1.drop")}<br><span class="note">${t("s1.fmt")}</span><input id="f" type="file" accept=".pdf,.docx" class="vh" data-file></label><p>${t("s1.or")}</p><textarea id="cv" data-in="cv" aria-label="${esc(t("s1.h"))}">${esc(S.cv)}</textarea><div class="cnt" id="c1">${cntTxt(S.cv.length,CONFIG.CV_MAX)}</div></div>${errBox()}${navRow(0,`<button class="btn" data-act="next1">${t("btn.continue")}</button>`)}`;
else if(S.step==2)h=prog()+`<h2>${t("s2.h")}</h2><div class="card"><textarea id="vac" data-in="vac" aria-label="${esc(t("s2.h"))}" placeholder="${esc(t("s2.ph"))}">${esc(S.vac)}</textarea><div class="cnt" id="c2">${cntTxt(S.vac.length,CONFIG.VAC_MAX)}</div></div><p class="note">${t("s2.note")}</p>${errBox()}${navRow(1,`<button class="btn" data-act="next2">${t("btn.analyse")}</button>`)}`;
else if(S.step==3)h=prog()+(S.busy?`<div class="card" role="status" aria-live="polite"><h3>${t("s3.busy")}</h3><p class="note">${t("s3.wait")}</p><div class="sk"></div><div class="sk w70"></div><div class="sk w85"></div></div>`:S.err?`<div role="alert" class="err">${esc(S.err)}</div>${navRow(2,`<button class="btn" data-act="retry">${t("btn.retry")}</button>`)}`:analysis());
else if(S.step==4)h=prog()+kitView();else h=prog()+ivView();
a.innerHTML=h;
if(a.querySelectorAll)a.querySelectorAll("[data-p]").forEach(e=>e.style.setProperty("--p",e.dataset.p))} // CSSOM (permitido por CSP style-src 'self'; atributos style inline não)
function cnt(i,o){$("#"+o).textContent=cntTxt($("#"+i).value.length,i=="cv"?CONFIG.CV_MAX:CONFIG.VAC_MAX)}
function loadDemo(){const d=demo();Object.assign(S,{demo:true,cv:d.cv,vac:d.vac,res:d.res,kit:d.kit,iv:d.iv,cvdoc:JSON.parse(JSON.stringify(d.cvdoc)),cvOk:false,cvErr:""});go(3)}
const list=a=>(a||[]).length?`<ul>${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:`<p class="note">${t("list.empty")}</p>`;
function analysis(){const r=S.res;if(!r)return"";const sc=Math.max(0,Math.min(100,+r.score||0)),cats=["essential","preferred","responsibility","technical","soft","education","experience","language"],lab=["MATCH","PARTIAL","NOT_FOUND"];
return`${S.demo?`<span class="demo">${t("demo.tag")}</span>`:""}<div class="card score"><div class="ring" data-p="${sc}"><i>${sc}/100</i></div><div><h3>${t("a.score")}</h3><p class="note">${t("a.scorenote")}</p></div></div>
<div class="card"><h3>${t("a.strong")}</h3>${list(r.strengths)}<h3>${t("a.improve")}</h3>${list(r.partial_matches)}<h3>${t("a.gaps")}</h3>${list(r.missing_from_cv)}<p class="note">${t("a.notid")}</p></div>
<div class="card"><h3>${t("a.reqs")}</h3>${cats.map(k=>{const it=(Array.isArray(r.requirements)?r.requirements:[]).filter(x=>x&&x.category==k);return it.length?`<details><summary>${t("cat."+k)} (${it.length})</summary>${it.map(x=>{const st=lab.includes(x.status)?x.status:"NOT_FOUND";return`<div class="req"><span class="tag ${st}">${t("st."+st)}</span> ${esc(x.text)}<div class="note">${esc(x.evidence)}</div></div>`}).join("")}</details>`:""}).join("")}</div>
<div class="card"><h3>${t("a.recs")}</h3>${(Array.isArray(r.recommendations)?r.recommendations:[]).slice(0,S.premium||S.demo?99:1).map(x=>`<p><b>${t("a.cur")}</b> “${esc(x.current)}”<br><b>${t("a.dir")}</b> ${esc(x.direction)}</p>`).join("")}<div class="warn">${t("a.warn")}</div></div>
${navRow(2,`<button class="btn t" data-act="kit">${t("btn.prepare")}</button>`)}`}
function lockBox(){return`<div class="card lock"><h3>${t("lock.h")}</h3><p>${t("lock.p")}</p><a class="btn t" href="${wa()}" target="_blank" rel="noopener" data-act="wa">${t("lock.btn",{price:CONFIG.PRICE})}</a><p class="note">${t("lock.note")}</p><div class="row jc"><input id="code" class="codeinp" placeholder="${esc(t("code.ph"))}" aria-label="${esc(t("code.ph"))}" autocomplete="off" maxlength="128"><button class="btn alt" ${S.verifying?"disabled":""} data-act="unlock">${S.verifying?t("code.verifying"):t("code.use")}</button></div>${errBox()}</div>`}
const unlocked=()=>S.demo||S.premium; // só o servidor concede Premium (S.premium só passa a true depois de /api/analyze verify responder OK)
function cp(id,ev){const b=ev&&ev.target,old=b&&b.textContent;navigator.clipboard.writeText($("#"+id).innerText).then(()=>{if(b){b.textContent=t("cp.done");setTimeout(()=>b.textContent=old,1500)}}).catch(()=>{if(b){b.textContent=t("cp.fail");setTimeout(()=>b.textContent=old,2000)}})}
// Edição do CV gerado: só caminhos conhecidos (evita escrever em propriedades inesperadas).
const CV_PATH=/^(lang|name|headline|summary|contact|skills|languages|additional|(experience|education)\.\d{1,2}\.(role|company|period|bullets|title|institution|details))$/;
function cvSet(path,v){if(!S.cvdoc||!CV_PATH.test(path))return;const p=path.split(".");let o=S.cvdoc;for(let i=0;i<p.length-1;i++)o=o&&o[p[i]];if(!o||typeof o!="object")return;const k=p[p.length-1];o[k]=Array.isArray(o[k])?String(v).split("\n"):v}
const fld=(path,label,val,area)=>`<label class="fld"><span>${esc(label)}</span>${area?`<textarea data-cv="${path}" rows="${area}">${esc(val)}</textarea>`:`<input data-cv="${path}" value="${esc(val)}" maxlength="400">`}</label>`;
const lines=v=>(Array.isArray(v)?v:[]).join("\n");
function cvCard(){const h=`<h3>${t("cv.h")}</h3>`;
if(S.busyCv)return`<div class="card" role="status" aria-live="polite">${h}<p class="note">${t("cv.busy")} ${t("s3.wait")}</p><div class="sk"></div><div class="sk w70"></div><div class="sk w85"></div></div>`;
const d=S.cvdoc,cerr=S.cvErr?`<div role="alert" class="err">${esc(S.cvErr)}</div>`:"";
if(!d)return`<div class="card">${h}<p>${t("cv.p")}</p>${cerr}<button class="btn" data-act="gencv">${t("cv.gen")}</button></div>`;
const ck=d.check||{},chk=(ck.numbers&&ck.numbers.length?`<div class="warn">${t("cv.check.n",{list:esc(ck.numbers.join(", "))})}</div>`:"")+(ck.entities&&ck.entities.length?`<div class="warn">${t("cv.check.e",{list:esc(ck.entities.join(", "))})}</div>`:"");
const ex=(d.experience||[]).map((e,i)=>`<fieldset class="ent"><legend>${t("cv.f.exp")} ${i+1}</legend>${fld(`experience.${i}.role`,t("cv.f.role"),e.role)}${fld(`experience.${i}.company`,t("cv.f.company"),e.company)}${fld(`experience.${i}.period`,t("cv.f.period"),e.period)}${fld(`experience.${i}.bullets`,t("cv.f.bullets"),lines(e.bullets),4)}</fieldset>`).join("");
const ed=(d.education||[]).map((e,i)=>`<fieldset class="ent"><legend>${t("cv.f.edu")} ${i+1}</legend>${fld(`education.${i}.title`,t("cv.f.title"),e.title)}${fld(`education.${i}.institution`,t("cv.f.inst"),e.institution)}${fld(`education.${i}.period`,t("cv.f.period"),e.period)}${fld(`education.${i}.details`,t("cv.f.details"),e.details)}</fieldset>`).join("");
const ok=S.cvOk?"":"disabled";
return`<div class="card cvform">${h}<div class="warn">${t("cv.warn")}</div>${chk}
<label class="fld"><span>${t("cv.f.hl")}</span><select data-cv="lang"><option value="pt"${d.lang=="pt"?" selected":""}>Português</option><option value="en"${d.lang=="en"?" selected":""}>English</option></select></label>
${fld("name",t("cv.f.name"),d.name)}${fld("headline",t("cv.f.headline"),d.headline)}${fld("contact",t("cv.f.contact"),lines(d.contact),2)}${fld("summary",t("cv.f.summary"),d.summary,4)}${ex}${ed}
${fld("skills",t("cv.f.skills"),lines(d.skills),3)}${fld("languages",t("cv.f.langs"),lines(d.languages),2)}${fld("additional",t("cv.f.add"),lines(d.additional),2)}
<label class="chk"><input type="checkbox" data-cvok${S.cvOk?" checked":""}> <span>${t("cv.ok")}</span></label>${cerr}
<div class="row"><button class="btn t" data-act="cvdl" data-fmt="pdf" data-needok ${ok}>${t("cv.dl.pdf")}</button><button class="btn alt" data-act="cvdl" data-fmt="docx" data-needok ${ok}>${t("cv.dl.word")}</button>${S.demo?"":`<button class="btn alt" data-act="gencv">${t("cv.regen")}</button>`}</div></div>`}
function kitView(){if(!unlocked())return`<h2>${t("k.h")}</h2>${lockBox()}${navRow(3)}`;if(S.busy&&!S.busyCv)return`<div class="card" role="status" aria-live="polite"><div class="sk"></div><div class="sk"></div></div>`;
const next=navRow(3,`<button class="btn" data-act="iv">${t("btn.iv")}</button>`);
if(!S.kit)return`<h2>${t("k.h")}</h2>${errBox()}<div class="card"><p>${t("k.p")}</p><button class="btn" data-act="genkit">${t("k.gen")}</button></div>${cvCard()}${next}`;const k=S.kit;
const box=(id,ti,x)=>`<div class="card"><h3>${ti}</h3><pre id="${id}">${esc(x)}</pre><div class="row mt10"><button class="btn alt" data-act="copy" data-id="${id}">${t("cp.copy")}</button><button class="btn alt" data-act="dl" data-id="${id}" data-fmt="pdf">${t("ex.pdf")}</button><button class="btn alt" data-act="dl" data-id="${id}" data-fmt="docx">${t("ex.word")}</button>${S.demo?"":`<button class="btn alt" data-act="regenkit">${t("regen")}</button>`}</div></div>`;
return`<h2>${t("k.h")}</h2>${box("k1",t("k.cover"),k.cover_letter)}${box("k2",t("k.email"),t("k.subj")+k.email?.subject+"\n\n"+k.email?.body)}${box("k3",t("k.sum"),k.profile_summary)}<div class="warn">${t("k.warn")}</div>${cvCard()}${next}`}
function ivView(){if(!unlocked())return`<h2>${t("i.h")}</h2>${lockBox()}${navRow(4)}`;if(S.busy)return`<div class="card" role="status" aria-live="polite"><div class="sk"></div></div>`;
if(!S.iv)return`${errBox()}<button class="btn" data-act="geniv">${t("i.gen")}</button>${navRow(4)}`;
return`<h2>${t("i.q")}</h2><div class="card">${(Array.isArray(S.iv.questions)?S.iv.questions:[]).map(q=>`<details><summary>${esc(q.question)}</summary>${q.why?`<p><b>${t("i.why")}</b> ${esc(q.why)}</p>`:""}${q.structure?`<p><b>${t("i.struct")}</b> ${esc(q.structure)}</p>`:""}<p><b>${t("i.ex")}</b> ${esc(q.example||t("st.NOT_FOUND"))}</p></details>`).join("")}</div><div class="card"><h3>${t("i.ask")}</h3>${list(S.iv.ask_employer)}</div><p class="note">${t("i.note")}</p>${navRow(4)}`}
