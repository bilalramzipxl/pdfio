import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { kindFromName, looksLikePdf, isEncrypted } from '../engine/pdfOps';
import type { Source } from '../engine/types';

export type Doc = { id: string; name: string; uri: string; bytes: Uint8Array };
export type Recent = { id: string; name: string; uri: string; size: number; modified: number };

const LIB = () => new Directory(Paths.document, 'library');
const RECENT_KEY = 'recents.v1';

export const safeName = (n: string) => n.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const stripExt = (n: string) => n.replace(/\.[a-z0-9]{2,4}$/i, '');
export const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export async function readBytes(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await new File(uri).arrayBuffer());
}

/** Ruimt een tijdelijk bestand op (alleen in de cachemap van de app; nooit het originele bestand van de gebruiker). */
export function deleteTemp(uri: string | undefined | null) {
  try {
    if (!uri || Platform.OS === 'web') return;
    if (!uri.startsWith(Paths.cache.uri)) return;
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch { /* opruimen mag nooit een fout geven */ }
}

function writeBytes(file: File, bytes: Uint8Array) {
  if (!file.exists) file.create();
  file.write(bytes);
}

/** Kiest bestanden via de systeemkiezer. De bestanden worden alleen op het toestel gelezen. */
export async function pickFiles(opts: { multiple?: boolean; images?: boolean; pdf?: boolean } = {}): Promise<Source[]> {
  const type: string[] = [];
  if (opts.pdf !== false) type.push('application/pdf');
  if (opts.images) type.push('image/png', 'image/jpeg');
  const res = await DocumentPicker.getDocumentAsync({ type, multiple: !!opts.multiple, copyToCacheDirectory: true });
  if (res.canceled) return [];
  const out: Source[] = [];
  for (const a of res.assets) {
    const kind = kindFromName(a.name, a.mimeType);
    if (!kind) throw new Error(`"${a.name}" is geen PDF of afbeelding (png/jpg).`);
    const bytes = await readBytes(a.uri);
    deleteTemp(a.uri); // de kiezer maakte een kopie in de cache; die is nu niet meer nodig
    if (kind === 'pdf') {
      if (!looksLikePdf(bytes)) throw new Error(`"${a.name}" is geen geldig PDF-bestand.`);
      if (await isEncrypted(bytes)) throw new Error(`"${a.name}" is met een wachtwoord beveiligd. Dat ondersteunt de app nog niet.`);
    }
    out.push({ id: uid(), name: a.name, kind, bytes });
  }
  return out;
}

export async function loadRecents(): Promise<Recent[]> {
  if (Platform.OS === 'web') return [];
  try {
    const list: Recent[] = JSON.parse((await AsyncStorage.getItem(RECENT_KEY)) ?? '[]');
    return list.filter((r) => new File(r.uri).exists);
  } catch { return []; }
}

async function saveRecents(list: Recent[]) {
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 50)));
}

/** Bewaart de bytes in de bibliotheek van de app (kopie; het origineel blijft onaangeroerd) en zet het bovenaan Recent. */
export async function saveToLibrary(name: string, bytes: Uint8Array, existing?: Doc): Promise<Doc> {
  if (Platform.OS === 'web') { (globalThis as any).__lastSaved = { name, size: bytes.length }; return { id: existing?.id ?? uid(), name, uri: 'web:' + name, bytes }; }
  const dir = LIB();
  if (!dir.exists) dir.create({ intermediates: true });
  const id = existing?.id ?? uid();
  const file = existing ? new File(existing.uri) : new File(dir, `${id}.pdf`);
  writeBytes(file, bytes);
  const doc: Doc = { id, name, uri: file.uri, bytes };
  const rest = (await loadRecents()).filter((r) => r.id !== id);
  await saveRecents([{ id, name, uri: file.uri, size: bytes.length, modified: Date.now() }, ...rest]);
  return doc;
}

export async function openRecent(r: Recent): Promise<Doc> {
  const bytes = await readBytes(r.uri);
  return { id: r.id, name: r.name, uri: r.uri, bytes };
}

export async function removeRecent(r: Recent) {
  try { const f = new File(r.uri); if (f.exists) f.delete(); } catch {}
  await saveRecents((await loadRecents()).filter((x) => x.id !== r.id));
}

export async function renameRecent(r: Recent, name: string) {
  await saveRecents((await loadRecents()).map((x) => (x.id === r.id ? { ...x, name } : x)));
}

export type ExportFormat = 'pdf' | 'jpeg' | 'png';
export const EXPORT_TYPES: Record<ExportFormat, { ext: string; mime: string; uti: string; label: string }> = {
  pdf: { ext: 'pdf', mime: 'application/pdf', uti: 'com.adobe.pdf', label: 'PDF' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg', uti: 'public.jpeg', label: 'JPEG' },
  png: { ext: 'png', mime: 'image/png', uti: 'public.png', label: 'PNG' },
};

/** Deelt/exporteert een bestand (PDF, JPEG of PNG) met een nette bestandsnaam via het deelmenu van het systeem. */
export async function shareFile(name: string, bytes: Uint8Array, fmt: ExportFormat = 'pdf') {
  const T = EXPORT_TYPES[fmt], fileName = `${safeName(stripExt(name))}.${T.ext}`;
  if (Platform.OS === 'web') { // alleen voor controle in de browser: download + teller
    (globalThis as any).__lastShared = { name: fileName, size: bytes.length, fmt };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: T.mime })); a.download = fileName; a.click(); return;
  }
  const cache = new Directory(Paths.cache, 'export');
  if (!cache.exists) cache.create({ intermediates: true });
  const f = new File(cache, fileName);
  writeBytes(f, bytes);
  if (!(await Sharing.isAvailableAsync())) { deleteTemp(f.uri); throw new Error('Delen is op dit toestel niet beschikbaar.'); }
  try {
    await Sharing.shareAsync(f.uri, { mimeType: T.mime, UTI: T.uti, dialogTitle: fileName });
  } finally {
    deleteTemp(f.uri); // tijdelijke exportkopie weer opruimen
  }
}
export const sharePdf = (name: string, bytes: Uint8Array) => shareFile(name, bytes, 'pdf');

/** Handtekeningen worden alleen lokaal bewaard. */
export async function loadSignatures(): Promise<{ id: string; strokes: { u: number; v: number }[][]; ratio: number }[]> {
  try { return JSON.parse((await AsyncStorage.getItem('signatures.v1')) ?? '[]'); } catch { return []; }
}
export async function saveSignatures(list: { id: string; strokes: { u: number; v: number }[][]; ratio: number }[]) {
  await AsyncStorage.setItem('signatures.v1', JSON.stringify(list.slice(0, 5)));
}
