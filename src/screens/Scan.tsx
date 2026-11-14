import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, PanResponder, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { b64ToBytes } from '../engine/base64';
import { fromRasterPages } from '../engine/pdfOps';
import { Corner, ScanMode, useRenderer } from '../services/Renderer';
import { deleteTemp, uid } from '../services/files';
import { normalizeImage, rotateJpeg } from '../services/images';
import { showAlert } from '../services/dialog';
import { Btn, Busy, IconBtn, TopBar } from '../ui/components';
import { useTheme } from '../ui/theme';

type Shot = {
  id: string;
  raw: { b64: string; w: number; h: number };
  corners: Corner[]; // TL TR BR BL, 0..1
  mode: ScanMode;
  out?: { uri: string; w: number; h: number };
};

const MODES: { key: ScanMode; label: string }[] = [
  { key: 'document', label: 'Document' },
  { key: 'gray', label: 'Grijs' },
  { key: 'color', label: 'Kleur' },
];

/** Scannen: foto -> randen automatisch zoeken -> rechtzetten -> schoon contrast -> één PDF. Alles lokaal. */
export function Scan({ onCancel, onDone, demoPhotos }: { onCancel: () => void; onDone: (bytes: Uint8Array, name: string) => void; demoPhotos?: string[] }) {
  const t = useTheme();
  const r = useRenderer();
  const [shots, setShots] = useState<Shot[]>([]);
  const [editing, setEditing] = useState<Shot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => { setBusy(null); showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); };

  const process = async (s: Shot): Promise<Shot> => {
    const out = await r.scan(s.raw.b64, { corners: s.corners, mode: s.mode, maxSide: 1800, quality: 0.8 });
    return { ...s, out };
  };

  /** Nieuwe foto: randen zoeken en direct het bijsnijdscherm openen. */
  const addPhoto = async (b64: string, w: number, h: number) => {
    setBusy('Pagina zoeken…');
    const corners = await r.detect(b64);
    setBusy(null);
    setEditing({ id: uid(), raw: { b64, w, h }, corners, mode: 'document' });
  };

  useEffect(() => {
    if (!demoPhotos?.length) return;
    (async () => { try { setBusy('Pagina zoeken…'); const p = await r.detect(demoPhotos[0]); setBusy(null); setEditing({ id: uid(), raw: { b64: demoPhotos[0], w: 1200, h: 900 }, corners: p, mode: 'document' }); } catch (e) { fail(e); } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromPicker = async (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled || !res.assets[0]) return;
    try {
      setBusy('Foto voorbereiden…');
      const a = res.assets[0];
      const n = await normalizeImage(a.uri, { maxWidth: 2000, quality: 0.9 });
      deleteTemp(a.uri); // tijdelijke camerafoto opruimen
      setBusy(null);
      await addPhoto(n.b64, n.width, n.height);
    } catch (e) { fail(e); }
  };
  const camera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { showAlert('Camera uit', 'Geef de app toegang tot de camera in de instellingen van je toestel om te scannen. Je kunt ook een foto uit je galerij kiezen.'); return; }
    await fromPicker(await ImagePicker.launchCameraAsync({ quality: 1 }));
  };
  const gallery = async () => fromPicker(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));

  const applyEdit = async (s: Shot) => {
    try {
      setBusy('Scan verwerken…');
      const done = await process(s);
      setShots((list) => (list.some((x) => x.id === done.id) ? list.map((x) => (x.id === done.id ? done : x)) : [...list, done]));
      setEditing(null); setBusy(null);
    } catch (e) { fail(e); }
  };

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
      onDone(out, `Scan ${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`);
    } catch (e) { fail(e); }
  };

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
        ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 50, fontSize: 16, lineHeight: 24 }}>Leg het blad plat op een effen ondergrond met goed licht en neem een foto.{'\n'}De app zoekt de randen, zet het blad recht en maakt het wit en scherp.</Text>}
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
        <Btn label={shots.length ? `PDF maken (${shots.length})` : 'PDF maken'} icon="checkmark" onPress={finish} disabled={!shots.length} />
      </View>
      {busy ? <Busy text={busy} /> : null}
    </View>
  );
}

/** Bijsnijden: vier hoeken verslepen, filter kiezen, draaien. */
function CropStep({ shot, onCancel, onApply, onRotate }: { shot: Shot; onCancel: () => void; onApply: (s: Shot) => void; onRotate: (s: Shot) => void }) {
  const t = useTheme();
  const [corners, setCorners] = useState<Corner[]>(shot.corners);
  const [mode, setMode] = useState<ScanMode>(shot.mode);
  const [box, setBox] = useState({ w: 300, h: 400 });
  useEffect(() => setCorners(shot.corners), [shot.corners]);

  const scale = Math.min(box.w / shot.raw.w, box.h / shot.raw.h);
  const dw = shot.raw.w * scale, dh = shot.raw.h * scale;
  const ox = (box.w - dw) / 2, oy = (box.h - dh) / 2;
  const L = useRef({ corners, dw, dh });
  L.current = { corners, dw, dh };
  const start = useRef<Corner>({ x: 0, y: 0 });

  const pans = useMemo(() => [0, 1, 2, 3].map((i) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = { ...L.current.corners[i] }; },
    onPanResponderMove: (_e, g) => {
      const x = Math.min(1, Math.max(0, start.current.x + g.dx / L.current.dw)), y = Math.min(1, Math.max(0, start.current.y + g.dy / L.current.dh));
      setCorners((c) => c.map((p, k) => (k === i ? { x, y } : p)));
    },
  })), []);

  const pts = corners.map((p) => `${ox + p.x * dw},${oy + p.y * dh}`).join(' ');
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0D12' }}>
      <TopBar title="Randen aanpassen" left={<IconBtn icon="chevron-back" label="Terug" onPress={onCancel} />} />
      <Text style={{ color: '#C9D1DE', textAlign: 'center', paddingVertical: 8 }}>Sleep de vier hoeken naar de hoeken van het blad</Text>
      <View style={{ flex: 1 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Image source={{ uri: `data:image/jpeg;base64,${shot.raw.b64}` }} style={{ position: 'absolute', left: ox, top: oy, width: dw, height: dh }} resizeMode="stretch" accessibilityLabel="Foto van het blad" />
        <Svg width={box.w} height={box.h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
          <Polygon points={pts} fill="#2F6BFF33" stroke="#6E9BFF" strokeWidth={2.5} />
          {corners.map((p, i) => <Circle key={i} cx={ox + p.x * dw} cy={oy + p.y * dh} r={9} fill="#fff" stroke="#2F6BFF" strokeWidth={3} />)}
        </Svg>
        {corners.map((p, i) => (
          <View key={i} {...pans[i].panHandlers} accessibilityLabel={`Hoek ${['linksboven', 'rechtsboven', 'rechtsonder', 'linksonder'][i]}`}
            style={{ position: 'absolute', left: ox + p.x * dw - 28, top: oy + p.y * dh - 28, width: 56, height: 56 }} />
        ))}
      </View>
      <View style={{ backgroundColor: t.barBg, padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {MODES.map((m) => (
            <Pressable key={m.key} accessibilityRole="button" accessibilityState={{ selected: mode === m.key }} onPress={() => setMode(m.key)}
              style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: mode === m.key ? t.accent : t.field, backgroundColor: mode === m.key ? t.accent + '22' : 'transparent' }}>
              <Text style={{ color: mode === m.key ? t.accent : t.text, fontWeight: '700' }}>{m.label}</Text>
            </Pressable>
          ))}
          <IconBtn icon="refresh" label="Foto 90 graden draaien" onPress={() => onRotate({ ...shot, corners, mode })} />
        </View>
        <Btn label="Klaar" icon="checkmark" onPress={() => onApply({ ...shot, corners, mode })} />
      </View>
    </View>
  );
}
