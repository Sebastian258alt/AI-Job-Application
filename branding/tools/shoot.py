"""Captura ecrãs reais da app (modo demo) em 3 tamanhos. Uso: python3 branding/tools/shoot.py (a partir da raiz do projecto)."""
import subprocess,time,pathlib
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'branding/screenshots';OUT.mkdir(parents=True,exist_ok=True)
srv=subprocess.Popen(['python3','-m','http.server','8123','--directory',str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
vps={'desktop':(1440,900,2),'tablet':(820,1100,2),'mobile':(390,844,3)}
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    for name,(w,h,dpr) in vps.items():
        ctx=b.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr);pg=ctx.new_page();errs=[]
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None);pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto('http://localhost:8123/');pg.wait_for_selector('.hero');pg.evaluate('document.fonts.ready');pg.wait_for_timeout(600)
        pg.screenshot(path=str(OUT/f'{name}-landing.png'))
        for step,label in [(None,'analysis'),(4,'kit'),(5,'interview')]:
            pg.evaluate('loadDemo()' if step is None else f'go({step})');pg.wait_for_timeout(700);pg.screenshot(path=str(OUT/f'{name}-{label}.png'))
        print(name,'console errors:',errs);ctx.close()
    b.close()
finally: srv.terminate()
