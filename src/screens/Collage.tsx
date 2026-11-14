import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildCollage, parseRanges, splitByRanges } from '../engine/pdfOps';
import { bytesToB64 as bytesB64 } from '../engine/base64';
import type { PageRef, Source } from '../engine/types';
import { useRenderer } from '../services/Renderer';
import { normalizeImage } from '../services/images';
import { pickFiles, saveToLibrary, stripExt, uid } from '../services/files';
import { Btn, BottomBar, Busy, IconBtn, Sheet, Toast, TopBar } from '../ui/components';
import { useTheme } from '../ui/theme';
import { showAlert } from '../services/dialog';

type Props = {
  initialSources: Source[]; title: string; openSplit?: boolean; doneLabel?: string;
  onCancel: () => void; onDone: (bytes: Uint8Array, name: string) => void; onSavedParts?: () => void;
};

/** Collage: pagina's uit meerdere PDF's/afbeeldingen combineren, herordenen, roteren, verwijderen, splitsen. */
export function Collage({ initialSources, title, openSplit, doneLabel = 'Klaar', onCancel, onDone, onSavedParts }: Props) {
  const t = useTheme();
  const r = useRenderer();
  const { width } = useWindowDimensions();
  const cols = width > 700 ? 4 : 3;
  const cell = (width - 16 * 2 - 10 * (cols - 1)) / cols;

  const [sources, setSources] = useState<Source[]>([]);
  const [pages, setPages] = useState<PageRef[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [range, setRange] = useState('');
  const docIds = useRef(new Map<string, string>()); // sourceId -> renderer docId
  const [ready, setReady] = useState(0);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const fail = (e: unknown) => { setBusy(null); showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); };

  const addSources = useCallback(async (list: Source[]) => {
    const refs: PageRef[] = [];
    for (const s of list) {
      if (s.kind === 'pdf') {
        const { docId, pages: n } = await r.load(s.bytes);
        docIds.current.set(s.id, docId);
        for (let i = 0; i < n; i++) refs.push({ key: uid(), sourceId: s.id, pageIndex: i, rotation: 0 });
      } else refs.push({ key: uid(), sourceId: s.id, pageIndex: 0, rotation: 0 });
    }
    setSources((x) => [...x, ...list]);
    setPages((p) => [...p, ...refs]);
    setReady((n) => n + 1);
  }, [r]);

  useEffect(() => {
    (async () => { try { setBusy('Pagina’s laden…'); await addSources(initialSources); setBusy(null); if (openSplit) setSplitOpen(true); } catch (e) { fail(e); } })();
    const ids = docIds.current;
    return () => { ids.forEach((id) => r.free(id)); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selected = pages.filter((p) => sel.has(p.key));

  const rotate = () => setPages((p) => p.map((x) => (sel.has(x.key) ? { ...x, rotation: (x.rotation + 90) % 360 } : x)));
  const remove = () => { setPages((p) => p.filter((x) => !sel.has(x.key))); setSel(new Set()); };
  const dup = () => setPages((p) => p.flatMap((x) => (sel.has(x.key) ? [x, { ...x, key: uid() }] : [x])));
  const move = (dir: -1 | 1) => setPages((p) => {
    const a = [...p];
    const idx = dir < 0 ? a.map((_, i) => i) : a.map((_, i) => a.length - 1 - i);
    for (const i of idx) {
      const j = i + dir;
      if (sel.has(a[i].key) && j >= 0 && j < a.length && !sel.has(a[j].key)) { [a[i], a[j]] = [a[j], a[i]]; }
    }
    return a;
  });

  const add = async () => {
    try {
      const picked = await pickFiles({ multiple: true, images: true });
      if (!picked.length) return;
      setBusy('Toevoegen…'); await addSources(picked); setBusy(null);
    } catch (e) { fail(e); }
  };

  const finish = async () => {
    if (!pages.length) { showAlert('Geen pagina’s', 'Voeg minstens één pagina toe.'); return; }
    try { setBusy('PDF maken…'); const out = await buildCollage(sources, pages); setBusy(null); onDone(out, title); } catch (e) { fail(e); }
  };

  const splitEach = async () => parts(pages.map((_, i) => [i, i] as [number, number]));
  const splitSel = async () => {
    const idx = pages.map((p, i) => (sel.has(p.key) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) { showAlert('Niets geselecteerd', 'Tik eerst op de pagina’s die je apart wilt.'); return; }
    setSplitOpen(false);
    try {
      setBusy('Splitsen…');
      const out = await buildCollage(sources, idx.map((i) => pages[i]));
      await saveToLibrary(`${stripExt(title)} (selectie)`, out);
      setBusy(null); flash('1 bestand gemaakt, zie Recent'); onSavedParts?.();
    } catch (e) { fail(e); }
  };
  const splitRange = async () => {
    try { parts(parseRanges(range, pages.length)); } catch (e) { showAlert('Ongeldig bereik', (e as Error).message); }
  };
  async function parts(ranges: [number, number][]) {
    setSplitOpen(false);
    try {
      setBusy('Splitsen…');
      const all = await buildCollage(sources, pages); // huidige volgorde/rotatie als basis
      const files = await splitByRanges(all, ranges);
      for (let i = 0; i < files.length; i++) await saveToLibrary(`${stripExt(title)} deel ${i + 1}`, files[i]);
      setBusy(null); flash(`${files.length} bestanden gemaakt, zie Recent`); onSavedParts?.();
    } catch (e) { fail(e); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar title={title} left={<IconBtn icon="close" label="Annuleren" onPress={onCancel} />}
        right={<Pressable accessibilityRole="button" accessibilityLabel={doneLabel} onPress={finish} style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}><Text style={{ color: t.accent, fontWeight: '800', fontSize: 17 }}>{doneLabel}</Text></Pressable>} />
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: t.sub }}>{pages.length} pagina{pages.length === 1 ? '' : '’s'} · tik om te selecteren{sel.size ? ` · ${sel.size} geselecteerd` : ''}</Text>
        {sel.size ? <Pressable accessibilityRole="button" onPress={() => setSel(new Set())} style={{ minHeight: 48, minWidth: 56, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.accent, fontWeight: '700' }}>Niets</Text></Pressable> : <Pressable accessibilityRole="button" onPress={() => setSel(new Set(pages.map((p) => p.key)))} style={{ minHeight: 48, minWidth: 56, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.accent, fontWeight: '700' }}>Alles</Text></Pressable>}
      </View>
      <FlatList
        data={pages} numColumns={cols} key={cols} keyExtractor={(p) => p.key}
        extraData={[sel, ready]} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} columnWrapperStyle={{ gap: 10 }}
        initialNumToRender={9} windowSize={7}
        renderItem={({ item, index }) => (
          <Thumb ref0={item} index={index} size={cell} selected={sel.has(item.key)} src={sources.find((s) => s.id === item.sourceId)} docId={docIds.current.get(item.sourceId)} onPress={() => toggle(item.key)} />
        )}
        ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 40 }}>Nog geen pagina’s. Tik op Toevoegen.</Text>}
      />
      <BottomBar items={sel.size ? [
        { key: 'l', icon: 'arrow-back', label: 'Naar voren', onPress: () => move(-1) },
        { key: 'r', icon: 'arrow-forward', label: 'Naar achter', onPress: () => move(1) },
        { key: 'rot', icon: 'refresh', label: 'Draaien', onPress: rotate },
        { key: 'dup', icon: 'copy-outline', label: 'Kopiëren', onPress: dup },
        { key: 'del', icon: 'trash-outline', label: 'Verwijderen', onPress: remove },
      ] : [
        { key: 'add', icon: 'add-circle-outline', label: 'Toevoegen', onPress: add },
        { key: 'split', icon: 'cut-outline', label: 'Splitsen', onPress: () => setSplitOpen(true), disabled: !pages.length },
      ]} />

      <Sheet visible={splitOpen} onClose={() => setSplitOpen(false)} title="Splitsen">
        <Text style={{ color: t.sub, marginBottom: 10 }}>Er komen nieuwe PDF-bestanden bij Recent. Het origineel blijft ongewijzigd.</Text>
        <Btn label="Elke pagina een eigen PDF" kind="ghost" onPress={splitEach} />
        <View style={{ height: 10 }} />
        <Btn label={`Geselecteerde pagina’s als nieuwe PDF${sel.size ? ` (${sel.size})` : ''}`} kind="ghost" onPress={splitSel} />
        <Text style={{ color: t.text, fontWeight: '700', marginTop: 16, marginBottom: 6 }}>Of op bereik</Text>
        <TextInput value={range} onChangeText={setRange} placeholder={`bv. 1-3, 5 (totaal ${pages.length})`} placeholderTextColor={t.sub} keyboardType="numbers-and-punctuation" accessibilityLabel="Paginabereik"
          style={{ borderWidth: 1.5, borderColor: t.field, borderRadius: 12, padding: 12, fontSize: 17, color: t.text, minHeight: 50 }} />
        <Text style={{ color: t.sub, fontSize: 12, marginTop: 4 }}>Elk bereik wordt een apart bestand.</Text>
        <View style={{ height: 10 }} />
        <Btn label="Splitsen op bereik" onPress={splitRange} />
      </Sheet>
      {busy ? <Busy text={busy} /> : null}
      <Toast text={toast} />
    </View>
  );
}

const Thumb = React.memo(function Thumb({ ref0, index, size, selected, src, docId, onPress }: { ref0: PageRef; index: number; size: number; selected: boolean; src?: Source; docId?: string; onPress: () => void }) {
  const t = useTheme();
  const r = useRenderer();
  const [uri, setUri] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1.414);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (src?.kind === 'pdf' && docId) { const x = await r.render(docId, ref0.pageIndex, 260, { quality: 0.7 }); if (!dead) { setUri(x.uri); setAspect(x.h / x.w); } }
        else if (src) { const i = await normalizeImage(`data:image/${src.kind === 'png' ? 'png' : 'jpeg'};base64,${bytesB64(src.bytes)}`, { maxWidth: 260, quality: 0.7 }).catch(() => null); if (!dead && i) { setUri(`data:image/jpeg;base64,${i.b64}`); setAspect(i.height / i.width); } }
      } catch {}
    })();
    return () => { dead = true; };
  }, [src, docId, ref0.pageIndex, r]);
  const rot = ref0.rotation;
  const sideways = rot === 90 || rot === 270;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Pagina ${index + 1}${selected ? ', geselecteerd' : ''}`} accessibilityState={{ selected }} onPress={onPress} style={{ width: size, marginBottom: 12 }}>
      <View style={{ width: size, height: size * 1.35, borderRadius: 10, backgroundColor: t.card, borderWidth: selected ? 3 : 1, borderColor: selected ? t.accent : t.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {uri ? <Image source={{ uri }} resizeMode="contain" accessibilityIgnoresInvertColors
          style={{ width: sideways ? size * 1.35 - 8 : size - 8, height: sideways ? size - 8 : size * 1.35 - 8, transform: [{ rotate: `${rot}deg` }] }} /> : null}
        {selected ? <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: t.accent, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={16} color={t.onAccent} /></View> : null}
      </View>
      <Text style={{ textAlign: 'center', color: t.sub, fontSize: 12, marginTop: 4 }}>{index + 1}</Text>
    </Pressable>
  );
});
