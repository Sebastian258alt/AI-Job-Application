// Leitura de PDF/DOCX no navegador, com validações. O texto extraído é depois validado de novo no servidor.
const ZIP_LIMITS={ENTRIES:3000,UNCOMPRESSED:30e6},PDF_TIMEOUT_MS=30000;

// Confirma o tipo real pelos primeiros bytes (a extensão sozinha não chega).
function checkMagic(buf,ext){const b=new Uint8Array(buf.slice(0,8));
return ext=="pdf"?(b[0]==0x25&&b[1]==0x50&&b[2]==0x44&&b[3]==0x46):(b[0]==0x50&&b[1]==0x4B&&b[2]==3&&b[3]==4)}

// Lê o diretório central do ZIP (DOCX) e soma os tamanhos descomprimidos declarados, para recusar "zip bombs" óbvias
// ANTES de entregar o ficheiro ao mammoth. Protecção parcial: os tamanhos declarados podem ser falsificados.
function zipInfo(buf){const v=new DataView(buf),n=v.byteLength;if(n<22)return null;let e=-1;
for(let i=n-22;i>=Math.max(0,n-22-65535);i--){if(v.getUint32(i,true)==0x06054b50){e=i;break}}
if(e<0)return null;const entries=v.getUint16(e+10,true);let p=v.getUint32(e+16,true),total=0,count=0;
if(entries==0xFFFF||v.getUint32(e+16,true)==0xFFFFFFFF)return{entries:Infinity,total:Infinity}; // ZIP64
while(count<entries&&p+46<=n&&v.getUint32(p,true)==0x02014b50){const sz=v.getUint32(p+24,true);total+=sz==0xFFFFFFFF?Infinity:sz;
p+=46+v.getUint16(p+28,true)+v.getUint16(p+30,true)+v.getUint16(p+32,true);count++;if(count>ZIP_LIMITS.ENTRIES||total>ZIP_LIMITS.UNCOMPRESSED)break}
return{entries:count==entries?count:Math.max(count,entries),total}}

const _libs={};
const lib=u=>_libs[u]||(_libs[u]=new Promise((r,j)=>{const s=document.createElement("script"),tm=setTimeout(()=>{s.remove();delete _libs[u];j(new Error("lib-timeout"))},15000);
s.src=u;s.crossOrigin="anonymous";s.referrerPolicy="no-referrer";s.onload=()=>{clearTimeout(tm);r()};s.onerror=()=>{clearTimeout(tm);delete _libs[u];j(new Error("lib-load"))};document.head.append(s)}));

class FileMsg extends Error{}
const bad=m=>{throw new FileMsg(m)};

async function readPdf(buf){await lib("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
// isEvalSupported:false = mitigação oficial do CVE-2024-4367 em versões antigas do pdf.js (execução de JS via fontes maliciosas)
const task=pdfjsLib.getDocument({data:buf,isEvalSupported:false,disableFontFace:false});
const tm=new Promise((_,j)=>setTimeout(()=>{task.destroy();j(new FileMsg("O PDF demorou demasiado a ser lido. Cola o texto do CV abaixo."))},PDF_TIMEOUT_MS));
const run=(async()=>{const d=await task.promise;
if(d.numPages>CONFIG.PDF_MAX_PAGES)bad(`O PDF tem ${d.numPages} páginas (máx. ${CONFIG.PDF_MAX_PAGES}). Usa um CV mais curto ou cola o texto.`);
let t="";for(let i=1;i<=d.numPages;i++){t+=(await(await d.getPage(i)).getTextContent()).items.map(x=>x.str).join(" ")+"\n";
if(t.length>CONFIG.CV_MAX*1.2)break} // pára cedo: o texto já excede o limite
return t})();
try{return await Promise.race([run,tm])}catch(e){if(e&&e.name=="PasswordException")bad("O PDF está protegido por palavra-passe. Remove a protecção ou cola o texto.");throw e}finally{try{task.destroy()}catch{}}}

async function readDocx(buf){const z=zipInfo(buf);
if(!z||z.entries>ZIP_LIMITS.ENTRIES||z.total>ZIP_LIMITS.UNCOMPRESSED)bad("O ficheiro DOCX é inválido ou demasiado grande depois de descomprimido. Cola o texto do CV.");
await lib("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
return (await mammoth.extractRawText({arrayBuffer:buf})).value}

async function onFile(f){if(!f||S.reading)return;const ext=f.name.split(".").pop().toLowerCase();
if(!["pdf","docx"].includes(ext)){S.err="Formato não suportado. Usa PDF ou DOCX, ou cola o texto.";return render()}
if(f.size<=0){S.err="O ficheiro está vazio.";return render()}
if(f.size>CONFIG.FILE_MAX){S.err="O ficheiro é demasiado grande (máx. 5 MB).";return render()}
S.reading=true;
try{const buf=await f.arrayBuffer();
if(!checkMagic(buf,ext))bad("O conteúdo do ficheiro não corresponde a um "+ext.toUpperCase()+" válido. Cola o texto do CV abaixo.");
const t=((ext=="docx"?await readDocx(buf):await readPdf(buf))||"").replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").trim();
if(t.length<CONFIG.MIN_CHARS)bad("Não foi encontrado texto suficiente no ficheiro (pode ser um PDF digitalizado, só com imagem). Cola o texto do CV abaixo.");
if(t.length>CONFIG.CV_MAX)bad(`O texto extraído tem ${t.length} caracteres (máx. ${CONFIG.CV_MAX}). Usa um CV mais curto ou cola apenas as partes relevantes.`);
S.cv=t;S.err="";track("cv_uploaded")}
catch(e){S.err=e instanceof FileMsg?e.message:"Não foi possível ler o ficheiro. Cola o texto do CV abaixo."}
S.reading=false;render()}

// "Arrasta o teu CV aqui": sem estes handlers o navegador abria o ficheiro e perdia-se o estado da página.
["dragover","drop"].forEach(ev=>window.addEventListener(ev,e=>{const ty=e.dataTransfer&&e.dataTransfer.types;if(!ty||![...ty].includes("Files"))return;
e.preventDefault();if(ev=="drop"&&S.step==1){const f=e.dataTransfer.files&&e.dataTransfer.files[0];if(f)onFile(f)}}));

function next1(){const n=S.cv.trim().length;if(n<CONFIG.MIN_CHARS){S.err="Adiciona o teu CV (ficheiro ou texto) para continuar.";return render()}
if(n>CONFIG.CV_MAX){S.err=`O CV tem ${n} caracteres (máx. ${CONFIG.CV_MAX}). Reduz o texto para continuar.`;return render()}
track("cv_pasted");go(2)}
function next2(){const n=S.vac.trim().length;if(n<CONFIG.MIN_CHARS){S.err="Cola a descrição da vaga para continuar.";return render()}
if(n>CONFIG.VAC_MAX){S.err=`A descrição da vaga tem ${n} caracteres (máx. ${CONFIG.VAC_MAX}). Reduz o texto para continuar.`;return render()}
track("vacancy_added");S.demo=false;runAnalysis()}
