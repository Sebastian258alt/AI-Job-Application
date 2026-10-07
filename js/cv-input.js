async function onFile(f){if(!f)return;const ext=f.name.split(".").pop().toLowerCase();
if(!["pdf","docx"].includes(ext)){S.err="Formato não suportado. Usa PDF ou DOCX, ou cola o texto.";return render()}
if(f.size>5e6){S.err="O ficheiro é demasiado grande (máx. 5 MB).";return render()}
try{const buf=await f.arrayBuffer();let t="";
if(ext=="docx"){await lib("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");t=(await mammoth.extractRawText({arrayBuffer:buf})).value}
else{await lib("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";const d=await pdfjsLib.getDocument({data:buf}).promise;for(let i=1;i<=d.numPages;i++)t+=(await(await d.getPage(i)).getTextContent()).items.map(x=>x.str).join(" ")+"\n"}
if(t.trim().length<50)throw 0;S.cv=t.trim();S.err="";track("cv_uploaded")}catch{S.err="Não foi possível ler o ficheiro. Cola o texto do CV abaixo."}render()}
const lib=u=>new Promise((r,j)=>{const s=document.createElement("script");s.src=u;s.onload=r;s.onerror=j;document.head.append(s)});
function next1(){if(S.cv.trim().length<50){S.err="Adiciona o teu CV (ficheiro ou texto) para continuar.";return render()}track("cv_pasted");go(2)}
function next2(){if(S.vac.trim().length<50){S.err="Cola a descrição da vaga para continuar.";return render()}track("vacancy_added");S.demo=false;runAnalysis()}
