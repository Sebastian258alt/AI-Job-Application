// Fotografar um CV em papel: leitura de texto (OCR) no próprio dispositivo, com Tesseract.js alojado em /vendor/tesseract.
// A fotografia nunca é enviada a lado nenhum: só o texto que o utilizador rever e confirmar segue para a análise, como um CV colado.
// A câmara é a aplicação nativa do telemóvel (<input capture>): melhor qualidade e não exige permissão de câmara à página.
const SCAN={MAX_PAGES:4,MAX_BYTES:15*1024*1024,MAX_SIDE:2200,BASE:"/vendor/tesseract",LANGS:["por","eng","por+eng"]};
// Tipo de imagem pelos primeiros bytes (não pela extensão), como na leitura de PDF/DOCX.
const imgKind=b=>{if(b.length>=3&&b[0]==0xFF&&b[1]==0xD8&&b[2]==0xFF)return"jpeg";
if(b.length>=8&&b[0]==0x89&&b[1]==0x50&&b[2]==0x4E&&b[3]==0x47&&b[4]==0x0D&&b[5]==0x0A&&b[6]==0x1A&&b[7]==0x0A)return"png";
if(b.length>=12&&String.fromCharCode(b[0],b[1],b[2],b[3])=="RIFF"&&String.fromCharCode(b[8],b[9],b[10],b[11])=="WEBP")return"webp";return""};
const scanClean=s=>String(s||"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g,"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
const scanLang=()=>SCAN.LANGS.includes(S.scan.lang)?S.scan.lang:(LANG=="en"?"eng":"por"); // por defeito, a língua da interface (menos dados a descarregar)
async function loadBitmap(f){try{return await createImageBitmap(f,{imageOrientation:"from-image"})}catch{return await createImageBitmap(f)}} // respeita a orientação EXIF da câmara
// Página -> canvas (rodado, reduzido; para o OCR também em tons de cinzento com contraste esticado).
function pageCanvas(p,maxSide,enhance){const w0=p.bmp.width,h0=p.bmp.height,swap=p.rot%180!=0,sw=swap?h0:w0,sh=swap?w0:h0,k=Math.min(1,maxSide/Math.max(sw,sh)),w=Math.max(1,Math.round(sw*k)),h=Math.max(1,Math.round(sh*k)),c=document.createElement("canvas");
c.width=w;c.height=h;const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,w,h);x.translate(w/2,h/2);x.rotate(p.rot*Math.PI/180);x.drawImage(p.bmp,-w0*k/2,-h0*k/2,w0*k,h0*k);x.setTransform(1,0,0,1,0,0);if(enhance)stretch(x,w,h);return c}
function stretch(c,w,h){const im=c.getImageData(0,0,w,h),d=im.data,hist=new Uint32Array(256),n=w*h;
for(let i=0;i<d.length;i+=4){const g=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;d[i]=g;hist[g]++}
let acc=0,lo=0,hi=255;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=n*.02){lo=v;break}}acc=0;for(let v=255;v>=0;v--){acc+=hist[v];if(acc>=n*.02){hi=v;break}}
if(hi-lo>=30){const k=255/(hi-lo);for(let i=0;i<d.length;i+=4){d[i]=d[i+1]=d[i+2]=Math.max(0,Math.min(255,(d[i]-lo)*k))|0}}else{for(let i=0;i<d.length;i+=4){d[i+1]=d[i+2]=d[i]}}
c.putImageData(im,0,0)}
const thumbOf=p=>pageCanvas(p,170,false).toDataURL("image/jpeg",.6); // data: URL (a CSP não permite blob: em imagens)
async function scanAdd(list){const sc=S.scan,files=[...list];if(!files.length||sc.busy)return;sc.err="";sc.msg="";
for(const f of files){if(sc.pages.length>=SCAN.MAX_PAGES){sc.err=t("e.scan.max",{n:SCAN.MAX_PAGES});break}
if(f.size>SCAN.MAX_BYTES){sc.err=t("e.scan.big");continue}
try{if(!imgKind(new Uint8Array(await f.slice(0,12).arrayBuffer()))){sc.err=t("e.scan.fmt");continue}
const p={bmp:await loadBitmap(f),rot:0,name:f.name};p.thumb=thumbOf(p);sc.pages.push(p)}catch{sc.err=t("e.scan.fmt")}}
render()}
function scanRot(i){const p=S.scan.pages[i];if(!p||S.scan.busy)return;p.rot=(p.rot+90)%360;p.thumb=thumbOf(p);render()}
function scanDel(i){const sc=S.scan,p=sc.pages[i];if(!p||sc.busy)return;if(p.bmp.close)p.bmp.close();sc.pages.splice(i,1);sc.err="";render()}
async function scanRun(){const sc=S.scan;if(sc.busy||!sc.pages.length)return;sc.busy=true;sc.err="";sc.msg="";sc.low=false;render();
const bar=(txt,pc)=>{const e=$("#scanp"),l=$("#scant");if(l)l.textContent=txt;if(e){if(pc==null)e.removeAttribute("value");else e.value=pc}};
let worker;
try{bar(t("scan.loading"),null);
try{await lib(SCAN.BASE+"/tesseract.min.js")}catch{throw new Error("lib")}
const n=sc.pages.length;let cur=0;
worker=await Tesseract.createWorker(scanLang().split("+"),1,{workerPath:SCAN.BASE+"/worker.min.js",corePath:SCAN.BASE+"/core",langPath:SCAN.BASE+"/lang",workerBlobURL:false,
logger:m=>{if(m.status=="recognizing text")bar(t("scan.reading",{n:cur+1,m:n,p:Math.round(m.progress*100)}),Math.round((cur+m.progress)/n*100))}});
const out=[];let conf=0;
for(cur=0;cur<n;cur++){bar(t("scan.reading",{n:cur+1,m:n,p:0}),Math.round(cur/n*100));const r=await worker.recognize(pageCanvas(sc.pages[cur],SCAN.MAX_SIDE,true));out.push(scanClean(r.data.text));conf+=r.data.confidence||0}
const text=out.filter(Boolean).join("\n\n");conf/=n;
if(text.length<CONFIG.MIN_CHARS){sc.err=t("e.scan.none");return}
const base=S.cv.trim(),merged=base?base+"\n\n"+text:text;
if(merged.length>CONFIG.CV_MAX){sc.err=t("e.cvlong2",{n:merged.length,m:CONFIG.CV_MAX});return}
S.cv=merged;S.err="";sc.pages.forEach(p=>{if(p.bmp.close)p.bmp.close()});sc.pages=[];sc.low=conf<60;sc.msg=sc.low?t("scan.low"):t("scan.done");track("scan_read",{pages:n})}
catch(e){sc.err=e&&e.message=="lib"?t("e.scan.lib"):t("e.scan.fail")}
finally{try{if(worker)await worker.terminate()}catch{}sc.busy=false;render()}}
// Cartão de fotografar/escolher imagens, miniaturas (rodar/remover) e leitura com progresso real.
function scanCard(){const sc=S.scan,dis=sc.busy?" disabled":"",full=sc.pages.length>=SCAN.MAX_PAGES,L=scanLang();
const pages=sc.pages.map((p,i)=>`<div class="pg"><img src="${p.thumb}" alt="${esc(t("scan.page",{n:i+1}))}"><span>${t("scan.page",{n:i+1})}</span><div class="row"><button class="btn alt sm" data-act="scanrot" data-i="${i}"${dis}>${t("scan.rot")}</button><button class="btn alt sm" data-act="scandel" data-i="${i}"${dis}>${t("scan.del")}</button></div></div>`).join("");
const opts=[["por","scan.l.por"],["eng","scan.l.eng"],["por+eng","scan.l.both"]].map(([v,k])=>`<option value="${v}"${L==v?" selected":""}>${t(k)}</option>`).join("");
return`<div class="scan"><h3>${t("scan.h")}</h3><p class="note">${t("scan.p")}</p>
<div class="row"><label class="btn t" for="cam">${t("scan.cam")}</label><input id="cam" type="file" accept="image/*" capture="environment" class="vh" data-scan${dis}${full?" disabled":""}><label class="btn alt" for="gal">${t("scan.gal")}</label><input id="gal" type="file" accept="image/*" multiple class="vh" data-scan${dis}${full?" disabled":""}></div>
${pages?`<div class="pgs">${pages}</div>`:""}
${pages&&!sc.busy?`<label class="fld"><span>${t("scan.lang")}</span><select data-scanlang>${opts}</select></label><p class="note">${t("scan.first")}</p><div class="row"><button class="btn" data-act="scanrun">${t("scan.run")}</button></div>`:""}
${sc.busy?`<div role="status" aria-live="polite"><progress id="scanp" max="100"></progress><p id="scant" class="note">${t("scan.loading")}</p></div>`:""}
${sc.err?`<div role="alert" class="err">${esc(sc.err)}</div>`:""}${sc.msg?`<div role="status" class="${sc.low?"warn":"okbox"}">${esc(sc.msg)}</div>`:""}</div>`}
