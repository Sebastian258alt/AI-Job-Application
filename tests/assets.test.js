// Garante que todas as imagens referenciadas em index.html / js / css existem no disco.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
describe('Imagens', () => {
  it('todos os caminhos /assets/... referenciados existem', () => {
    const src = ['index.html', 'js/ui.js', 'css/style.css'].map(read).join('\n');
    const ui = read('js/ui.js');
    const paths = new Set([...src.matchAll(/\/assets\/[\w\-./]+\.(?:webp|png|jpg|svg)/g)].map(m => m[0]));
    // nomes gerados em ui.js a partir de IMG + ficheiro + sufixo
    const feats = [...ui.matchAll(/\["(feature-[\w-]+)"/g)].map(m => m[1]);
    for (const f of feats) for (const w of [600, 1200]) paths.add(`/assets/img/${f}-${w}.webp`);
    for (const w of [800, 1600]) paths.add(`/assets/img/hero-showcase-${w}.webp`);
    assert.ok(paths.size >= 9);
    for (const p of paths) assert.ok(existsSync(new URL('..' + p, import.meta.url)), 'falta ' + p);
  });
});

describe('Marca ApplyPro', () => {
  const png = f => { const b = readFileSync(new URL('../' + f, import.meta.url)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  it('o nome antigo não aparece em texto visível ao utilizador', () => {
    for (const f of ['index.html', 'js/ui.js', 'js/demo.js', 'data/prompts.js', 'js/state.js']) {
      const txt = read(f).replaceAll('copilot:event', '');
      assert.ok(!/copilot/i.test(txt), f + ' ainda menciona o nome antigo');
    }
    const html = read('index.html');
    assert.ok(/<title>ApplyPro/.test(html) && html.includes('og:site_name" content="ApplyPro"'));
    assert.ok(html.includes('<b>Apply<span>Pro</span></b>') && html.includes('/assets/favicon.svg') && !html.includes('📄'));
  });
  it('logótipos e tipo de letra existem; imagens sociais têm as dimensões certas', () => {
    for (const f of ['assets/logo-mark.svg', 'assets/logo-light.svg', 'assets/logo-dark.svg', 'assets/favicon.svg', 'assets/fonts/plus-jakarta-sans-latin-800-normal.woff2']) assert.ok(existsSync(new URL('../' + f, import.meta.url)), 'falta ' + f);
    const dims = { 'assets/img/og-image.png': [1200, 630], 'assets/social/social-linkedin-launch.png': [1200, 627], 'assets/social/social-facebook-promo.png': [1200, 630], 'assets/social/social-whatsapp-status.png': [1080, 1920], 'assets/social/social-square-post.png': [1080, 1080], 'assets/social/banner-wide.png': [1920, 600], 'assets/social/product-showcase.png': [2400, 1350] };
    for (const [f, d] of Object.entries(dims)) assert.deepEqual(png(f), d, f);
  });
  it('sem referências ao Google Fonts nem à paleta antiga no CSS', () => {
    assert.ok(!read('index.html').includes('fonts.googleapis') && !/#f6f1e7|#c8532b|Fraunces/i.test(read('css/style.css')));
  });
});
