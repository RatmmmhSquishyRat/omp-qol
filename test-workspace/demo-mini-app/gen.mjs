import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const bannerArt = String.raw`  OOO  M   M PPP      QQQ  OOO  L
 O   O MM MM P  P    Q   Q O   O L
 O   O M M M PPP     Q Q Q O   O L
 O   O M   M P       Q  QQ O   O L
  OOO  M   M P        QQQ   OOO  LLLL
 OMP QOL`;
const seedLine = 'seed: deterministic-omp-qol';
const generatedAt = new Date().toISOString();
const content = `${bannerArt}\n${seedLine}\n${generatedAt}\n`;

const outputPath = resolve('banner.txt');
await writeFile(outputPath, content, 'utf8');
const { size } = await stat(outputPath);

// Embed the same content into index.html between markers, so the page
// renders from file:// without fetch (browsers block file:// fetches).
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const htmlPath = resolve('index.html');
const html = await readFile(htmlPath, 'utf8');
const next = html
  .replace(/<!--BANNER-BEGIN-->[\s\S]*?<!--BANNER-END-->/, `<!--BANNER-BEGIN--><pre id="banner">${escapeHtml(content)}</pre><!--BANNER-END-->`)
  .replace(/<!--TS-BEGIN-->[\s\S]*?<!--TS-END-->/, `<!--TS-BEGIN-->${generatedAt}<!--TS-END-->`);
await writeFile(htmlPath, next, 'utf8');

console.log(`Wrote ${outputPath} (${size} bytes)`);
console.log(`Embedded banner into ${htmlPath}`);
