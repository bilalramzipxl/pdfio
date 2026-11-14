import { describe, it, expect } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { createRequire } from 'node:module';
import {
  buildCollage, splitByRanges, parseRanges, flatten, listFormFields, fillForm, optimize, blankPage,
  pageCount, toUser, looksLikePdf, isEncrypted, kindFromName, winAnsiSafe, pageSizes, fromRasterPages,
} from '../src/engine/pdfOps';
import type { Source } from '../src/engine/types';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

// 1x1 rode PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));

async function makePdf(n: number, label = 'P'): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = d.addPage([300, 400]);
    p.drawText(`${label}${i + 1}`, { x: 20, y: 350, size: 24 });
  }
  return d.save();
}

async function textItems(bytes: Uint8Array, pageNo = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  return { items: tc.items as any[], page };
}

describe('collage', () => {
  it('voegt samen, herordent, roteert en verwijdert', async () => {
    const a: Source = { id: 'a', name: 'a.pdf', kind: 'pdf', bytes: await makePdf(3, 'A') };
    const b: Source = { id: 'b', name: 'b.pdf', kind: 'pdf', bytes: await makePdf(2, 'B') };
    const out = await buildCollage([a, b], [
      { key: '1', sourceId: 'b', pageIndex: 1, rotation: 0 },
      { key: '2', sourceId: 'a', pageIndex: 0, rotation: 90 },
      { key: '3', sourceId: 'a', pageIndex: 2, rotation: 0 },
    ]);
    expect(await pageCount(out)).toBe(3);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    const t1 = (await textItems(out, 1)).items.map((i) => i.str).join('');
    const t3 = (await textItems(out, 3)).items.map((i) => i.str).join('');
    expect(t1).toContain('B2');
    expect(t3).toContain('A3');
  });

  it('rotatie telt op bij bestaande rotatie', async () => {
    const d = await PDFDocument.create();
    d.addPage([100, 100]).setRotation(degrees(90));
    const src: Source = { id: 'x', name: 'x.pdf', kind: 'pdf', bytes: await d.save() };
    const out = await buildCollage([src], [{ key: 'k', sourceId: 'x', pageIndex: 0, rotation: 270 }]);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(0);
  });

  it('zet afbeeldingen om naar A4-pagina\'s en mengt met PDF', async () => {
    const pdf: Source = { id: 'p', name: 'p.pdf', kind: 'pdf', bytes: await makePdf(1) };
    const img: Source = { id: 'i', name: 'i.png', kind: 'png', bytes: PNG };
    const out = await buildCollage([pdf, img], [
      { key: '1', sourceId: 'p', pageIndex: 0, rotation: 0 },
      { key: '2', sourceId: 'i', pageIndex: 0, rotation: 0 },
    ]);
    const sizes = await pageSizes(out);
    expect(sizes).toHaveLength(2);
    expect(sizes[1].width).toBeCloseTo(595.28, 1);
  });

  it('geeft een duidelijke fout bij ontbrekende bron', async () => {
    await expect(buildCollage([], [{ key: '1', sourceId: 'zz', pageIndex: 0, rotation: 0 }])).rejects.toThrow(/ontbreekt/);
  });
});

describe('splitsen en bereiken', () => {
  it('splitst op bereiken', async () => {
    const bytes = await makePdf(5);
    const parts = await splitByRanges(bytes, [[0, 1], [2, 4]]);
    expect(await pageCount(parts[0])).toBe(2);
    expect(await pageCount(parts[1])).toBe(3);
  });
  it('parseRanges', () => {
    expect(parseRanges('1-3, 5', 5)).toEqual([[0, 2], [4, 4]]);
    expect(() => parseRanges('9', 5)).toThrow(/buiten/);
    expect(() => parseRanges('a', 5)).toThrow(/geldig/);
    expect(() => parseRanges('3-1', 5)).toThrow();
    expect(() => parseRanges('  ', 5)).toThrow();
  });
  it('lege pagina invoegen', async () => {
    const out = await blankPage(await makePdf(2), 0);
    expect(await pageCount(out)).toBe(3);
  });
});

describe('annotaties vastbranden (flatten)', () => {
  it('tekst staat op de juiste plek bij rotatie 0', async () => {
    const bytes = await makePdf(1);
    const out = await flatten(bytes, { 0: [{ id: '1', kind: 'text', color: '#ff0000', text: 'Hallo', u: 0.5, v: 0.5, size: 0.05 }] });
    const { items } = await textItems(out);
    const it = items.find((i) => i.str === 'Hallo')!;
    expect(it).toBeTruthy();
    expect(it.transform[4]).toBeCloseTo(150, 0); // x = 0.5*300
    expect(it.transform[5]).toBeGreaterThan(180); // net onder midden (y=200 - basislijn)
    expect(it.transform[5]).toBeLessThan(200);
  });

  for (const rot of [90, 180, 270]) {
    it(`tekst blijft rechtop in beeld bij paginarotatie ${rot}`, async () => {
      const d = await PDFDocument.create();
      d.addPage([300, 400]).setRotation(degrees(rot));
      const bytes = await d.save();
      const out = await flatten(bytes, { 0: [{ id: '1', kind: 'text', color: '#000000', text: 'Rot', u: 0.25, v: 0.25, size: 0.06 }] });
      const { items, page } = await textItems(out);
      const it = items.find((i) => i.str === 'Rot')!;
      // viewport transform: zet tekstpositie om naar beeldcoördinaten
      const vp = page.getViewport({ scale: 1 });
      const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      expect(vx / vp.width).toBeCloseTo(0.25, 1);
      // basislijn ligt iets onder v=0.25
      expect(vy / vp.height).toBeGreaterThan(0.25);
      expect(vy / vp.height).toBeLessThan(0.35);
      // tekst loopt horizontaal in beeld: combineer tekstmatrix met viewportmatrix
      const t = it.transform, m = vp.transform;
      const a = m[0] * t[0] + m[2] * t[1];
      const b = m[1] * t[0] + m[3] * t[1];
      expect(Math.abs(b)).toBeLessThan(1e-6);
      expect(a).toBeGreaterThan(0);
    });
  }

  it('toUser is consistent: hoeken', () => {
    expect(toUser(0, 0, 300, 400, 0)).toEqual({ x: 0, y: 400 });
    expect(toUser(0, 0, 300, 400, 90)).toEqual({ x: 0, y: 0 });
    expect(toUser(0, 0, 300, 400, 180)).toEqual({ x: 300, y: 0 });
    expect(toUser(0, 0, 300, 400, 270)).toEqual({ x: 300, y: 400 });
  });

  it('ink, handtekening en afbeelding geven een geldige PDF zonder crash', async () => {
    const bytes = await makePdf(2);
    const b64 = Buffer.from(PNG).toString('base64');
    const out = await flatten(bytes, {
      0: [
        { id: 'a', kind: 'ink', color: '#ffe600', width: 0.04, opacity: 0.4, points: [{ u: 0.1, v: 0.1 }, { u: 0.8, v: 0.1 }] },
        { id: 'b', kind: 'signature', color: '#000', u: 0.5, v: 0.8, w: 0.3, h: 0.1, width: 0.004, strokes: [[{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }], [{ u: 0.5, v: 0.5 }]] },
        { id: 'c', kind: 'image', u: 0.1, v: 0.5, w: 0.2, h: 0.1, mime: 'image/png', b64 },
      ],
      1: [{ id: 'd', kind: 'text', color: '#000', text: 'Привет € ok', u: 0.1, v: 0.1, size: 0.05 }],
    });
    expect(await pageCount(out)).toBe(2);
    const { items } = await textItems(out, 2);
    expect(items.map((i) => i.str).join('')).toContain('ok');
    expect(out.length).toBeGreaterThan(bytes.length);
  });

  it('winAnsiSafe vervangt onbekende tekens', () => {
    expect(winAnsiSafe('a Ж b')).toBe('a ? b');
    expect(winAnsiSafe('é€')).toBe('é€');
  });
});

describe('formulieren', () => {
  async function formPdf() {
    const d = await PDFDocument.create();
    const p = d.addPage([300, 400]);
    const f = d.getForm();
    f.createTextField('naam').addToPage(p, { x: 20, y: 300, width: 150, height: 20 });
    f.createCheckBox('akkoord').addToPage(p, { x: 20, y: 250, width: 20, height: 20 });
    const dd = f.createDropdown('land'); dd.addOptions(['BE', 'NL']); dd.addToPage(p, { x: 20, y: 200, width: 100, height: 20 });
    return d.save();
  }
  it('leest en vult velden', async () => {
    const bytes = await formPdf();
    const fields = await listFormFields(bytes);
    expect(fields.map((f) => f.name).sort()).toEqual(['akkoord', 'land', 'naam']);
    const out = await fillForm(bytes, { naam: 'Jan', akkoord: true, land: 'NL' });
    const after = await listFormFields(out);
    expect(after.find((f) => f.name === 'naam')!.value).toBe('Jan');
    expect(after.find((f) => f.name === 'akkoord')!.value).toBe(true);
    expect(after.find((f) => f.name === 'land')!.value).toBe('NL');
  });
  it('kan formulier plat maken', async () => {
    const out = await fillForm(await formPdf(), { naam: 'Jan' }, true);
    expect(await listFormFields(out)).toHaveLength(0);
  });
});

describe('overig', () => {
  it('optimize maakt het nooit groter', async () => {
    const bytes = await makePdf(10);
    const out = await optimize(bytes);
    expect(out.length).toBeLessThanOrEqual(bytes.length);
    expect(await pageCount(out)).toBe(10);
  });
  it('fromRasterPages bouwt PDF uit JPEG', async () => {
    // minimale geldige JPEG via pdf-lib is niet beschikbaar; gebruik een kleine echte JPEG
    const jpg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
    const out = await fromRasterPages([{ jpg, widthPt: 200, heightPt: 100 }]);
    expect(await pageCount(out)).toBe(1);
  });
  it('herkent pdf, naam en versleuteling', async () => {
    expect(looksLikePdf(await makePdf(1))).toBe(true);
    expect(looksLikePdf(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(kindFromName('x.JPEG')).toBe('jpg');
    expect(kindFromName('x.txt')).toBeNull();
    expect(await isEncrypted(await makePdf(1))).toBe(false);
  });
});

describe('robuustheid', () => {
  it('flatten slaat annotaties met NaN-coördinaten over i.p.v. te crashen', async () => {
    const out = await flatten(await makePdf(1), { 0: [
      { id: 'x', kind: 'text', color: '#000', text: 'weg', u: NaN, v: NaN, size: 0.05 },
      { id: 'y', kind: 'text', color: '#000', text: 'blijft', u: 0.2, v: 0.2, size: 0.05 },
    ] });
    const { items } = await textItems(out);
    const all = items.map((i) => i.str).join('');
    expect(all).toContain('blijft');
    expect(all).not.toContain('weg');
  });

  it('formulieren werken ook in een geminificeerde bundel (klassenamen onleesbaar)', async () => {
    const esbuild = await import('esbuild');
    const res = await esbuild.build({ entryPoints: ['src/engine/pdfOps.ts'], bundle: true, minify: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
    const mod: any = { exports: {} };
    new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, require);
    const d = await PDFDocument.create();
    const p = d.addPage([300, 400]);
    d.getForm().createTextField('naam').addToPage(p, { x: 20, y: 300, width: 150, height: 20 });
    d.getForm().createCheckBox('akkoord').addToPage(p, { x: 20, y: 250, width: 20, height: 20 });
    const bytes = await d.save();
    const fields = await mod.exports.listFormFields(bytes);
    expect(fields.map((f: any) => f.name).sort()).toEqual(['akkoord', 'naam']);
    const out = await mod.exports.fillForm(bytes, { naam: 'Jan', akkoord: true });
    const after = await mod.exports.listFormFields(out);
    expect(after.find((f: any) => f.name === 'naam').value).toBe('Jan');
    expect(after.find((f: any) => f.name === 'akkoord').value).toBe(true);
  });
});
