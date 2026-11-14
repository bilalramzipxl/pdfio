// Bouwt src/services/rendererHtml.ts: één HTML-pagina met pdf.js (+ worker) volledig ingebakken.
// Draait lokaal in een verborgen WebView; er wordt niets van het internet geladen.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const b = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const lib = fs.readFileSync(path.join(b, 'pdf.min.js'), 'utf8');
const worker = fs.readFileSync(path.join(b, 'pdf.worker.min.js'), 'utf8');
const scanGlue = fs.readFileSync(path.join(__dirname, 'scan-glue.js'), 'utf8');
const glue = fs.readFileSync(path.join(__dirname, 'renderer-glue.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>
<script>${esc(lib)}</script>
<script>${esc(worker)}</script>
<script>${esc(scanGlue)}</script>
<script>${esc(glue)}</script>
</body></html>`;
const out = `// GEGENEREERD door scripts/build-renderer.js - niet met de hand aanpassen.\nexport const RENDERER_HTML = ${JSON.stringify(html)};\n`;
fs.writeFileSync(path.join(root, 'src', 'services', 'rendererHtml.ts'), out);
fs.writeFileSync(path.join(root, 'scripts', 'renderer.html'), html); // voor testen in een gewone browser
console.log('rendererHtml.ts geschreven,', (out.length / 1024).toFixed(0), 'KB');
