import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Source } from '../engine/types';
import { Doc, Recent, fmtSize, loadRecents, openRecent, pickFiles, removeRecent, renameRecent, saveToLibrary, sharePdf } from '../services/files';
import { Btn, BottomBar, Busy, IconName, Row, Sheet, TopBar } from '../ui/components';
import { useTheme } from '../ui/theme';
import { showAlert } from '../services/dialog';

type Props = {
  onOpenDoc: (d: Doc) => void;
  onCollage: (sources: Source[], title: string, split?: boolean) => void;
  onMerge: (sources: Source[]) => void;
  onScan: () => void;
};

const dateStr = (ms: number) => new Date(ms).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });

export function Home({ onOpenDoc, onCollage, onMerge, onScan }: Props) {
  const t = useTheme();
  const [tab, setTab] = useState<'start' | 'tools'>('start');
  const [recents, setRecents] = useState<Recent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<Recent | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const refresh = useCallback(() => { loadRecents().then(setRecents); }, []);
  useEffect(refresh, [refresh]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    try { setBusy(label); await fn(); } catch (e) { showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const openPdf = () => guard('Openen…', async () => {
    const [s] = await pickFiles();
    if (!s) return;
    onOpenDoc(await saveToLibrary(s.name.replace(/\.pdf$/i, ''), s.bytes));
  });
  const merge = () => guard('Laden…', async () => { const f = await pickFiles({ multiple: true, images: true }); if (f.length) onMerge(f); });
  const imagesToPdf = () => guard('Laden…', async () => { const f = await pickFiles({ multiple: true, images: true, pdf: false }); if (f.length) onCollage(f, 'Foto’s'); });
  const split = () => guard('Laden…', async () => { const f = await pickFiles(); if (f.length) onCollage(f, f[0].name.replace(/\.pdf$/i, ''), true); });
  const openR = (r: Recent) => guard('Openen…', async () => onOpenDoc(await openRecent(r)));

  const tools: { icon: IconName; title: string; sub: string; run: () => void }[] = [
    { icon: 'document-outline', title: 'PDF openen en bewerken', sub: 'Tekenen, markeren, tekst, handtekening, formulieren', run: openPdf },
    { icon: 'camera-outline', title: 'Scannen naar PDF', sub: 'Pagina’s fotograferen met de camera', run: onScan },
    { icon: 'git-merge-outline', title: 'Samenvoegen', sub: 'PDF’s achter elkaar in één PDF zetten', run: merge },
    { icon: 'images-outline', title: 'Foto’s naar PDF', sub: 'Afbeeldingen omzetten', run: imagesToPdf },
    { icon: 'cut-outline', title: 'PDF splitsen', sub: 'In delen of per pagina', run: split },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar title={tab === 'start' ? 'PDF Studio' : 'Hulpmiddelen'} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {tab === 'start' ? (
          <>
            <Btn label="PDF openen" icon="folder-open-outline" onPress={openPdf} style={{ minHeight: 60 }} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Btn label="Scannen" icon="camera-outline" kind="ghost" onPress={onScan} style={{ flex: 1 }} />
              <Btn label="Samenvoegen" icon="git-merge-outline" kind="ghost" onPress={merge} style={{ flex: 1.2 }} />
            </View>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '800', marginTop: 26, marginBottom: 10 }}>Recent</Text>
            {recents.length === 0 ? (
              <View style={{ alignItems: 'center', padding: 30 }}>
                <Ionicons name="documents-outline" size={46} color={t.sub} />
                <Text style={{ color: t.sub, marginTop: 10, textAlign: 'center' }}>Nog niets geopend. Alles blijft op je toestel.</Text>
              </View>
            ) : recents.map((r) => <Row key={r.id} icon="document-text-outline" title={r.name} sub={`${fmtSize(r.size)} · ${dateStr(r.modified)}`} onPress={() => openR(r)} onMore={() => setMenu(r)} />)}
          </>
        ) : tools.map((x) => <Row key={x.title} icon={x.icon} title={x.title} sub={x.sub} onPress={x.run} />)}
      </ScrollView>
      <BottomBar items={[
        { key: 'start', icon: 'home-outline', label: 'Start', active: tab === 'start', onPress: () => setTab('start') },
        { key: 'scan', icon: 'camera', label: 'Scannen', onPress: onScan },
        { key: 'tools', icon: 'apps-outline', label: 'Tools', active: tab === 'tools', onPress: () => setTab('tools') },
      ]} />

      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.name ?? ''}>
        <Row icon="open-outline" title="Openen" onPress={() => { const r = menu!; setMenu(null); openR(r); }} />
        <Row icon="share-outline" title="Delen" onPress={() => { const r = menu!; setMenu(null); guard('Voorbereiden…', async () => { const d = await openRecent(r); await sharePdf(d.name, d.bytes); }); }} />
        <Row icon="pencil-outline" title="Naam wijzigen" onPress={() => { setRenaming(menu!.name); }} />
        <Row icon="trash-outline" title="Verwijderen van dit toestel" onPress={() => {
          const r = menu!; setMenu(null);
          showAlert('Verwijderen?', `"${r.name}" wordt van dit toestel verwijderd. Je originele bestand blijft bestaan.`, [
            { text: 'Annuleren', style: 'cancel' },
            { text: 'Verwijderen', style: 'destructive', onPress: async () => { await removeRecent(r); refresh(); } },
          ]);
        }} />
      </Sheet>
      <Sheet visible={renaming !== null} onClose={() => setRenaming(null)} title="Naam wijzigen">
        <TextInput autoFocus value={renaming ?? ''} onChangeText={setRenaming} accessibilityLabel="Nieuwe naam"
          style={{ borderWidth: 1.5, borderColor: t.field, borderRadius: 12, padding: 12, fontSize: 18, color: t.text, minHeight: 52 }} />
        <View style={{ height: 12 }} />
        <Btn label="Opslaan" disabled={!renaming?.trim()} onPress={async () => { const r = menu!; await renameRecent(r, renaming!.trim()); setRenaming(null); setMenu(null); refresh(); }} />
      </Sheet>
      {busy ? <Busy text={busy} /> : null}
    </View>
  );
}
