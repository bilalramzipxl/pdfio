#!/usr/bin/env node
// Controle-loop voor PDF Studio.
//   node scripts/controle.js tests            typecheck + unit tests + renderer actueel + bundels (android, ios, web)
//   node scripts/controle.js web              bouwt de webversie en serveert die op http://localhost:8099 (voor de controle-agents)
//   node scripts/controle.js verdict <design|functie> <PASS|FAIL> "opmerking"   (door de agents)
//   node scripts/controle.js status           toont of alles PASS is voor de huidige code (exitcode 0 = PASS)
// Klaar = `status` zegt PASS: tests geslaagd, en beide agents hebben PASS gegeven op exact deze code.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const root = path.join(__dirname, '..');
const stateFile = path.join(root, '.claude', 'controle-status.json');
const webDir = path.join(root, '.controle', 'web');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const node = process.execPath;

function codeHash() {
  const h = crypto.createHash('sha256');
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) { if (f === 'rendererHtml.ts' || f === 'renderer.html') continue; walk(path.join(p, f)); } }
    else { h.update(p.replace(root, '')); h.update(fs.readFileSync(p)); }
  };
  ['src', 'tests', 'App.tsx', 'app.json', 'package.json', 'metro.config.js', 'tsconfig.json', 'scripts/renderer-glue.js', 'scripts/scan-glue.js', 'scripts/build-renderer.js'].forEach((f) => walk(path.join(root, f)));
  return h.digest('hex').slice(0, 16);
}
const load = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
const save = (s) => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); };

function step(name, cmd, args) {
  process.stdout.write(`\n== ${name} ==\n`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' && cmd !== node, maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  console.log(out.split('\n').slice(-12).join('\n'));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return { name, ok, tail: out.split('\n').slice(-25).join('\n') };
}

function tests() {
  const hash = codeHash();
  const results = [];
  results.push(step('typecheck', npx, ['tsc', '--noEmit']));
  results.push(step('unit-tests (PDF-logica)', npx, ['vitest', 'run']));
  const before = fs.readFileSync(path.join(root, 'src/services/rendererHtml.ts'), 'utf8');
  results.push(step('renderer opnieuw bouwen', node, ['scripts/build-renderer.js']));
  const after = fs.readFileSync(path.join(root, 'src/services/rendererHtml.ts'), 'utf8');
  const fresh = before === after;
  console.log(`${fresh ? 'PASS' : 'FAIL'} rendererHtml.ts was actueel`);
  results.push({ name: 'rendererHtml actueel', ok: fresh, tail: fresh ? '' : 'rendererHtml.ts liep achter op pdf.js/glue; is nu opnieuw gegenereerd, draai opnieuw.' });
  for (const p of ['android', 'ios']) results.push(step(`bundel ${p}`, npx, ['expo', 'export', '--platform', p, '--output-dir', path.join('.controle', p)]));
  results.push(step('bundel web', npx, ['expo', 'export', '--platform', 'web', '--output-dir', path.join('.controle', 'web')]));
  const ok = results.every((r) => r.ok);
  const s = load();
  const newHash = codeHash();
  save({ ...s, tests: { ok, hash: newHash, at: new Date().toISOString(), results: results.map(({ name, ok, tail }) => ({ name, ok, tail: ok ? '' : tail })) } });
  console.log(`\nTESTS: ${ok ? 'PASS' : 'FAIL'} (code ${newHash})`);
  if (hash !== newHash) console.log('(let op: code is tijdens de run veranderd)');
  process.exit(ok ? 0 : 1);
}

function web() {
  if (!fs.existsSync(path.join(webDir, 'index.html'))) { console.error('Geen webbundel. Draai eerst: node scripts/controle.js tests'); process.exit(1); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon' };
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(webDir, p);
    if (!f.startsWith(webDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(webDir, 'index.html');
    res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  }).listen(8099, () => console.log('PDF Studio (web, alleen voor controle): http://localhost:8099/  ?demo=editor | ?demo=collage | (leeg = startscherm)'));
}

function verdict(kind, v, note) {
  if (!['design', 'functie'].includes(kind) || !['PASS', 'FAIL'].includes(v)) { console.error('gebruik: verdict <design|functie> <PASS|FAIL> "opmerking"'); process.exit(2); }
  const s = load();
  s[kind] = { ok: v === 'PASS', hash: codeHash(), at: new Date().toISOString(), note: note || '' };
  save(s);
  console.log(`${kind}: ${v} voor code ${s[kind].hash}`);
}

function status() {
  const s = load(), hash = codeHash();
  const lines = [];
  const chk = (label, e) => { const state = !e ? 'ONTBREEKT' : e.hash !== hash ? 'VEROUDERD (code gewijzigd)' : e.ok ? 'PASS' : 'FAIL'; lines.push(`${label.padEnd(8)} ${state}${e && e.note ? ' - ' + e.note : ''}`); return state === 'PASS'; };
  const a = chk('tests', s.tests), b = chk('design', s.design), c = chk('functie', s.functie);
  console.log(lines.join('\n'));
  const ok = a && b && c;
  console.log(ok ? 'ALLES PASS' : 'NOG NIET KLAAR');
  process.exit(ok ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'tests') tests();
else if (cmd === 'web') web();
else if (cmd === 'verdict') verdict(rest[0], rest[1], rest.slice(2).join(' '));
else if (cmd === 'status') status();
else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).join('\n')); process.exit(cmd ? 2 : 0); }
