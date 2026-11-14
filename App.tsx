import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { PDFDocument } from 'pdf-lib';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Source } from './src/engine/types';
import { RendererProvider } from './src/services/Renderer';
import { Doc, saveToLibrary, stripExt, uid } from './src/services/files';
import { ThemeProvider, useTheme } from './src/ui/theme';
import { Home } from './src/screens/Home';
import { Editor } from './src/screens/Editor';
import { Collage } from './src/screens/Collage';
import { Scan } from './src/screens/Scan';
import { Merge } from './src/screens/Merge';

/** Alleen voor controle in een browser: ?demo=editor of ?demo=collage opent meteen voorbeeld-PDF's. */
async function demoPdf(label: string, pages: number, form = false) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([420, 595]);
    p.drawText(`${label} - pagina ${i + 1}`, { x: 40, y: 540, size: 24 });
    p.drawText('Voorbeeldtekst om op te tekenen en te ondertekenen.', { x: 40, y: 500, size: 12 });
    if (form && i === 0) {
      const f = d.getForm();
      f.createTextField('naam').addToPage(p, { x: 40, y: 440, width: 200, height: 24 });
      f.createCheckBox('akkoord').addToPage(p, { x: 40, y: 400, width: 20, height: 20 });
    }
  }
  return d.save();
}

/** Alleen voor controle in een browser: synthetische scheve foto van een blad met schaduw. */
function demoPhoto(): string {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const x = c.getContext('2d')!;
  x.fillStyle = '#4a3a2a'; x.fillRect(0, 0, 1200, 900);
  const Q = [[220, 140], [930, 90], [1010, 780], [160, 700]];
  x.save(); x.beginPath(); Q.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.clip();
  const g = x.createLinearGradient(160, 0, 1010, 0); g.addColorStop(0, '#9a9a9a'); g.addColorStop(1, '#f4f4f0'); x.fillStyle = g; x.fillRect(0, 0, 1200, 900);
  x.fillStyle = '#222'; for (let i = 0; i < 14; i++) x.fillRect(300 + i * 3, 200 + i * 38, 520 - (i % 3) * 80, 10);
  x.restore();
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

type Route =
  | { name: 'home' }
  | { name: 'editor'; doc: Doc; dirty?: boolean; key: string }
  | { name: 'collage'; sources: Source[]; title: string; split?: boolean; back?: Doc }
  | { name: 'scan'; demo?: string[] }
  | { name: 'merge'; sources: Source[] };

function Shell() {
  const t = useTheme();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [homeKey, setHomeKey] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (!demo) return;
    (async () => {
      if (demo === 'editor') setRoute({ name: 'editor', key: uid(), doc: { id: 'demo', name: 'Voorbeeld', uri: 'web:demo', bytes: await demoPdf('Voorbeeld', 3, true) } });
      if (demo === 'merge') setRoute({ name: 'merge', sources: [
        { id: 'a', name: 'A.pdf', kind: 'pdf', bytes: await demoPdf('A', 2) }, { id: 'b', name: 'B.pdf', kind: 'pdf', bytes: await demoPdf('B', 3) }] });
      if (demo === 'scan') setRoute({ name: 'scan', demo: [demoPhoto()] });
      if (demo === 'collage') setRoute({ name: 'collage', title: 'Collage', sources: [
        { id: 'a', name: 'A.pdf', kind: 'pdf', bytes: await demoPdf('A', 2) }, { id: 'b', name: 'B.pdf', kind: 'pdf', bytes: await demoPdf('B', 2) }] });
    })();
  }, []);

  const home = useCallback(() => { setHomeKey((k) => k + 1); setRoute({ name: 'home' }); }, []);
  useEffect(() => {
    const s = BackHandler.addEventListener('hardwareBackPress', () => { if (route.name === 'home') return false; home(); return true; });
    return () => s.remove();
  }, [route.name, home]);

  /** Nieuw document uit een collage/scan: bewaren in de bibliotheek en openen in de editor. */
  const openNew = async (bytes: Uint8Array, name: string) => {
    const d = await saveToLibrary(name, bytes);
    setRoute({ name: 'editor', doc: d, key: uid() });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {route.name === 'home' ? (
        <Home key={homeKey}
          onOpenDoc={(doc) => setRoute({ name: 'editor', doc, key: uid() })}
          onCollage={(sources, title, split) => setRoute({ name: 'collage', sources, title, split })}
          onMerge={(sources) => setRoute({ name: 'merge', sources })}
          onScan={() => setRoute({ name: 'scan' })} />
      ) : route.name === 'editor' ? (
        <Editor key={route.key} doc={route.doc} initialDirty={route.dirty} onClose={home}
          onDocChange={(d) => setRoute((r) => (r.name === 'editor' ? { ...r, doc: d } : r))}
          onPages={(bytes, name) => setRoute({ name: 'collage', sources: [{ id: uid(), name: name + '.pdf', kind: 'pdf', bytes }], title: name, back: route.doc })} />
      ) : route.name === 'collage' ? (
        <Collage initialSources={route.sources} title={route.title} openSplit={route.split} doneLabel={route.back ? 'Toepassen' : 'Klaar'}
          onCancel={() => (route.back ? setRoute({ name: 'editor', doc: { ...route.back, bytes: route.sources[0].bytes }, dirty: true, key: uid() }) : home())}
          onDone={async (bytes, name) => {
            if (route.back) setRoute({ name: 'editor', doc: { ...route.back, bytes }, dirty: true, key: uid() });
            else await openNew(bytes, stripExt(name));
          }} />
      ) : (
        route.name === 'scan' ? <Scan onCancel={home} onDone={(b, n) => openNew(b, n)} demoPhotos={route.demo} />
        : <Merge initial={route.sources} onCancel={home} onDone={(b, n) => openNew(b, n)} onFine={(items) => setRoute({ name: 'collage', sources: items, title: 'Samengevoegd' })} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RendererProvider>
          <Shell />
        </RendererProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
