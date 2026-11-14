import { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import type { AnnotationMap, FormField, FormValues, PageRef, Source } from './types';

export const A4: [number, number] = [595.28, 841.89];

export function kindFromName(name: string, mime?: string | null): 'pdf' | 'png' | 'jpg' | null {
  const n = name.toLowerCase();
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (mime === 'image/png' || n.endsWith('.png')) return 'png';
  if (mime === 'image/jpeg' || n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpg';
  return null;
}

/** Magic-bytes controle: is dit echt een PDF? */
export function looksLikePdf(bytes: Uint8Array): boolean {
  let head = '';
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
  return head.includes('%PDF-');
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return false;
  } catch (e) {
    return /encrypted/i.test(String((e as Error)?.message));
  }
}

/** Grootte van de weergegeven pagina (rekening houdend met /Rotate) in punten. */
export function displayedSize(page: { getSize(): { width: number; height: number }; getRotation(): { angle: number } }) {
  const { width, height } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: height, height: width, rot: r } : { width, height, rot: r };
}

/** Weergave-fractie (u,v; linksboven) -> PDF-gebruikersruimte, voor een pagina met rotatie rot. W,H = ongeroteerde paginagrootte. */
export function toUser(u: number, v: number, W: number, H: number, rot: number): { x: number; y: number } {
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: v * W, y: u * H };
    case 180: return { x: (1 - u) * W, y: v * H };
    case 270: return { x: (1 - v) * W, y: (1 - u) * H };
    default: return { x: u * W, y: H - v * H };
  }
}

/** Bouwt een nieuw document uit een lijst pagina's (collage: herordenen, roteren, verwijderen, afbeeldingen). */
export async function buildCollage(sources: Source[], pages: PageRef[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const srcMap = new Map(sources.map((s) => [s.id, s]));
  const pdfCache = new Map<string, PDFDocument>();
  const imgCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const ref of pages) {
    const src = srcMap.get(ref.sourceId);
    if (!src) throw new Error(`Bron ${ref.sourceId} ontbreekt`);
    if (src.kind === 'pdf') {
      let doc = pdfCache.get(src.id);
      if (!doc) { doc = await loadPdf(src.bytes); pdfCache.set(src.id, doc); }
      const [copied] = await out.copyPages(doc, [ref.pageIndex]);
      const base = copied.getRotation().angle;
      copied.setRotation(degrees((((base + ref.rotation) % 360) + 360) % 360));
      out.addPage(copied);
    } else {
      let img = imgCache.get(src.id);
      if (!img) { img = src.kind === 'png' ? await out.embedPng(src.bytes) : await out.embedJpg(src.bytes); imgCache.set(src.id, img); }
      const landscape = img.width > img.height;
      const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
      const page = out.addPage([pw, ph]);
      const m = 18;
      const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
      const w = img.width * s, h = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      page.setRotation(degrees(((ref.rotation % 360) + 360) % 360));
    }
  }
  return out.save({ useObjectStreams: true });
}

export async function blankPage(bytes: Uint8Array, afterIndex: number): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const ref = doc.getPage(Math.min(afterIndex, doc.getPageCount() - 1));
  const { width, height } = ref.getSize();
  doc.insertPage(afterIndex + 1, [width, height]);
  return doc.save({ useObjectStreams: true });
}

/** Splitst in een PDF per bereik; ranges zijn 0-gebaseerd en inclusief, bv. [[0,2],[3,3]]. */
export async function splitByRanges(bytes: Uint8Array, ranges: [number, number][]): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes);
  const n = src.getPageCount();
  const res: Uint8Array[] = [];
  for (const [a, b] of ranges) {
    if (a < 0 || b >= n || a > b) throw new Error(`Ongeldig bereik ${a + 1}-${b + 1}`);
    const out = await PDFDocument.create();
    const idx = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
    res.push(await out.save({ useObjectStreams: true }));
  }
  return res;
}

/** "1-3, 5, 7-9" -> [[0,2],[4,4],[6,8]]. Gooit een leesbare fout bij ongeldige invoer. */
export function parseRanges(input: string, total: number): [number, number][] {
  const parts = input.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('Vul een paginabereik in, bv. 1-3, 5');
  return parts.map((p) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) throw new Error(`"${p}" is geen geldig bereik`);
    const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    if (a < 1 || b > total || a > b) throw new Error(`Bereik ${p} valt buiten 1-${total}`);
    return [a - 1, b - 1] as [number, number];
  });
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Helvetica kan alleen WinAnsi; vervang de rest zodat opslaan nooit crasht. */
export function winAnsiSafe(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF\n€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');
}

function annotationFinite(a: import('./types').Annotation): boolean {
  const nums: number[] = [];
  if (a.kind === 'ink') a.points.forEach((p) => nums.push(p.u, p.v, a.width));
  else if (a.kind === 'text') nums.push(a.u, a.v, a.size);
  else if (a.kind === 'signature') { nums.push(a.u, a.v, a.w, a.h, a.width); a.strokes.forEach((s) => s.forEach((p) => nums.push(p.u, p.v))); }
  else nums.push(a.u, a.v, a.w, a.h);
  return nums.every(Number.isFinite);
}

/** Brandt annotaties definitief in de pagina's. */
export async function flatten(bytes: Uint8Array, annots: AnnotationMap): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const [pi, list] of Object.entries(annots)) {
    const page = pages[Number(pi)];
    if (!page || !list.length) continue;
    const { width: W0, height: H0 } = page.getSize();
    const d = displayedSize(page);
    const rot = d.rot;
    const map = (u: number, v: number) => toUser(u, v, W0, H0, rot);
    for (const a of list) {
      if (!annotationFinite(a)) continue; // nooit crashen op ongeldige coördinaten
      if (a.kind === 'ink') {
        const color = hexToRgb(a.color);
        const t = a.width * d.width;
        const pts = a.points.map((p) => map(p.u, p.v));
        if (pts.length === 1) pts.push({ x: pts[0].x + 0.01, y: pts[0].y });
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({ start: pts[i - 1], end: pts[i], thickness: t, color, opacity: a.opacity, lineCap: LineCapStyle.Round, blendMode: a.opacity < 1 ? BlendMode.Multiply : BlendMode.Normal });
        }
      } else if (a.kind === 'text') {
        const size = a.size * d.width;
        winAnsiSafe(a.text).split('\n').forEach((line, i) => {
          const p = map(a.u, a.v + (size * (0.85 + i * 1.2)) / d.height);
          page.drawText(line, { x: p.x, y: p.y, size, font, color: hexToRgb(a.color), rotate: degrees(rot) });
        });
      } else if (a.kind === 'signature') {
        const color = hexToRgb(a.color);
        const t = a.width * d.width;
        for (const stroke of a.strokes) {
          const pts = stroke.map((p) => map(a.u + p.u * a.w, a.v + p.v * a.h));
          if (pts.length === 1) pts.push({ x: pts[0].x + 0.01, y: pts[0].y });
          for (let i = 1; i < pts.length; i++) page.drawLine({ start: pts[i - 1], end: pts[i], thickness: t, color, lineCap: LineCapStyle.Round });
        }
      } else if (a.kind === 'image') {
        const img = a.mime === 'image/png' ? await doc.embedPng(a.b64) : await doc.embedJpg(a.b64);
        const p = map(a.u, a.v + a.h);
        page.drawImage(img, { x: p.x, y: p.y, width: a.w * d.width, height: a.h * d.height, rotate: degrees(rot) });
      }
    }
  }
  return doc.save({ useObjectStreams: true });
}

export async function listFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await loadPdf(bytes);
  const out: FormField[] = [];
  for (const f of doc.getForm().getFields()) {
    // instanceof i.p.v. constructor.name: namen worden door minificatie in release-builds onleesbaar
    const name = f.getName();
    if (f instanceof PDFTextField) out.push({ name, type: 'text', value: f.getText() ?? '' });
    else if (f instanceof PDFCheckBox) out.push({ name, type: 'check', value: f.isChecked() });
    else if (f instanceof PDFDropdown || f instanceof PDFRadioGroup) {
      const sel = f.getSelected();
      out.push({ name, type: 'choice', options: f.getOptions(), value: Array.isArray(sel) ? sel[0] ?? '' : sel ?? '' });
    }
  }
  return out;
}

export async function fillForm(bytes: Uint8Array, values: FormValues, flattenForm = false): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [name, val] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f) continue;
    if (f instanceof PDFTextField) f.setText(winAnsiSafe(String(val)));
    else if (f instanceof PDFCheckBox) { if (val) f.check(); else f.uncheck(); }
    else if (f instanceof PDFDropdown || f instanceof PDFRadioGroup) { if (val) f.select(String(val)); }
  }
  form.updateFieldAppearances(font);
  if (flattenForm) form.flatten();
  return doc.save({ useObjectStreams: true });
}

/** Lichte compressie: object streams + metadata weg. Verliest niets; geeft het origineel terug als het niet kleiner wordt. */
export async function optimize(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
  doc.setProducer('PDF Studio'); doc.setCreator('PDF Studio');
  const out = await doc.save({ useObjectStreams: true });
  return out.length < bytes.length ? out : bytes;
}

/** Sterke compressie: pagina's zijn door de renderer al als JPEG gerasterd. Tekst is daarna niet meer selecteerbaar. */
export async function fromRasterPages(pages: { jpg: Uint8Array; widthPt: number; heightPt: number }[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of pages) {
    const img = await out.embedJpg(p.jpg);
    const page = out.addPage([p.widthPt, p.heightPt]);
    page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  return out.save({ useObjectStreams: true });
}

export async function pageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((p) => { const d = displayedSize(p); return { width: d.width, height: d.height }; });
}
