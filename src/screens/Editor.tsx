import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { Annotation, AnnotationMap, FormField, FormValues } from '../engine/types';
import { blankPage, fillForm, flatten, fromRasterPages, listFormFields, optimize, pageSizes } from '../engine/pdfOps';
import { b64ToBytes } from '../engine/base64';
import { useRenderer } from '../services/Renderer';
import { Doc, fmtSize, saveToLibrary, sharePdf, uid } from '../services/files';
import { normalizeImage } from '../services/images';
import { Btn, BottomBar, Busy, IconBtn, Row, Sheet, Toast, TopBar } from '../ui/components';
import { useTheme } from '../ui/theme';
import { showAlert } from '../services/dialog';
import { PageView, Tool } from './PageView';
import { SigData, SignatureSheet } from './SignaturePad';

const COLORS = ['#111111', '#2F6BFF', '#D92D20', '#12A150', '#F59E0B'];
const COLOR_NAMES: Record<string, string> = { '#111111': 'zwart', '#2F6BFF': 'blauw', '#D92D20': 'rood', '#12A150': 'groen', '#F59E0B': 'oranje' };

type Props = { doc: Doc; initialDirty?: boolean; onClose: () => void; onPages: (bytes: Uint8Array, name: string) => void; onDocChange: (d: Doc) => void };

export function Editor({ doc, initialDirty, onClose, onPages, onDocChange }: Props) {
  const t = useTheme();
  const r = useRenderer();
  const { width: winW } = useWindowDimensions();
  const pageW = Math.max(240, Math.min(winW - 24, 900));

  const [bytes, setBytes] = useState(doc.bytes);
  const [docId, setDocId] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [annots, setAnnots] = useState<AnnotationMap>({});
  const [history, setHistory] = useState<AnnotationMap[]>([]);
  const [tool, setTool] = useState<Tool>('hand');
  const [color, setColor] = useState(COLORS[1]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [current, setCurrent] = useState(0);
  const [dirty, setDirty] = useState(!!initialDirty);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'more' | 'sign' | 'form' | 'compress' | 'text'>(null);
  const [name, setName] = useState(doc.name);
  const [textDraft, setTextDraft] = useState<{ page: number; u: number; v: number; id?: string; text: string } | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [compressInfo, setCompressInfo] = useState<string | null>(null);
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const onViewable = useRef(({ viewableItems }: any) => { if (viewableItems[0]) setCurrent(viewableItems[0].index ?? 0); }).current;
  const lastUpdate = useRef({ id: '', at: 0 });
  const liveDoc = useRef<string | null>(null);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);
  const fail = useCallback((e: unknown) => { setBusy(null); showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); }, []);

  useEffect(() => { pageSizes(bytes).then(setSizes).catch(() => {}); }, [bytes]);
  const aspect = () => { const z = sizes[current]; return z ? z.width / z.height : 0.707; }; // breedte/hoogte van de pagina

  // Document in de renderer laden (en bij elke bytes-wijziging opnieuw)
  useEffect(() => {
    let dead = false;
    r.load(bytes).then(({ docId: id, pages: n }) => {
      if (dead) { r.free(id); return; }
      if (liveDoc.current) r.free(liveDoc.current);
      liveDoc.current = id; setDocId(id); setPages(n);
    }).catch(fail);
    return () => { dead = true; };
  }, [bytes, r, fail]);
  useEffect(() => () => { if (liveDoc.current) r.free(liveDoc.current); }, [r]);

  const hasAnnots = Object.values(annots).some((l) => l.length);
  const flat = useCallback(async () => (hasAnnots ? flatten(bytes, annots) : bytes), [bytes, annots, hasAnnots]);

  // Annotaties
  const push = (next: AnnotationMap) => { setHistory((h) => [...h.slice(-30), annots]); setAnnots(next); setDirty(true); };
  const add = (page: number, a: Annotation) => { if (a.kind !== 'ink' && !(Number.isFinite(a.u) && Number.isFinite(a.v))) return; push({ ...annots, [page]: [...(annots[page] ?? []), a] }); if (a.kind !== 'ink') setSelected(a.id); };
  const update = (page: number, a: Annotation) => {
    const next = { ...annots, [page]: (annots[page] ?? []).map((x) => (x.id === a.id ? a : x)) };
    const now = Date.now();
    if (lastUpdate.current.id === a.id && now - lastUpdate.current.at < 900) { setAnnots(next); setDirty(true); }
    else push(next);
    lastUpdate.current = { id: a.id, at: now };
  };
  const find = (id: string | null): { page: number; a: Annotation } | null => {
    if (!id) return null;
    for (const [p, l] of Object.entries(annots)) { const a = l.find((x) => x.id === id); if (a) return { page: Number(p), a }; }
    return null;
  };
  const sel = find(selected);
  const undo = () => { const h = history[history.length - 1]; if (!h) return; setAnnots(h); setHistory(history.slice(0, -1)); setSelected(null); };
  const del = () => { if (!sel) return; push({ ...annots, [sel.page]: annots[sel.page].filter((x) => x.id !== sel.a.id) }); setSelected(null); };
  const scale = (f: number) => {
    if (!sel) return;
    const a = sel.a;
    if (a.kind === 'text') update(sel.page, { ...a, size: Math.min(0.2, Math.max(0.01, a.size * f)) });
    else if (a.kind === 'image' || a.kind === 'signature') {
      const w = Math.min(1, Math.max(0.05, a.w * f)), h = (a.h / a.w) * w;
      update(sel.page, { ...a, w, h, u: Math.min(a.u, 1 - w), v: Math.min(a.v, 1 - h) });
    }
  };

  // Plaatsen
  const placeSignature = (s: SigData) => {
    setSheet(null);
    const w = 0.4, h = Math.min(0.3, w * s.ratio * aspect());
    const u = 0.3, v = 0.4;
    add(current, { id: uid(), kind: 'signature', color: '#111111', u, v, w, h, strokes: s.strokes, width: 0.0035 });
    setTool('hand'); flash('Sleep de handtekening naar de juiste plek');
  };
  const pickImage = async () => {
    setSheet(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (res.canceled) return;
      setBusy('Afbeelding voorbereiden…');
      const img = await normalizeImage(res.assets[0].uri, { maxWidth: 1200, quality: 0.85 });
      const w = 0.4, h = Math.min(0.6, w * (img.height / img.width) * aspect());
      add(current, { id: uid(), kind: 'image', u: 0.3, v: 0.3, w, h, mime: 'image/jpeg', b64: img.b64 });
      setBusy(null); flash('Sleep de afbeelding naar de juiste plek');
    } catch (e) { fail(e); }
  };
  const submitText = () => {
    const d = textDraft; if (!d) return;
    setTextDraft(null); setSheet(null);
    const text = d.text.trim();
    if (!text) return;
    if (d.id) { const f = find(d.id); if (f && f.a.kind === 'text') update(f.page, { ...f.a, text }); }
    else add(d.page, { id: uid(), kind: 'text', color, text, u: d.u, v: d.v, size: 0.035 });
    setTool('hand');
  };

  // Document-bewerkingen op de huidige (platgemaakte) bytes
  const replace = (nb: Uint8Array) => { setBytes(nb); setAnnots({}); setHistory([]); setSelected(null); setDirty(true); };
  const run = async (label: string, fn: (b: Uint8Array) => Promise<Uint8Array>, done?: string) => {
    try { setBusy(label); const nb = await fn(await flat()); replace(nb); setBusy(null); if (done) flash(done); } catch (e) { fail(e); }
  };

  const save = async (silent = false) => {
    try {
      setBusy('Opslaan…');
      const nb = await flat();
      const d = await saveToLibrary(name, nb, doc);
      onDocChange(d); setDirty(false); setBusy(null);
      if (!silent) flash('Opgeslagen in Recent');
      return true;
    } catch (e) { fail(e); return false; }
  };
  const share = async () => {
    try { setBusy('Voorbereiden…'); const nb = await flat(); setBusy(null); await sharePdf(name, nb); } catch (e) { fail(e); }
  };

  const close = useCallback(() => {
    if (!dirty) { onClose(); return true; }
    showAlert('Wijzigingen opslaan?', 'Je hebt aanpassingen gemaakt.', [
      { text: 'Opslaan', onPress: async () => { if (await save(true)) onClose(); } },
      { text: 'Niet opslaan', style: 'destructive', onPress: onClose },
      { text: 'Annuleren', style: 'cancel' },
    ]);
    return true;
  }, [dirty, annots, bytes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const s = BackHandler.addEventListener('hardwareBackPress', () => close()); return () => s.remove(); }, [close]);

  // Formulier
  const openForm = async () => {
    setSheet(null);
    try {
      setBusy('Velden zoeken…');
      const f = await listFormFields(await flat());
      setBusy(null);
      if (!f.length) { showAlert('Geen invulvelden', 'Dit PDF-bestand heeft geen invulbaar formulier. Gebruik "Tekst" om zelf tekst op de pagina te zetten.'); return; }
      setFields(f); setValues(Object.fromEntries(f.map((x) => [x.name, x.value]))); setSheet('form');
    } catch (e) { fail(e); }
  };
  const applyForm = async (flattenForm: boolean) => {
    setSheet(null);
    await run('Formulier invullen…', (b) => fillForm(b, values, flattenForm), 'Formulier ingevuld');
  };

  // Comprimeren
  const doCompress = async (strong: boolean) => {
    setSheet(null);
    try {
      setBusy('Comprimeren…');
      const before = await flat();
      let out: Uint8Array;
      if (strong) {
        const { docId: tmp, pages: n } = await r.load(before);
        const list: { jpg: Uint8Array; widthPt: number; heightPt: number }[] = [];
        for (let i = 0; i < n; i++) {
          const x = await r.render(tmp, i, 1100, { fmt: 'jpeg', quality: 0.6, maxScale: 3 });
          list.push({ jpg: b64ToBytes(x.uri), widthPt: x.wPt, heightPt: x.hPt });
        }
        r.free(tmp);
        out = await fromRasterPages(list);
      } else out = await optimize(before);
      setBusy(null);
      if (out.length >= before.length) { showAlert('Niet kleiner geworden', 'Dit bestand is al zo klein mogelijk.'); return; }
      replace(out);
      flash(`Van ${fmtSize(before.length)} naar ${fmtSize(out.length)}`);
    } catch (e) { fail(e); }
  };

  const tools: { key: Tool; icon: any; label: string }[] = [
    { key: 'hand', icon: 'book-outline', label: 'Lezen' },
    { key: 'pen', icon: 'pencil', label: 'Pen' },
    { key: 'highlight', icon: 'color-fill-outline', label: 'Markeer' },
    { key: 'text', icon: 'text', label: 'Tekst' },
  ];
  const hint = tool === 'pen' ? 'Teken op de pagina' : tool === 'highlight' ? 'Veeg over tekst om te markeren' : tool === 'text' ? 'Tik op de pagina om tekst te plaatsen' : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.page }}>
      <TopBar title={name} left={<IconBtn icon="chevron-back" label="Terug" onPress={close} />}
        right={<>
          <IconBtn icon="arrow-undo" label="Ongedaan maken" onPress={undo} disabled={!history.length} />
          <IconBtn icon="share-outline" label="Delen" onPress={share} />
          <IconBtn icon="save-outline" label="Opslaan" onPress={() => save()} color={dirty ? t.accent : undefined} />
        </>} />
      {docId ? (
        <FlatList
          data={Array.from({ length: pages }, (_, i) => i)} keyExtractor={(i) => `${docId}-${i}`}
          scrollEnabled={!drawing} contentContainerStyle={{ paddingTop: 14, paddingBottom: 30 }}
          initialNumToRender={2} windowSize={5} maxToRenderPerBatch={2} removeClippedSubviews={false}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          renderItem={({ item }) => (
            <PageView docId={docId} index={item} width={pageW} tool={tool} penColor={color} annots={annots[item] ?? []} selectedId={selected}
              onSelect={setSelected} onAdd={add} onUpdate={update} newId={uid} onDrawing={setDrawing}
              onTapText={(page, u, v) => { setSelected(null); setTextDraft({ page, u: Math.min(u, 0.85), v, text: '' }); setSheet('text'); }} />
          )}
        />
      ) : <View style={{ flex: 1 }} />}
      {pages > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 110, right: 14, backgroundColor: '#000A', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }} accessibilityLiveRegion="polite">{current + 1} / {pages}</Text>
        </View>
      ) : null}

      {/* Contextstrook: kleur, of acties voor de geselecteerde annotatie */}
      {sel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: t.barBg, paddingVertical: 4, borderTopWidth: 1, borderColor: t.line }}>
          <IconBtn icon="remove-circle-outline" label="Kleiner" onPress={() => scale(0.85)} />
          <IconBtn icon="add-circle-outline" label="Groter" onPress={() => scale(1.18)} />
          {sel.a.kind === 'text' ? <IconBtn icon="create-outline" label="Tekst bewerken" onPress={() => { setTextDraft({ page: sel.page, u: (sel.a as any).u, v: (sel.a as any).v, id: sel.a.id, text: (sel.a as any).text }); setSheet('text'); }} /> : null}
          <IconBtn icon="trash-outline" label="Verwijderen" color={t.danger} onPress={del} />
          <IconBtn icon="checkmark" label="Klaar met selectie" onPress={() => setSelected(null)} />
        </View>
      ) : (tool === 'pen' || tool === 'text') ? (
        <View style={{ backgroundColor: t.barBg, borderTopWidth: 1, borderColor: t.line }}>
          <Text style={{ textAlign: 'center', color: t.sub, paddingTop: 6 }}>{hint}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 4 }}>
          {COLORS.map((c) => (
            <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Kleur ${COLOR_NAMES[c]}`} accessibilityState={{ selected: color === c }} onPress={() => setColor(c)} hitSlop={6}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c, borderWidth: color === c ? 3 : 1, borderColor: color === c ? t.accent : t.line }} />
          ))}
        </View>
        </View>
      ) : hint ? (
        <View style={{ backgroundColor: t.barBg, paddingVertical: 8, borderTopWidth: 1, borderColor: t.line }}><Text style={{ textAlign: 'center', color: t.sub }}>{hint}</Text></View>
      ) : null}

      <BottomBar items={[
        ...tools.map((x) => ({ key: x.key, icon: x.icon, label: x.label, active: tool === x.key, onPress: () => { setTool(x.key); setSelected(null); } })),
        { key: 'sign', icon: 'create' as any, label: 'Onderteken', onPress: () => setSheet('sign') },
        { key: 'more', icon: 'ellipsis-horizontal-circle-outline' as any, label: 'Meer', onPress: () => setSheet('more') },
      ]} />

      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="Meer">
        <ScrollView>
          <Row icon="image-outline" title="Afbeelding invoegen" sub="Foto of logo op de pagina plaatsen" onPress={pickImage} />
          <Row icon="albums-outline" title="Pagina's beheren" sub="Herordenen, roteren, splitsen" onPress={async () => { setSheet(null); try { setBusy('Voorbereiden…'); const b = await flat(); setBusy(null); onPages(b, name); } catch (e) { fail(e); } }} />
          <Row icon="add-circle-outline" title="Lege pagina toevoegen" sub={`Na pagina ${current + 1}`} onPress={() => { setSheet(null); run('Pagina toevoegen…', (b) => blankPage(b, current), 'Lege pagina toegevoegd'); }} />
          <Row icon="document-text-outline" title="Formulier invullen" sub="Velden in het PDF-formulier" onPress={openForm} />
          <Row icon="contract-outline" title="Comprimeren" sub="Bestand kleiner maken" onPress={() => { setSheet('compress'); setCompressInfo(null); }} />
          <Row icon="share-outline" title="Delen of exporteren" sub="Sturen of bewaren als PDF" onPress={() => { setSheet(null); share(); }} />
        </ScrollView>
      </Sheet>

      <SignatureSheet visible={sheet === 'sign'} onClose={() => setSheet(null)} onPick={placeSignature} />

      <Sheet visible={sheet === 'text'} onClose={() => { setSheet(null); setTextDraft(null); }} title="Tekst">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TextInput autoFocus multiline value={textDraft?.text ?? ''} onChangeText={(x) => setTextDraft((d) => (d ? { ...d, text: x } : d))} placeholder="Typ je tekst" placeholderTextColor={t.sub}
            accessibilityLabel="Tekst"
            style={{ minHeight: 90, borderWidth: 1.5, borderColor: t.field, borderRadius: 12, padding: 12, fontSize: 18, color: t.text, textAlignVertical: 'top' }} />
          <View style={{ height: 12 }} />
          <Btn label="Plaatsen" icon="checkmark" onPress={submitText} disabled={!textDraft?.text.trim()} />
        </KeyboardAvoidingView>
      </Sheet>

      <Sheet visible={sheet === 'compress'} onClose={() => setSheet(null)} title="Comprimeren">
        <Text style={{ color: t.sub, marginBottom: 12 }}>Huidige grootte: {fmtSize(bytes.length)}. Alles gebeurt op je toestel.</Text>
        <Text style={{ color: t.sub, marginBottom: 12, fontSize: 14 }}>"Sterk" maakt het bestand het kleinst, maar daarna kun je de tekst niet meer selecteren of zoeken.</Text>
        <Btn label="Licht (tekst blijft behouden)" kind="ghost" onPress={() => doCompress(false)} />
        <View style={{ height: 10 }} />
        <Btn label="Sterk (kleinste bestand)" onPress={() => doCompress(true)} />
      </Sheet>

      <Sheet visible={sheet === 'form'} onClose={() => setSheet(null)} title="Formulier invullen">
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {fields.map((f) => (
            <View key={f.name} style={{ marginBottom: 12 }}>
              <Text style={{ color: t.sub, fontWeight: '600', marginBottom: 4 }}>{f.name}</Text>
              {f.type === 'text' ? (
                <TextInput value={String(values[f.name] ?? '')} onChangeText={(x) => setValues((v) => ({ ...v, [f.name]: x }))} accessibilityLabel={f.name}
                  style={{ borderWidth: 1.5, borderColor: t.field, borderRadius: 12, padding: 12, fontSize: 17, color: t.text, minHeight: 48 }} />
              ) : f.type === 'check' ? (
                <Pressable accessibilityRole="switch" accessibilityLabel={f.name} accessibilityState={{ checked: !!values[f.name] }} onPress={() => setValues((v) => ({ ...v, [f.name]: !v[f.name] }))}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1.5, borderColor: t.field, borderRadius: 12, paddingHorizontal: 12 }}>
                  <Switch value={!!values[f.name]} onValueChange={(x) => setValues((v) => ({ ...v, [f.name]: x }))} accessibilityLabel={f.name} />
                  <Text style={{ color: t.text, marginLeft: 10, fontSize: 16 }}>{values[f.name] ? 'Aangevinkt' : 'Niet aangevinkt'}</Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {f.options.map((o) => (
                    <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: values[f.name] === o }} onPress={() => setValues((v) => ({ ...v, [f.name]: o }))}
                      style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22, borderWidth: 1.5, borderColor: values[f.name] === o ? t.accent : t.line, backgroundColor: values[f.name] === o ? t.accent + '22' : 'transparent' }}>
                      <Text style={{ color: t.text }}>{o}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
        <Btn label="Invullen" icon="checkmark" onPress={() => applyForm(false)} />
        <View style={{ height: 8 }} />
        <Btn label="Invullen en vastzetten (niet meer te wijzigen)" kind="ghost" onPress={() => applyForm(true)} />
      </Sheet>

      {busy ? <Busy text={busy} /> : null}
      <Toast text={toast} />
    </View>
  );
}
