import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, PanResponder, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Annotation, Pt } from '../engine/types';
import { Rendered, useRenderer } from '../services/Renderer';
import { useTheme } from '../ui/theme';
import { strokesToPath } from './SignaturePad';

export type Tool = 'hand' | 'pen' | 'highlight' | 'text' | 'sign' | 'image';
export const PEN = { width: 0.0045, opacity: 1 };
export const HILITE = { width: 0.03, opacity: 0.35, color: '#FFE600' };

type Props = {
  docId: string; index: number; width: number; tool: Tool; penColor: string;
  annots: Annotation[]; selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (page: number, a: Annotation) => void;
  onUpdate: (page: number, a: Annotation) => void;
  onTapText: (page: number, u: number, v: number) => void;
  onDrawing: (drawing: boolean) => void;
  newId: () => string;
};

export const PageView = React.memo(function PageView(p: Props) {
  const t = useTheme();
  const r = useRenderer();
  const [img, setImg] = useState<Rendered | null>(null);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState<Pt[]>([]);
  const h = img ? (p.width * img.h) / img.w : p.width * 1.414;
  const latest = useRef(p);
  latest.current = p;
  const hRef = useRef(h);
  hRef.current = h;

  useEffect(() => {
    let dead = false;
    setImg(null); setFailed(false);
    r.render(p.docId, p.index, Math.min(1400, Math.round(p.width * 2.2))).then((x) => { if (!dead) setImg(x); }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, [p.docId, p.index, p.width, r]);

  const drawing = p.tool === 'pen' || p.tool === 'highlight';
  const pts = useRef<Pt[]>([]);
  const draw = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.tool === 'pen' || latest.current.tool === 'highlight',
    onMoveShouldSetPanResponder: () => latest.current.tool === 'pen' || latest.current.tool === 'highlight',
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      latest.current.onDrawing(true);
      pts.current = [{ u: e.nativeEvent.locationX / latest.current.width, v: e.nativeEvent.locationY / hRef.current }];
      setLive(pts.current);
    },
    onPanResponderMove: (e) => {
      const u = Math.min(1, Math.max(0, e.nativeEvent.locationX / latest.current.width));
      const v = Math.min(1, Math.max(0, e.nativeEvent.locationY / hRef.current));
      const last = pts.current[pts.current.length - 1];
      if (Math.hypot(u - last.u, v - last.v) < 0.002) return;
      pts.current = [...pts.current, { u, v }];
      setLive(pts.current);
    },
    onPanResponderRelease: () => finish(),
    onPanResponderTerminate: () => finish(),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function finish() {
    const c = latest.current;
    const hl = c.tool === 'highlight';
    if (pts.current.length) {
      c.onAdd(c.index, { id: c.newId(), kind: 'ink', color: hl ? HILITE.color : c.penColor, width: hl ? HILITE.width : PEN.width, opacity: hl ? HILITE.opacity : PEN.opacity, points: pts.current });
    }
    pts.current = []; setLive([]); c.onDrawing(false);
  }

  const inks = p.annots.filter((a): a is Extract<Annotation, { kind: 'ink' }> => a.kind === 'ink');
  const hl = p.tool === 'highlight';
  const inkPath = (pp: Pt[]) => (pp.length === 1 ? `M${pp[0].u * p.width},${pp[0].v * h} l0.1,0` : 'M' + pp.map((q) => `${(q.u * p.width).toFixed(1)},${(q.v * h).toFixed(1)}`).join(' L'));

  return (
    <View style={{ width: p.width, height: h, backgroundColor: '#fff', alignSelf: 'center', marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}
      accessible accessibilityLabel={`Pagina ${p.index + 1}`}>
      {img ? <Image source={{ uri: img.uri }} style={{ width: p.width, height: h }} resizeMode="stretch" accessibilityIgnoresInvertColors /> : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{failed ? <Text style={{ color: t.danger }}>Pagina laden mislukt</Text> : <ActivityIndicator color={t.accent} />}</View>
      )}
      <Svg width={p.width} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
        {inks.map((a) => <Path key={a.id} d={inkPath(a.points)} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.width * p.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
        {live.length ? <Path d={inkPath(live)} stroke={hl ? HILITE.color : p.penColor} strokeOpacity={hl ? HILITE.opacity : 1} strokeWidth={(hl ? HILITE.width : PEN.width) * p.width} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </Svg>
      {p.tool === 'text' ? (
        <Pressable accessibilityLabel="Tik om tekst te plaatsen" onPress={(e) => { const n = e.nativeEvent as any; const x = Number.isFinite(n.locationX) ? n.locationX : n.offsetX; const y = Number.isFinite(n.locationY) ? n.locationY : n.offsetY; p.onTapText(p.index, Number.isFinite(x) ? x / p.width : 0.3, Number.isFinite(y) ? y / h : 0.3); }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      ) : null}
      {p.annots.map((a) => a.kind === 'ink' ? null : (
        <Item key={a.id} a={a} width={p.width} height={h} selected={p.selectedId === a.id} enabled={!drawing}
          onSelect={() => p.onSelect(a.id)} onMove={(u, v) => p.onUpdate(p.index, { ...a, u, v })} onDrawing={p.onDrawing} />
      ))}
      {/* Tekenvlak / tik-om-tekst-te-plaatsen / tik-om-te-deselecteren */}
      {drawing ? <View {...draw.panHandlers} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} /> : null}
    </View>
  );
});

function Item({ a, width, height, selected, enabled, onSelect, onMove, onDrawing }: {
  a: Exclude<Annotation, { kind: 'ink' }>; width: number; height: number; selected: boolean; enabled: boolean;
  onSelect: () => void; onMove: (u: number, v: number) => void; onDrawing: (d: boolean) => void;
}) {
  const start = useRef({ u: 0, v: 0 });
  const L = useRef({ a, width, height, onSelect, onMove, onDrawing });
  L.current = { a, width, height, onSelect, onMove, onDrawing };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = { u: L.current.a.u, v: L.current.a.v }; L.current.onSelect(); L.current.onDrawing(true); },
    onPanResponderMove: (_e, g) => {
      const c = L.current;
      const bw = c.a.kind === 'text' ? 0.1 : (c.a as any).w, bh = c.a.kind === 'text' ? 0.03 : (c.a as any).h;
      c.onMove(Math.min(1 - Math.min(bw, 0.2), Math.max(0, start.current.u + g.dx / c.width)), Math.min(1 - Math.min(bh, 0.05), Math.max(0, start.current.v + g.dy / c.height)));
    },
    onPanResponderRelease: () => L.current.onDrawing(false),
    onPanResponderTerminate: () => L.current.onDrawing(false),
  }), []);

  const border = selected ? { borderWidth: 1.5, borderColor: '#2F6BFF', borderStyle: 'dashed' as const } : { borderWidth: 1.5, borderColor: 'transparent' };
  const pos = { position: 'absolute' as const, left: a.u * width - 4, top: a.v * height - 4, padding: 3, ...border };
  if (a.kind === 'text') {
    return (
      <View {...(enabled ? pan.panHandlers : {})} pointerEvents={enabled ? 'auto' : 'none'} style={pos} accessibilityLabel={`Tekst: ${a.text}`}>
        <Text style={{ color: a.color, fontSize: a.size * width, lineHeight: a.size * width * 1.2 }}>{a.text}</Text>
      </View>
    );
  }
  const bw = a.w * width, bh = a.h * height;
  return (
    <View {...(enabled ? pan.panHandlers : {})} pointerEvents={enabled ? 'auto' : 'none'} style={{ ...pos, width: bw + 8, height: bh + 8 }} accessibilityLabel={a.kind === 'signature' ? 'Handtekening' : 'Afbeelding'}>
      {a.kind === 'image' ? <Image source={{ uri: `data:${a.mime};base64,${a.b64}` }} style={{ width: bw, height: bh }} resizeMode="stretch" />
        : <Svg width={bw} height={bh}><Path d={strokesToPath(a.strokes, bw, bh)} stroke={a.color} strokeWidth={a.width * width} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>}
    </View>
  );
}
