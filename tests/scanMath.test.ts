import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// De scan-wiskunde draait in de WebView; hier laden we hetzelfde bestand in Node zonder browser.
const code = fs.readFileSync(path.resolve(__dirname, '../scripts/scan-glue.js'), 'utf8');
const win: any = {};
new Function('window', 'document', 'Image', code)(win, {}, class {});
const M = win.__scanMath;

type P = { x: number; y: number };
/** Projecteert een w x h blad dat in 3D gedraaid is (x-, y-, z-as) met een pinhole-camera. */
function project(w: number, h: number, rx: number, ry: number, rz: number, f = 900, dz = 700, cx = 600, cy = 450): P[] {
  const pts: [number, number, number][] = [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]];
  return pts.map(([x, y, z]) => {
    let [a, b, c] = [x, y, z];
    [b, c] = [b * Math.cos(rx) - c * Math.sin(rx), b * Math.sin(rx) + c * Math.cos(rx)];
    [a, c] = [a * Math.cos(ry) + c * Math.sin(ry), -a * Math.sin(ry) + c * Math.cos(ry)];
    [a, b] = [a * Math.cos(rz) - b * Math.sin(rz), a * Math.sin(rz) + b * Math.cos(rz)];
    c += dz;
    return { x: (a * f) / c + cx, y: (b * f) / c + cy };
  });
}

describe('perspectief rechtzetten', () => {
  const A4 = 210 / 297;
  it.each([
    ['recht op', 0, 0, 0],
    ['voorover gekanteld (x-as)', 0.5, 0, 0],
    ['opzij gekanteld (y-as)', 0, 0.45, 0],
    ['x, y en z samen', 0.35, -0.3, 0.2],
    ['sterk gedraaid in het vlak (z-as)', 0.25, 0.2, 0.9],
  ])('vindt de echte verhouding van een A4 %s', (_n, rx, ry, rz) => {
    const q = project(210, 297, rx, ry, rz);
    const a = M.trueAspect(q, 600, 450);
    if (rx === 0 && ry === 0) return; // recht op: elke schatting is dan al goed (randen zijn gelijk)
    expect(a).toBeGreaterThan(0);
    expect(Math.abs(a / A4 - 1)).toBeLessThan(0.03);
  });
  it('homografie zet de uitvoerhoeken exact op de bronhoeken', () => {
    const src = [{ x: 100, y: 80 }, { x: 900, y: 140 }, { x: 860, y: 700 }, { x: 60, y: 640 }];
    const dst = [{ x: 0, y: 0 }, { x: 799, y: 0 }, { x: 799, y: 1131 }, { x: 0, y: 1131 }];
    const H = M.homography(dst, src);
    dst.forEach((d, i) => {
      const den = H[6] * d.x + H[7] * d.y + 1;
      expect((H[0] * d.x + H[1] * d.y + H[2]) / den).toBeCloseTo(src[i].x, 3);
      expect((H[3] * d.x + H[4] * d.y + H[5]) / den).toBeCloseTo(src[i].y, 3);
    });
  });
});

/** Een "foto" van een pagina: licht van links (donker) naar rechts (helder), tekstregels erop. */
function page(w = 240, h = 240, shade = true) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const paper = shade ? 110 + 140 * (x / (w - 1)) : 235;
    const ink = y % 24 > 17 && x > 20 && x < w - 20;
    const v = ink ? paper * 0.2 : paper, q = (y * w + x) * 4;
    d[q] = d[q + 1] = d[q + 2] = v; d[q + 3] = 255;
  }
  return { d, w, h };
}
const px = (p: { d: Uint8ClampedArray; w: number }, x: number, y: number) => p.d[(y * p.w + x) * 4];

describe('schaduw weg', () => {
  it('document: papier overal wit, tekst blijft donker', () => {
    const p = page(); M.enhanceData(p.d, p.w, p.h, 'document', true);
    expect(px(p, 4, 5)).toBeGreaterThan(235);   // donkere kant
    expect(px(p, 235, 5)).toBeGreaterThan(235); // heldere kant
    expect(px(p, 120, 21)).toBeLessThan(90);    // tekst
  });
  it('grijs met schaduw weg: links en rechts even licht; zonder blijft het verschil', () => {
    const a = page(); M.enhanceData(a.d, a.w, a.h, 'gray', true);
    expect(Math.abs(px(a, 4, 5) - px(a, 235, 5))).toBeLessThan(20);
    const b = page(); M.enhanceData(b.d, b.w, b.h, 'gray', false);
    expect(Math.abs(px(b, 4, 5) - px(b, 235, 5))).toBeGreaterThan(60);
  });
  it('kleur: tint blijft behouden terwijl de schaduw weggaat', () => {
    const p = page(); // rode vlek in de donkere hoek
    for (let y = 100; y < 130; y++) for (let x = 40; x < 80; x++) { const q = (y * p.w + x) * 4; p.d[q] = 200; p.d[q + 1] = 30; p.d[q + 2] = 30; }
    M.enhanceData(p.d, p.w, p.h, 'color', true);
    const q = (110 * p.w + 60) * 4;
    expect(p.d[q]).toBeGreaterThan(p.d[q + 1] + 80);
    expect(px(p, 235, 5)).toBeGreaterThan(220);
  });
  it('origineel zonder schaduw laat de pixels (bijna) ongemoeid', () => {
    const a = page(), b = page(); M.enhanceData(b.d, b.w, b.h, 'original', false);
    expect(Math.abs(px(a, 100, 5) - px(b, 100, 5))).toBeLessThan(3);
  });
  it('schaduwsterkte: ongelijk belicht > egaal', () => {
    const lit = page(), flat = page(240, 240, false);
    const g = (p: any) => { const l = new Float32Array(p.w * p.h); for (let i = 0; i < l.length; i++) l[i] = p.d[i * 4]; return M.shadowStrength(M.illumGrid(l, p.w, p.h)); };
    expect(g(lit)).toBeGreaterThan(0.3);
    expect(g(flat)).toBeLessThan(0.05);
  });
});

describe('suggestie-hulpjes', () => {
  it('ziet zijwaartse tekst', () => {
    const w = 200, h = 200, h1 = new Uint8ClampedArray(w * h * 4).fill(255), v1 = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (y % 20 < 6) { const q = (y * w + x) * 4; h1[q] = 0; }   // horizontale regels
      if (x % 20 < 6) { const q = (y * w + x) * 4; v1[q] = 0; }   // verticale regels
    }
    expect(M.textSideways(h1, w, h)).toBe(false);
    expect(M.textSideways(v1, w, h)).toBe(true);
  });
  it('kleurrijk vs. zwart-wit', () => {
    const n = 200 * 200, bw = new Uint8ClampedArray(n * 4).fill(240), col = new Uint8ClampedArray(n * 4).fill(240);
    for (let i = 0; i < n * 0.1; i++) { col[i * 4] = 220; col[i * 4 + 1] = 40; col[i * 4 + 2] = 40; }
    expect(M.isColorful(bw, n)).toBe(false);
    expect(M.isColorful(col, n)).toBe(true);
  });
});
