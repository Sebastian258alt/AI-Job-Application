// Exportação para PDF e Word, feita no navegador (nada é enviado ao servidor).
// 1) O conteúdo é convertido num modelo neutro de "blocos"; 2) cada formato desenha esses blocos.
// PDF: jsPDF (local, /vendor). Word: ficheiro .docx criado aqui (ZIP sem compressão + XML), sem bibliotecas.
const CVH={pt:{summary:"Resumo",experience:"Experiência profissional",education:"Formação",skills:"Competências",languages:"Línguas",additional:"Informação adicional"},
en:{summary:"Summary",experience:"Professional experience",education:"Education",skills:"Skills",languages:"Languages",additional:"Additional information"}};
const cleanList=v=>(Array.isArray(v)?v:String(v||"").split("\n")).map(x=>String(x).trim()).filter(Boolean);
const paras=(x,b)=>String(x||"").split(/\n{2,}/).map(s=>s.trim()).filter(Boolean).map(s=>({t:"p",x:s,b}));
// Blocos: h1 | sub | meta | h2 | row{l,r} | li | p{b} | gap | note
function cvBlocks(d){const H=CVH[d.lang]||CVH.pt,B=[];
if(d.name)B.push({t:"h1",x:d.name});if(d.headline)B.push({t:"sub",x:d.headline});
const ct=cleanList(d.contact);if(ct.length)B.push({t:"meta",x:ct.join("  |  ")});
if(d.summary&&d.summary.trim())B.push({t:"h2",x:H.summary},{t:"p",x:d.summary.trim()});
const ex=(d.experience||[]).filter(e=>e&&(e.role||e.company||cleanList(e.bullets).length));
if(ex.length){B.push({t:"h2",x:H.experience});for(const e of ex){B.push({t:"row",l:[e.role,e.company].filter(Boolean).join(" - "),r:e.period||""});cleanList(e.bullets).forEach(x=>B.push({t:"li",x}));B.push({t:"gap"})}}
const ed=(d.education||[]).filter(e=>e&&(e.title||e.institution));
if(ed.length){B.push({t:"h2",x:H.education});for(const e of ed){B.push({t:"row",l:[e.title,e.institution].filter(Boolean).join(" - "),r:e.period||""});if(e.details)B.push({t:"p",x:e.details});B.push({t:"gap"})}}
const sk=cleanList(d.skills);if(sk.length)B.push({t:"h2",x:H.skills},{t:"p",x:sk.join(", ")});
const lg=cleanList(d.languages);if(lg.length)B.push({t:"h2",x:H.languages},{t:"p",x:lg.join(", ")});
const ad=cleanList(d.additional);if(ad.length){B.push({t:"h2",x:H.additional});ad.forEach(x=>B.push({t:"li",x}))}
return B}
const letterBlocks=x=>paras(x);
const emailBlocks=(subject,body)=>[{t:"p",x:subject,b:1},{t:"gap"},...paras(body)];
const summaryBlocks=(title,x)=>[{t:"h2",x:title},...paras(x)];
const slug=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);

// ---------- Word (.docx) ----------
const xe=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const wr=(x,o={})=>`<w:r><w:rPr>${o.b?"<w:b/>":""}${o.i?"<w:i/>":""}${o.c?`<w:color w:val="${o.c}"/>`:""}${o.s?`<w:sz w:val="${o.s}"/><w:szCs w:val="${o.s}"/>`:""}</w:rPr>${String(x).split("\n").map(l=>`<w:t xml:space="preserve">${xe(l)}</w:t>`).join("<w:br/>")}</w:r>`;
function wBlock(b){const x=b.x==null?"":b.x;switch(b.t){
case"h1":return`<w:p><w:pPr><w:spacing w:after="20"/></w:pPr>${wr(x,{b:1,c:"101827",s:44})}</w:p>`;
case"sub":return`<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${wr(x,{c:"4B5565",s:24})}</w:p>`;
case"meta":return`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${wr(x,{c:"4B5565",s:19})}</w:p>`;
case"h2":return`<w:p><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="101827"/></w:pBdr><w:spacing w:before="240" w:after="100"/></w:pPr>${wr(String(x).toUpperCase(),{b:1,c:"0B6B58",s:21})}</w:p>`;
case"row":return`<w:p><w:pPr><w:keepNext/><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs><w:spacing w:before="80" w:after="20"/></w:pPr>${wr(b.l,{b:1})}${b.r?`<w:r><w:tab/></w:r>`+wr(b.r,{c:"4B5565",s:20}):""}</w:p>`;
case"li":return`<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:spacing w:after="30"/><w:ind w:left="360" w:hanging="260"/></w:pPr><w:r><w:t>\u2022</w:t></w:r><w:r><w:tab/></w:r>${wr(x)}</w:p>`;
case"gap":return`<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
case"note":return`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${wr(x,{i:1,c:"8A94A6",s:16})}</w:p>`;
default:return`<w:p><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr>${wr(x,{b:b.b})}</w:p>`}}
const NS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',XH='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function docxFiles(blocks,lang){return[
["[Content_Types].xml",`${XH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
["_rels/.rels",`${XH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
["word/_rels/document.xml.rels",`${XH}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
["word/styles.xml",`${XH}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang=="en"?"en-GB":"pt-PT"}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`],
["word/document.xml",`${XH}<w:document ${NS}><w:body>${blocks.map(wBlock).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`]]}
const CRC32T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC32T[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0};
function zipStore(files){const enc=new TextEncoder(),d=new Date(),dt=((Math.max(d.getFullYear(),1980)-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate(),tm=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),loc=[],cen=[];let off=0;
for(const[name,data]of files){const nb=enc.encode(name),db=typeof data=="string"?enc.encode(data):data,crc=crc32(db);
const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(10,tm,true);lh.setUint16(12,dt,true);lh.setUint32(14,crc,true);lh.setUint32(18,db.length,true);lh.setUint32(22,db.length,true);lh.setUint16(26,nb.length,true);
loc.push(new Uint8Array(lh.buffer),nb,db);
const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(12,tm,true);ch.setUint16(14,dt,true);ch.setUint32(16,crc,true);ch.setUint32(20,db.length,true);ch.setUint32(24,db.length,true);ch.setUint16(28,nb.length,true);ch.setUint32(42,off,true);
cen.push(new Uint8Array(ch.buffer),nb);off+=30+nb.length+db.length}
let cl=0;cen.forEach(x=>cl+=x.length);const end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,cl,true);end.setUint32(16,off,true);
const parts=[...loc,...cen,new Uint8Array(end.buffer)],out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
const DOCX_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docxBytes=(blocks,lang)=>zipStore(docxFiles(blocks,lang));
const docxBlob=(blocks,lang)=>new Blob([docxBytes(blocks,lang)],{type:DOCX_MIME});

// ---------- PDF (jsPDF) ----------
// As fontes padrão do PDF cobrem Latin-1 (acentos do português); pontuação tipográfica é convertida e o resto é removido.
const pdfSafe=s=>String(s).replace(/[\u2018\u2019\u201A]/g,"'").replace(/[\u201C\u201D\u201E]/g,'"').replace(/[\u2013\u2014\u2212]/g,"-").replace(/\u2026/g,"...").replace(/[\u2022\u25CF]/g,"-").replace(/[\u00A0\u2007\u202F]/g," ").replace(/[^\u0009\u000A\u0020-\u007E\u00A1-\u00FF]/g,"");
async function pdfBlob(blocks,title){await lib("/vendor/jspdf.umd.min.js");const{jsPDF}=window.jspdf,doc=new jsPDF({unit:"mm",format:"a4",compress:true});
doc.setProperties({title:pdfSafe(title),creator:"ApplyPro"});
const W=210,H=297,M=20,CW=W-2*M,INK=[16,24,39],MUT=[75,85,101],TEAL=[11,107,88],PT=.3528,lh=s=>s*PT*1.42;let y=M;
const font=(size,style,c)=>{doc.setFont("helvetica",style);doc.setFontSize(size);doc.setTextColor(c[0],c[1],c[2])};
const room=h=>{if(y+h>H-M){doc.addPage();y=M}};
const line=(s,x,size,o)=>{doc.text(s,x,y+size*PT,o);y+=lh(size)};
for(const b of blocks){const x=pdfSafe(b.x==null?"":b.x);
if(b.t=="gap"){y+=2.2;continue}
if(b.t=="h1"){font(20,"bold",INK);for(const l of doc.splitTextToSize(x,CW)){room(lh(20));line(l,M,20)}y+=.8}
else if(b.t=="sub"){font(11,"normal",MUT);for(const l of doc.splitTextToSize(x,CW)){room(lh(11));line(l,M,11)}}
else if(b.t=="meta"){font(9,"normal",MUT);for(const l of doc.splitTextToSize(x,CW)){room(lh(9));line(l,M,9)}y+=1.5}
else if(b.t=="h2"){y+=3.5;room(14);font(10,"bold",TEAL);const yy=y+10*PT;doc.text(x.toUpperCase(),M,yy);doc.setDrawColor(INK[0],INK[1],INK[2]);doc.setLineWidth(.25);doc.line(M,yy+1.6,W-M,yy+1.6);y+=lh(10)+2.4}
else if(b.t=="row"){const r=pdfSafe(b.r||"");font(9.5,"normal",MUT);const rw=r?doc.getTextWidth(r):0;font(10.5,"bold",INK);const ls=doc.splitTextToSize(pdfSafe(b.l||""),CW-rw-4);room(lh(10.5)*ls.length+7);
if(r){font(9.5,"normal",MUT);doc.text(r,W-M,y+10.5*PT,{align:"right"})}font(10.5,"bold",INK);for(const l of ls)line(l,M,10.5)}
else if(b.t=="li"){font(10,"normal",INK);const ls=doc.splitTextToSize(x,CW-6);room(lh(10)*ls.length);doc.setFillColor(TEAL[0],TEAL[1],TEAL[2]);doc.circle(M+1.5,y+10*PT-1,.5,"F");for(const l of ls)line(l,M+5,10)}
else if(b.t=="note"){font(8,"normal",MUT);for(const l of doc.splitTextToSize(x,CW)){room(lh(8));line(l,M,8)}y+=2}
else{font(10.5,b.b?"bold":"normal",INK);for(const l of doc.splitTextToSize(x,CW)){room(lh(10.5));line(l,M,10.5)}y+=2.4}}
return doc.output("blob")}

// ---------- descarregar ----------
function saveBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}
async function exportDoc(fmt,blocks,base,lang,btn){if(S.exporting)return;S.exporting=true;const old=btn&&btn.textContent;if(btn){btn.disabled=true;btn.textContent="…"}
try{const B=S.demo?[{t:"note",x:t("ex.demo")},...blocks]:blocks;
saveBlob(fmt=="pdf"?await pdfBlob(B,base):docxBlob(B,lang||(LANG=="en"?"en":"pt")),base+"."+fmt);track("export_"+fmt)}
catch{S.exporting=false;if(btn){btn.disabled=false;btn.textContent=t("ex.fail");setTimeout(()=>{btn.textContent=old},2500)}return}
S.exporting=false;if(btn){btn.disabled=false;btn.textContent=old}}
// Origem de cada documento (o texto vem do estado, não do HTML)
function exportKit(id,fmt,btn){const k=S.kit;if(!k)return;const L=LANG=="en"?"en":"pt";let B,n;
if(id=="k1"){B=letterBlocks(k.cover_letter);n=t("ex.f.letter")}
else if(id=="k2"){B=emailBlocks(t("k.subj")+(k.email?.subject||""),k.email?.body);n=t("ex.f.email")}
else{B=summaryBlocks(t("k.sum"),k.profile_summary);n=t("ex.f.summary")}
exportDoc(fmt,B,n,L,btn)}
function exportCv(fmt,btn){const d=S.cvdoc;if(!d||!S.cvOk)return;const s=slug(d.name);exportDoc(fmt,cvBlocks(d),s?"CV-"+s:"CV",d.lang,btn)}
