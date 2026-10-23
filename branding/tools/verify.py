"""Verificação no navegador (3 larguras): imagens, erros de consola, overflow, fluxo demo. Uso: python3 branding/tools/verify.py"""
import subprocess,time,pathlib
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
srv=subprocess.Popen(['python3','-m','http.server','8123','--directory',str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    for name,(w,h) in {'desktop':(1440,900),'tablet':(820,1100),'mobile':(390,844)}.items():
        ctx=b.new_context(viewport={'width':w,'height':h});pg=ctx.new_page();errs=[];bad=[]
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None);pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('response',lambda r:bad.append((r.status,r.url)) if r.status>=400 else None)
        pg.goto('http://localhost:8123/');pg.wait_for_selector('.heroimg')
        pg.evaluate("document.querySelectorAll('img[loading=lazy]').forEach(i=>i.scrollIntoView())");pg.wait_for_timeout(800)
        imgs=pg.evaluate("[...document.images].map(i=>[i.currentSrc.split('/').pop(),i.naturalWidth>0])")
        ov=pg.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth")
        title=pg.title();brand=pg.inner_text('header.top');font=pg.evaluate("getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0]")
        pg.click('text=Analisar o meu CV');s1=pg.inner_text('#app h2')
        pg.evaluate('S.step=0;render()');pg.click('text=Ver demo');pg.wait_for_selector('.score');sc=pg.inner_text('.score .ring i')
        pg.click('text=Preparar candidatura');kit=pg.inner_text('#app h2');pg.click('text=Preparar entrevista');iv=pg.inner_text('#app h2')
        ov2=pg.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth")
        print(name,'| title:',title,'| header:',brand,'| h1 font:',font,'| imgs ok:',all(i[1] for i in imgs),len(imgs),'| overflow:',ov,ov2,'| errors:',errs,'| 4xx:',bad,'| flow:',s1,'>',sc,'>',kit,'>',iv);ctx.close()
    b.close()
finally: srv.terminate()
