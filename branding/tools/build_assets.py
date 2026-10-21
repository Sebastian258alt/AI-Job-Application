"""Compõe os mockups (capturas reais dentro de dispositivos CSS). Uso: python3 branding/tools/build_assets.py (raiz do projecto).
Texto nas imagens: só palavras reais do produto. Sem gerador de imagens: nenhum ecrã é redesenhado."""
import pathlib
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2];U=lambda p:'file://'+str(ROOT/p)
S=U('branding/screenshots')+'/';FN=U('assets/fonts/plus-jakarta-sans-latin-')
IMG=ROOT/'assets/img';SOC=ROOT/'assets/social';MAS=ROOT/'branding/masters';TMP=ROOT/'branding/.comp'
for d in (IMG,SOC,MAS,TMP):d.mkdir(parents=True,exist_ok=True)
NAVY='#101827';TEAL='#60E5C2';TI='#0B6B58';BG='#F5F7FB';MUT='#4B5565'
CSS=f"""
@font-face{{font-family:PJS;font-weight:400;src:url({FN}400-normal.woff2)}}
@font-face{{font-family:PJS;font-weight:600;src:url({FN}600-normal.woff2)}}
@font-face{{font-family:PJS;font-weight:800;src:url({FN}800-normal.woff2)}}
*{{box-sizing:border-box;margin:0}}
body{{position:relative;overflow:hidden;font-family:PJS,sans-serif;color:{NAVY}}}
.d{{position:absolute;filter:drop-shadow(0 2.2em 2.4em rgba(6,10,22,.32)) drop-shadow(0 .35em .5em rgba(6,10,22,.22))}}
.scr{{position:relative;overflow:hidden;background:#fff}}
.scr img{{width:100%;height:100%;display:block;object-fit:cover;object-position:top}}
.scr::after{{content:"";position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.10),rgba(255,255,255,0) 38%)}}
.lap{{width:112em}}.lid{{width:100em;margin:0 auto;background:#0B1220;border-radius:2.2em 2.2em .5em .5em;padding:1.5em 1.6em 1.9em;box-shadow:inset 0 0 0 .14em #2B364A}}
.lap .scr{{aspect-ratio:16/10;border-radius:.5em}}
.base{{height:2.3em;background:linear-gradient(#dfe3ea,#aab1bf);border-radius:.3em .3em 3em 3em/.3em .3em 1.5em 1.5em;position:relative}}
.base::before{{content:"";position:absolute;left:50%;top:0;width:15em;height:.9em;margin-left:-7.5em;background:#98a0ae;border-radius:0 0 1em 1em}}
.tab{{width:50em;background:#0B1220;border-radius:4em;padding:1.8em;box-shadow:inset 0 0 0 .14em #2B364A}}.tab .scr{{aspect-ratio:820/1100;border-radius:2.3em}}
.ph{{width:24em;background:#0B1220;border-radius:4.6em;padding:1em;box-shadow:inset 0 0 0 .14em #2B364A}}.ph .scr{{aspect-ratio:390/844;border-radius:3.7em}}
"""
W={'lap':112,'tab':50,'ph':24}
def dev(kind,img,x,y,w,z=1):
    fs=w/W[kind];inner={'lap':'<div class="lid"><div class="scr"><img src="%s"></div></div><div class="base"></div>','tab':'<div class="scr"><img src="%s"></div>','ph':'<div class="scr"><img src="%s"></div>'}[kind]%(S+img)
    return f'<div class="d {kind}" style="left:{x}px;top:{y}px;font-size:{fs}px;z-index:{z}">{inner}</div>'
def page(w,h,bg,body): return f'<!doctype html><meta charset=utf-8><style>{CSS}body{{width:{w}px;height:{h}px;background:{bg}}}</style><body>{body}</body>'
def txt(x,y,w,html,color,size,extra=''): return f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;color:{color};font-size:{size}px;{extra}">{html}</div>'
def tag(x,y,text,size=22): return f'<div style="position:absolute;left:{x}px;top:{y}px;background:{TEAL};color:{NAVY};font-size:{size}px;font-weight:800;padding:.35em .9em;border-radius:99px">{text}</div>'
def logo(x,y,dark,h=44): return f'<img src="{U("assets/logo-dark.svg" if dark else "assets/logo-light.svg")}" style="position:absolute;left:{x}px;top:{y}px;height:{h}px">'
H1="font-weight:800;letter-spacing:-.02em;line-height:1.08"
NAVYBG=f'radial-gradient(120% 90% at 85% 10%,#1F2F4D 0%,{NAVY} 70%)';SOFT=f'radial-gradient(90% 80% at 50% 35%,#ffffff 0%,#E4EAF4 100%)'
HL='O teu CV está preparado para esta vaga?';SUB='Compara o teu CV com uma vaga e prepara uma candidatura mais forte com assistência de IA.'
A={}  # nome -> (w,h,dpr,html,destino)
A['hero-showcase']=(1600,720,2,page(1600,720,BG,dev('lap','desktop-landing.png',90,70,900)+dev('tab','tablet-landing.png',930,205,330,2)+dev('ph','mobile-landing.png',1290,288,170,3)),'web')
A['feature-cv-analysis']=(1200,900,2,page(1200,900,SOFT,dev('tab','tablet-analysis.png',150,110,520)+dev('ph','mobile-analysis.png',720,270,300,2)),'web')
A['feature-application-kit']=(1200,900,2,page(1200,900,SOFT,dev('lap','desktop-kit.png',60,130,1080)),'web')
A['feature-interview-prep']=(1200,900,2,page(1200,900,SOFT,dev('ph','mobile-interview.png',200,150,310)+dev('tab','tablet-interview.png',560,230,470,2)),'web')
A['og-image']=(1200,630,1,page(1200,630,NAVYBG,logo(64,50,True,44)+txt(64,140,560,HL,'#fff',50,H1)+txt(64,380,500,SUB,'#C9D3E3',21,'line-height:1.45')+dev('lap','desktop-analysis.png',640,150,700)+dev('ph','mobile-landing.png',1000,285,190,2)),'og')
A['product-showcase']=(2400,1350,1,page(2400,1350,NAVYBG,dev('lap','desktop-analysis.png',150,250,1400)+dev('tab','tablet-kit.png',1580,440,480,2)+dev('ph','mobile-analysis.png',2060,520,270,3)),'soc')
A['social-linkedin-launch']=(1200,627,1,page(1200,627,NAVYBG,logo(64,52,True,44)+txt(64,150,560,HL,'#fff',52,H1)+txt(64,345,500,SUB,'#C9D3E3',22,'line-height:1.45')+dev('lap','desktop-analysis.png',640,170,700)+dev('ph','mobile-landing.png',1000,300,190,2)),'soc')
A['social-facebook-promo']=(1200,630,1,page(1200,630,BG,logo(60,48,False,44)+txt(60,120,560,'Transforma o teu CV numa candidatura mais forte.',NAVY,46,H1)+txt(60,330,520,f'<b style="color:{TI}">Grátis:</b> pontuação, pontos fortes e lacunas básicas.<br><br><b>Premium (199 MT):</b> análise completa, carta, email e preparação de entrevista.',NAVY,22,'line-height:1.4')+dev('tab','tablet-analysis.png',680,70,330)+dev('ph','mobile-kit.png',960,190,200,2)),'soc')
A['social-whatsapp-status']=(1080,1920,1,page(1080,1920,NAVYBG,logo(72,90,True,60)+txt(72,200,900,HL,'#fff',92,H1)+dev('ph','mobile-landing.png',270,520,540)+tag(72,1730,'Análise grátis, sem login',34)),'soc')
A['social-square-post']=(1080,1080,1,page(1080,1080,NAVYBG,logo(64,52,True,44)+txt(64,125,720,'Transforma o teu CV numa candidatura mais forte.','#fff',60,H1)+dev('tab','tablet-analysis.png',150,420,470)+dev('ph','mobile-kit.png',680,520,270,2)),'soc')
A['banner-wide']=(1920,600,1,page(1920,600,BG,logo(96,64,False,48)+txt(96,150,820,HL,NAVY,64,H1)+txt(96,380,640,SUB,MUT,24,'line-height:1.45')+dev('lap','desktop-landing.png',1000,110,720)+dev('ph','mobile-analysis.png',1640,200,170,2)),'soc')
with sync_playwright() as p:
    b=p.chromium.launch()
    for n,(w,h,dpr,html,dest) in A.items():
        f=TMP/f'{n}.html';f.write_text(html);c=b.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr);pg=c.new_page()
        pg.goto('file://'+str(f));pg.evaluate('document.fonts.ready');pg.wait_for_timeout(400)
        tmp=MAS/f'{n}@2x.png' if dest=='web' else (IMG/'og-image.png' if dest=='og' else SOC/f'{n}.png')
        pg.screenshot(path=str(tmp));c.close()
        if dest=='web':
            im=Image.open(tmp).convert('RGB')
            for ow in (w,w//2):im.resize((ow,round(h*ow/w)),Image.LANCZOS).save(IMG/f'{n}-{ow}.webp','WEBP',quality=82,method=6)
        print('ok',n)
    b.close()
