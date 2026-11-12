#!/usr/bin/env bash
# Reconstrói todas as imagens. A página inicial mostra as próprias imagens (recursão), por isso:
# 1) semeia placeholders neutros, 2) captura+compõe, 3) volta a capturar+compor (já sem marca antiga).
set -e; cd "$(dirname "$0")/../.."
python3 - <<'PY'
from PIL import Image
for sfx in ('','-en'):
    for n,w,h in [('hero-showcase',1600,720),('feature-cv-analysis',1200,900),('feature-application-kit',1200,900),('feature-interview-prep',1200,900)]:
        for ow in (w,w//2): Image.new('RGB',(ow,round(h*ow/w)),(237,241,248)).save(f'assets/img/{n}{sfx}-{ow}.webp','WEBP')
PY
python3 branding/tools/shoot.py && python3 branding/tools/build_assets.py
python3 branding/tools/shoot.py && python3 branding/tools/build_assets.py
