import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, PanResponder, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { b64ToBytes } from '../engine/base64';
import { fromRasterPages } from '../engine/pdfOps';
import { Corner, ScanMode, useRenderer } from '../services/Renderer';
import { deleteTemp, EXPORT_TYPES, ExportFormat, fmtSize, shareFile, uid } from '../services/files';
import { normalizeImage, rotateJpeg } from '../services/images';
import { ensureCamera, ensurePhotos } from '../services/permissions';
import { showAlert } from '../services/dialog';
import { Btn, Busy, IconBtn, TopBar } from '../ui/components';
import { useTheme } from '../ui/theme';

type Shot = {
  id: string;
  raw: { b64: string; w: number; h: number };
  corners: Corner[]; // TL TR BR BL, 0..1
  mode: ScanMode;
  shadow: boolean;
  bright: number;   // -1..1, handmatig fijn afstellen
  contrast: number; // -1..1
  note?: string;
  out?: { uri: string; w: number; h: number };
};

const MODES: { key: ScanMode; label: string }[] = [
  { key: 'document', label: 'Document' },
  { key: 'gray', label: 'Grijs' },
  { key: 'color', label: 'Kleur' },
  { key: 'original', label: 'Origineel' },
];

/** Scannen: foto -> randen zoeken -> rechtzetten -> schaduw weg -> PDF/JPEG/PNG delen. Alles lokaal, op hoge kwaliteit. */
export function Scan({ onCancel, onDone, demoPhotos }: { onCancel: () => void; onDone: (bytes: Uint8Array, name: string) => void; demoPhotos?: string[] }) {
  const t = useTheme();
  const r = useRenderer();
  const [shots, setShots] = useState<Shot[]>([]);
  const [editing, setEditing] = useState<Shot | null>(null);
  const [result, setResult] = useState<{ pdf: Uint8Array; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => { setBusy(null); showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); };

  const process = async (s: Shot): Promise<Shot> => {
    const out = await r.scan(s.raw.b64, { corners: s.corners, mode: s.mode, shadow: s.shadow, bright: s.bright, contrast: s.contrast, maxSide: 3000, quality: 0.92 });
    return { ...s, out };
  };

  /** Nieuwe foto: randen zoeken en direct het bijsnijdscherm openen. */
  const addPhoto = async (b64: string, w: number, h: number) => {
    setBusy('Pagina zoeken…');
    const corners = await r.detect(b64);
    setBusy(null);
    setEditing({ id: uid(), raw: { b64, w, h }, corners, mode: 'document', shadow: true, bright: 0, contrast: 0 });
  };

  useEffect(() => {
    if (!demoPhotos?.length) return;
    (async () => { try { setBusy('Pagina zoeken…'); const p = await r.detect(demoPhotos[0]); setBusy(null); setEditing({ id: uid(), raw: { b64: demoPhotos[0], w: 1200, h: 900 }, corners: p, mode: 'document', shadow: true, bright: 0, contrast: 0 }); } catch (e) { fail(e); } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromPicker = async (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled || !res.assets[0]) return;
    try {
      setBusy('Foto voorbereiden…');
      const a = res.assets[0];
      const n = await normalizeImage(a.uri, { maxWidth: 3200, quality: 0.95 });
      deleteTemp(a.uri); // tijdelijke camerafoto opruimen
      setBusy(null);
      await addPhoto(n.b64, n.width, n.height);
    } catch (e) { fail(e); }
  };
  const camera = async () => {
    try {
      if (!(await ensureCamera())) return;
      await fromPicker(await ImagePicker.launchCameraAsync({ quality: 1, exif: false }));
    } catch (e) { fail(e); }
  };
  const gallery = async () => {
    try {
      await ensurePhotos();
      await fromPicker(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
    } catch (e) { fail(e); }
  };

  const applyEdit = async (s: Shot) => {
    try {
      setBusy('Scan verwerken…');
      const done = await process(s);
      setShots((list) => (list.some((x) => x.id === done.id) ? list.map((x) => (x.id === done.id ? done : x)) : [...list, done]));
      setEditing(null); setBusy(null);
    } catch (e) { fail(e); }
  };

  /** Edits accepteren: PDF bouwen en het resultaatscherm met Delen tonen. */
  const finish = async () => {
    try {
      setBusy('PDF maken…');
      const pages = shots.map((s) => {
        const o = s.out!;
        return { jpg: b64ToBytes(o.uri), widthPt: 595.28, heightPt: (595.28 * o.h) / o.w };
      });
      const out = await fromRasterPages(pages);
      setBusy(null);
      const d = new Date();
      setResult({ pdf: out, name: `Scan ${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}` });
    } catch (e) { fail(e); }
  };

  if (result) return <ResultStep shots={shots} pdf={result.pdf} name={result.name} onBack={() => setResult(null)} onOpen={() => onDone(result.pdf, result.name)} />;

  if (editing) return <>
    <CropStep shot={editing} onCancel={() => setEditing(null)} onApply={applyEdit} onRotate={async (s) => {
      try { setBusy('Draaien…'); const n = await rotateJpeg(s.raw.b64, 90); const c = await r.detect(n.b64); setBusy(null); setEditing({ ...s, raw: { b64: n.b64, w: n.width, h: n.height }, corners: c }); } catch (e) { fail(e); }
    }} />
    {busy ? <Busy text={busy} /> : null}
  </>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar title="Scannen" left={<IconBtn icon="close" label="Annuleren" onPress={onCancel} />} />
      <FlatList data={shots} numColumns={3} keyExtractor={(s) => s.id} contentContainerStyle={{ padding: 16 }} columnWrapperStyle={{ gap: 10 }}
        ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 50, fontSize: 16, lineHeight: 24 }}>Leg het blad plat op een effen ondergrond met goed licht en neem een foto.{'\n'}De app zoekt de randen, zet het blad recht en haalt schaduw weg.</Text>}
        renderItem={({ item, index }) => (
          <View style={{ flex: 1 / 3, marginBottom: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Scan ${index + 1} aanpassen`} onPress={() => setEditing(item)}>
              <Image source={{ uri: item.out!.uri }} style={{ width: '100%', aspectRatio: item.out!.w / item.out!.h, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: t.line }} resizeMode="contain" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Scan ${index + 1} verwijderen`} onPress={() => setShots((s) => s.filter((x) => x.id !== item.id))}
              style={{ position: 'absolute', top: 2, right: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#000B', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 18 }}>×</Text></View>
            </Pressable>
          </View>
        )} />
      <View style={{ padding: 16, gap: 10, backgroundColor: t.barBg }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn label="Foto nemen" icon="camera" onPress={camera} style={{ flex: 1.4 }} />
          <Btn label="Galerij" icon="images-outline" kind="ghost" onPress={gallery} style={{ flex: 1 }} />
        </View>
        <Btn label={shots.length ? `Klaar (${shots.length})` : 'Klaar'} icon="checkmark" onPress={finish} disabled={!shots.length} />
      </View>
      {busy ? <Busy text={busy} /> : null}
    </View>
  );
}

/** Resultaat: kies PDF, JPEG of PNG en deel. Bewerken/bewaren als PDF kan ook. */
function ResultStep({ shots, pdf, name, onBack, onOpen }: { shots: Shot[]; pdf: Uint8Array; name: string; onBack: () => void; onOpen: () => void }) {
  const t = useTheme();
  const r = useRenderer();
  const [fmt, setFmt] = useState<ExportFormat>('pdf');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const cache = useRef<Record<string, Uint8Array>>({});
  const many = shots.length > 1;

  /** Bytes van een pagina in JPEG of PNG. PNG wordt op volle kwaliteit (zonder verlies) opnieuw gemaakt uit de foto. */
  const imageBytes = async (f: 'jpeg' | 'png', i: number): Promise<Uint8Array> => {
    const s = shots[i], key = `${f}:${s.id}`;
    if (cache.current[key]) return cache.current[key];
    const bytes = f === 'jpeg' ? b64ToBytes(s.out!.uri) : b64ToBytes((await r.scan(s.raw.b64, { corners: s.corners, mode: s.mode, shadow: s.shadow, bright: s.bright, contrast: s.contrast, maxSide: 3000, fmt: 'png' })).uri);
    cache.current[key] = bytes; setSizes((x) => ({ ...x, [key]: bytes.length }));
    return bytes;
  };

  const choose = async (f: ExportFormat) => {
    setFmt(f);
    if (f === 'jpeg') { try { await imageBytes('jpeg', page); } catch { /* grootte is alleen informatie */ } }
  };
  const pick = (i: number) => { setPage(i); if (fmt === 'jpeg') imageBytes('jpeg', i).catch(() => {}); };

  const share = async () => {
    try {
      let bytes: Uint8Array, fileName = name;
      if (fmt === 'pdf') bytes = pdf;
      else { setBusy(fmt === 'png' ? 'PNG maken…' : 'Klaarmaken…'); bytes = await imageBytes(fmt, page); if (many) fileName = `${name} - pagina ${page + 1}`; }
      setBusy(null);
      await shareFile(fileName, bytes, fmt);
    } catch (e) { setBusy(null); showAlert('Delen lukte niet', e instanceof Error ? e.message : String(e)); }
  };

  const cur = shots[page];
  const info = fmt === 'pdf' ? `PDF · ${shots.length} pagina${many ? '’s' : ''} · ${fmtSize(pdf.length)}`
    : sizes[`${fmt}:${cur.id}`] ? `${EXPORT_TYPES[fmt].label} · pagina ${page + 1} · ${fmtSize(sizes[`${fmt}:${cur.id}`])}`
    : `${EXPORT_TYPES[fmt].label} · pagina ${page + 1}${fmt === 'png' ? ' · zonder kwaliteitsverlies' : ' · hoge kwaliteit'}`;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar title="Klaar om te delen" left={<IconBtn icon="chevron-back" label="Terug" onPress={onBack} />} />
      <View style={{ flex: 1, padding: 16 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={{ uri: cur.out!.uri }} accessibilityLabel={`Scan ${page + 1}`} resizeMode="contain" style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }} />
        </View>
        {many ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
            {shots.map((s, i) => (
              <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Pagina ${i + 1}`} accessibilityState={{ selected: i === page }} onPress={() => pick(i)}
                style={{ borderWidth: 2, borderColor: i === page ? t.accent : t.line, borderRadius: 8, padding: 2, minWidth: 48, minHeight: 64, justifyContent: 'center' }}>
                <Image source={{ uri: s.out!.uri }} style={{ width: 48, height: 64 }} resizeMode="contain" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <View style={{ padding: 16, gap: 10, backgroundColor: t.barBg }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['pdf', 'jpeg', 'png'] as ExportFormat[]).map((f) => (
            <Pressable key={f} accessibilityRole="button" accessibilityLabel={`Formaat ${EXPORT_TYPES[f].label}`} accessibilityState={{ selected: fmt === f }} onPress={() => choose(f)}
              style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: fmt === f ? t.accent : t.field, backgroundColor: fmt === f ? t.accent + '22' : 'transparent' }}>
              <Text style={{ color: fmt === f ? t.accent : t.text, fontWeight: '700' }}>{EXPORT_TYPES[f].label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: t.sub, textAlign: 'center', fontSize: 13 }} accessibilityLiveRegion="polite">{info}{fmt !== 'pdf' && many ? ' · kies hierboven een pagina' : ''}</Text>
        <Btn label={fmt === 'pdf' ? 'Delen' : many ? `Pagina ${page + 1} delen` : 'Delen'} icon="share-outline" onPress={share} />
        <Btn label="Opslaan en bewerken" icon="create-outline" kind="ghost" onPress={onOpen} />
      </View>
      {busy ? <Busy text={busy} /> : null}
    </View>
  );
}

/** Kleine teller voor helderheid/contrast: min en plus, met een getal ertussen. */
function Step({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const t = useTheme();
  const set = (v: number) => onChange(Math.max(-1, Math.min(1, Math.round(v * 4) / 4)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ color: t.text, fontWeight: '600', flex: 1 }}>{label}</Text>
      <IconBtn icon="remove" label={`${label} lager`} disabled={value <= -1} onPress={() => set(value - 0.25)} />
      <Text accessibilityLabel={`${label} ${Math.round(value * 4)}`} style={{ color: t.text, minWidth: 32, textAlign: 'center', fontWeight: '700' }}>{value > 0 ? '+' : ''}{Math.round(value * 4)}</Text>
      <IconBtn icon="add" label={`${label} hoger`} disabled={value >= 1} onPress={() => set(value + 0.25)} />
    </View>
  );
}

/** Bijsnijden en verbeteren: hoeken verslepen (met vergrootglas), suggestie, filter, schaduw, helderheid/contrast, voorbeeld, draaien. */
function CropStep({ shot, onCancel, onApply, onRotate }: { shot: Shot; onCancel: () => void; onApply: (s: Shot) => void; onRotate: (s: Shot) => void }) {
  const t = useTheme();
  const r = useRenderer();
  const [corners, setCorners] = useState<Corner[]>(shot.corners);
  const [mode, setMode] = useState<ScanMode>(shot.mode);
  const [shadow, setShadow] = useState<boolean>(shot.shadow);
  const [bright, setBright] = useState(shot.bright);
  const [contrast, setContrast] = useState(shot.contrast);
  const [note, setNote] = useState<string | null>(shot.note ?? null);
  const [working, setWorking] = useState<string | null>(null);
  const [showPrev, setShowPrev] = useState(false);
  const [prev, setPrev] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 300, h: 400 });
  useEffect(() => setCorners(shot.corners), [shot.corners]);
  useEffect(() => { setMode(shot.mode); setShadow(shot.shadow); setBright(shot.bright); setContrast(shot.contrast); setNote(shot.note ?? null); }, [shot.raw.b64]); // eslint-disable-line react-hooks/exhaustive-deps

  const PAD = 16; // ruimte rond de foto zodat hoekgrepen op de rand niet half buiten beeld vallen
  const scale = Math.min((box.w - 2 * PAD) / shot.raw.w, (box.h - 2 * PAD) / shot.raw.h);
  const dw = shot.raw.w * scale, dh = shot.raw.h * scale;
  const ox = (box.w - dw) / 2, oy = (box.h - dh) / 2;
  const L = useRef({ corners, dw, dh });
  L.current = { corners, dw, dh };
  const start = useRef<Corner>({ x: 0, y: 0 });

  const pans = useMemo(() => [0, 1, 2, 3].map((i) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = { ...L.current.corners[i] }; setDrag(i); },
    onPanResponderMove: (_e, g) => {
      const x = Math.min(1, Math.max(0, start.current.x + g.dx / L.current.dw)), y = Math.min(1, Math.max(0, start.current.y + g.dy / L.current.dh));
      setCorners((c) => c.map((p, k) => (k === i ? { x, y } : p)));
    },
    onPanResponderRelease: () => setDrag(null),
    onPanResponderTerminate: () => setDrag(null),
  })), []);

  // Voorbeeld van het eindresultaat (kleiner en snel), bijgewerkt na elke aanpassing.
  useEffect(() => {
    if (!showPrev) return;
    let dead = false;
    const h = setTimeout(async () => {
      try { const o = await r.scan(shot.raw.b64, { corners, mode, shadow, bright, contrast, maxSide: 900, quality: 0.75 }); if (!dead) setPrev(o); } catch { /* voorbeeld is optioneel */ }
    }, 250);
    return () => { dead = true; clearTimeout(h); };
  }, [showPrev, corners, mode, shadow, bright, contrast, shot.raw.b64]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Suggestie: de app kijkt naar de foto en kiest de beste bewerking. */
  const suggest = async () => {
    try {
      setWorking('Foto bekijken…');
      const s = await r.suggest(shot.raw.b64, { corners });
      const text = s.notes.join(' · ');
      setMode(s.mode); setShadow(s.shadow); setBright(0); setContrast(0); setNote(text);
      if (s.rotate) onRotate({ ...shot, corners, mode: s.mode, shadow: s.shadow, bright: 0, contrast: 0, note: text });
    } catch (e) { showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); }
    finally { setWorking(null); }
  };
  const autoEdges = async () => {
    try { setWorking('Randen zoeken…'); setCorners(await r.detect(shot.raw.b64)); }
    catch (e) { showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); }
    finally { setWorking(null); }
  };
  const wholePhoto = () => setCorners([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);

  const isDoc = mode === 'document';
  const pts = corners.map((p) => `${ox + p.x * dw},${oy + p.y * dh}`).join(' ');
  const cur = (): Shot => ({ ...shot, corners, mode, shadow, bright, contrast });
  const chip = (on: boolean) => ({ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1.5, borderColor: on ? t.accent : t.field, backgroundColor: on ? t.accent + '22' : 'transparent' });
  const LP = 120, Z = 3, dp = drag !== null ? corners[drag] : null;
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0D12' }}>
      <TopBar title={showPrev ? 'Zo wordt de scan' : 'Randen aanpassen'} left={<IconBtn icon="chevron-back" label={showPrev ? 'Terug naar de randen' : 'Terug'} onPress={showPrev ? () => setShowPrev(false) : onCancel} />} />
      <View style={{ flex: 1 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {showPrev && prev ? (
          <Image source={{ uri: prev.uri }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} resizeMode="contain" accessibilityLabel="Voorbeeld van de scan" />
        ) : (
          <>
            <Image source={{ uri: `data:image/jpeg;base64,${shot.raw.b64}` }} style={{ position: 'absolute', left: ox, top: oy, width: dw, height: dh }} resizeMode="stretch" accessibilityLabel="Foto van het blad" />
            <Svg width={box.w} height={box.h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
              <Polygon points={pts} fill="#2F6BFF33" stroke="#6E9BFF" strokeWidth={2.5} />
              {corners.map((p, i) => <Circle key={i} cx={ox + p.x * dw} cy={oy + p.y * dh} r={9} fill="#fff" stroke="#2F6BFF" strokeWidth={3} />)}
            </Svg>
            {corners.map((p, i) => (
              <View key={i} {...pans[i].panHandlers} accessibilityLabel={`Hoek ${['linksboven', 'rechtsboven', 'rechtsonder', 'linksonder'][i]}`}
                style={{ position: 'absolute', left: ox + p.x * dw - 28, top: oy + p.y * dh - 28, width: 56, height: 56 }} />
            ))}
            {dp ? (
              <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: ox + dp.x * dw > box.w / 2 ? 8 : box.w - LP - 8, width: LP, height: LP, borderRadius: LP / 2, overflow: 'hidden', borderWidth: 2, borderColor: '#fff', backgroundColor: '#000' }}>
                <Image source={{ uri: `data:image/jpeg;base64,${shot.raw.b64}` }} resizeMode="stretch" style={{ position: 'absolute', left: LP / 2 - dp.x * dw * Z, top: LP / 2 - dp.y * dh * Z, width: dw * Z, height: dh * Z }} />
                <View style={{ position: 'absolute', left: 0, right: 0, top: LP / 2 - 0.5, height: 1, backgroundColor: '#2F6BFF' }} />
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: LP / 2 - 0.5, width: 1, backgroundColor: '#2F6BFF' }} />
              </View>
            ) : null}
          </>
        )}
      </View>
      <View style={{ backgroundColor: t.barBg, padding: 14, gap: 10 }}>
        {note ? <Text numberOfLines={3} style={{ color: t.sub, fontSize: 13, lineHeight: 18 }} accessibilityLiveRegion="polite">Suggestie: {note}</Text> : null}
        {showPrev ? (
          <View style={{ gap: 2 }}>
            <Step label="Helderheid" value={bright} onChange={setBright} />
            <Step label="Contrast" value={contrast} onChange={setContrast} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={{ color: t.sub, flex: 1 }}>Randen</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Hele foto als rand" onPress={wholePhoto} style={chip(false)}><Text style={{ color: t.text, fontWeight: '700' }}>Hele foto</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Randen automatisch zoeken" onPress={autoEdges} style={chip(false)}><Text style={{ color: t.text, fontWeight: '700' }}>Automatisch</Text></Pressable>
          </View>
        )}
        <Btn label="Automatisch verbeteren" icon="sparkles-outline" kind="ghost" onPress={suggest} disabled={!!working} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {MODES.map((m) => (
            <Pressable key={m.key} accessibilityRole="button" accessibilityLabel={`Filter ${m.label}`} accessibilityState={{ selected: mode === m.key }} onPress={() => setMode(m.key)}
              style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: mode === m.key ? t.accent : t.field, backgroundColor: mode === m.key ? t.accent + '22' : 'transparent' }}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: mode === m.key ? t.accent : t.text, fontWeight: '700', fontSize: 13 }}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: isDoc || shadow, disabled: isDoc }} accessibilityLabel="Schaduw weghalen" disabled={isDoc} onPress={() => setShadow((x) => !x)}
            style={{ flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Switch value={isDoc || shadow} disabled={isDoc} onValueChange={setShadow} importantForAccessibility="no-hide-descendants" />
            <Text style={{ color: t.text, fontWeight: '600', flexShrink: 1 }}>{isDoc ? 'Schaduw weg (altijd bij Document)' : 'Schaduw weg'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: showPrev }} onPress={() => setShowPrev((x) => !x)} style={{ ...chip(showPrev), minHeight: 48 }}>
            <Text style={{ color: showPrev ? t.accent : t.text, fontWeight: '700' }}>Voorbeeld</Text>
          </Pressable>
          <IconBtn icon="refresh" label="Foto 90 graden draaien" onPress={() => onRotate(cur())} />
        </View>
        <Btn label="Klaar" icon="checkmark" onPress={() => onApply(cur())} />
      </View>
      {working ? <Busy text={working} /> : null}
    </View>
  );
}
