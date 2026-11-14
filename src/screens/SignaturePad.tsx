import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Pt } from '../engine/types';
import { loadSignatures, saveSignatures, uid } from '../services/files';
import { Btn, Sheet } from '../ui/components';
import { useTheme } from '../ui/theme';

export type SigData = { strokes: Pt[][]; ratio: number }; // ratio = hoogte / breedte

const PAD_H = 190;

export const strokesToPath = (strokes: Pt[][], w: number, h: number) =>
  strokes.map((s) => (s.length === 1 ? `M${s[0].u * w},${s[0].v * h} l0.1,0` : 'M' + s.map((p) => `${(p.u * w).toFixed(1)},${(p.v * h).toFixed(1)}`).join(' L'))).join(' ');

/** Normaliseert getekende streken naar 0..1 binnen hun omkaderende rechthoek. */
export function normalize(raw: { x: number; y: number }[][]): SigData | null {
  const pts = raw.flat();
  if (!pts.length) return null;
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  if (w < 12 && h < 12) return null; // enkel een stip: geen handtekening
  return { strokes: raw.map((s) => s.map((p) => ({ u: (p.x - minX) / w, v: (p.y - minY) / h }))), ratio: h / w };
}

export function SignatureSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (s: SigData) => void }) {
  const t = useTheme();
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const [saved, setSaved] = useState<{ id: string; strokes: Pt[][]; ratio: number }[]>([]);
  const [size, setSize] = useState({ w: 300, h: PAD_H });
  const cur = useRef<{ x: number; y: number }[]>([]);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => { if (visible) { setStrokes([]); loadSignatures().then(setSaved); } }, [visible]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { cur.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }]; setStrokes((s) => [...s, cur.current]); },
    onPanResponderMove: (e) => {
      const { w, h } = sizeRef.current;
      const x = Math.min(Math.max(e.nativeEvent.locationX, 0), w), y = Math.min(Math.max(e.nativeEvent.locationY, 0), h);
      cur.current = [...cur.current, { x, y }];
      setStrokes((s) => [...s.slice(0, -1), cur.current]);
    },
  })).current;

  const done = async (remember: boolean) => {
    const n = normalize(strokes);
    if (!n) return;
    if (remember) {
      const list = [{ id: uid(), strokes: n.strokes, ratio: n.ratio }, ...saved];
      await saveSignatures(list);
    }
    onPick(n);
  };
  const removeSaved = async (id: string) => { const l = saved.filter((s) => s.id !== id); setSaved(l); await saveSignatures(l); };

  return (
    <Sheet visible={visible} onClose={onClose} title="Handtekening">
      <Text style={{ color: t.sub, marginBottom: 8 }}>Teken hieronder met je vinger of pen.</Text>
      <View {...pan.panHandlers} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        accessibilityLabel="Tekenvlak voor handtekening"
        style={{ height: PAD_H, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: t.field, overflow: 'hidden' }}>
        <Svg width="100%" height="100%" pointerEvents="none">
          <Path d={strokesToPath(strokes.map((s) => s.map((p) => ({ u: p.x / size.w, v: p.y / size.h }))), size.w, size.h)} stroke="#111" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        {!strokes.length ? <Text pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', top: PAD_H / 2 - 10, color: '#5B6472' }}>Teken hier</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Btn label="Wissen" kind="ghost" icon="trash-outline" onPress={() => setStrokes([])} disabled={!strokes.length} style={{ flex: 1 }} />
        <Btn label="Plaatsen" icon="checkmark" onPress={() => done(true)} disabled={!strokes.length} style={{ flex: 1.3 }} />
      </View>
      {saved.length ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: t.sub, fontWeight: '600', marginBottom: 6 }}>Opgeslagen handtekeningen (alleen op dit toestel)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {saved.map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: t.line }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Gebruik opgeslagen handtekening" onPress={() => onPick({ strokes: s.strokes, ratio: s.ratio })} style={{ width: 110, height: 56, padding: 6 }}>
                  <Svg width="100%" height="100%" viewBox={`0 0 100 ${Math.max(1, 100 * s.ratio)}`} preserveAspectRatio="xMidYMid meet">
                    <Path d={strokesToPath(s.strokes, 100, Math.max(1, 100 * s.ratio))} stroke="#111" strokeWidth={2} fill="none" strokeLinecap="round" />
                  </Svg>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Verwijder opgeslagen handtekening" onPress={() => removeSaved(s.id)} style={{ width: 48, height: 56, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: '#E2E6EE' }}>
                  <Text style={{ fontSize: 22, color: '#B42318' }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
