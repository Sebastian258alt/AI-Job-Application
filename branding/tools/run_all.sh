#!/usr/bin/env bash
# Reconstrói todas as imagens. A página inicial mostra as próprias imagens (recursão), por isso:
# 1) semeia placeholders neutros, 2) captura+compõe, 3) volta a capturar+compor (já sem marca antiga).
set -e; cd "$(dirname "$0")/../.."
python3 - <<'PY'
from PIL import Image; import glob
for f in glob.glob('assets/img/hero-showcase-*.webp')+glob.glob('assets/img/feature-*.webp'):
    Image.new('RGB',Image.open(f).size,(237,241,248)).save(f,'WEBP')
PY
python3 branding/tools/shoot.py && python3 branding/tools/build_assets.py
python3 branding/tools/shoot.py && python3 branding/tools/build_assets.py
