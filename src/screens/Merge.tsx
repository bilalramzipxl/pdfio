import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { buildCollage, pageCount } from '../engine/pdfOps';
import type { PageRef, Source } from '../engine/types';
import { pickFiles, fmtSize, uid } from '../services/files';
import { showAlert } from '../services/dialog';
import { Btn, Busy, IconBtn, TopBar } from '../ui/components';
import { useTheme } from '../ui/theme';

type Item = Source & { pages: number };

/** Samenvoegen: PDF's (en foto's) achter elkaar in één PDF zetten. Volgorde bepalen met pijltjes. */
export function Merge({ initial, onCancel, onDone, onFine }: { initial: Source[]; onCancel: () => void; onDone: (bytes: Uint8Array, name: string) => void; onFine: (sources: Source[]) => void }) {
  const t = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>('Laden…');
  const fail = (e: unknown) => { setBusy(null); showAlert('Dat lukte niet', e instanceof Error ? e.message : String(e)); };

  const withCounts = async (list: Source[]): Promise<Item[]> => Promise.all(list.map(async (s) => ({ ...s, pages: s.kind === 'pdf' ? await pageCount(s.bytes) : 1 })));
  useEffect(() => { withCounts(initial).then((x) => { setItems(x); setBusy(null); }).catch(fail); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i: number, d: -1 | 1) => setItems((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const add = async () => { try { const f = await pickFiles({ multiple: true, images: true }); if (f.length) { setBusy('Toevoegen…'); setItems((a) => a); const c = await withCounts(f); setItems((a) => [...a, ...c]); setBusy(null); } } catch (e) { fail(e); } };

  const total = items.reduce((n, i) => n + i.pages, 0);
  const merge = async () => {
    if (items.length < 2) { showAlert('Kies minstens twee bestanden', 'Tik op Toevoegen om nog een PDF of foto te kiezen.'); return; }
    try {
      setBusy('Samenvoegen…');
      const pages: PageRef[] = items.flatMap((s) => Array.from({ length: s.pages }, (_, i) => ({ key: uid(), sourceId: s.id, pageIndex: i, rotation: 0 })));
      const out = await buildCollage(items, pages);
      setBusy(null);
      onDone(out, 'Samengevoegd');
    } catch (e) { fail(e); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TopBar title="Samenvoegen" left={<IconBtn icon="close" label="Annuleren" onPress={onCancel} />} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ color: t.sub, marginBottom: 12 }}>De bestanden komen in deze volgorde achter elkaar in één PDF.</Text>
        {items.map((s, i) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 14, marginBottom: 8, padding: 8, borderWidth: 1, borderColor: t.line }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.accent + '22', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}><Text style={{ color: t.accent, fontWeight: '800' }}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{s.name}</Text>
              <Text style={{ color: t.sub, fontSize: 13 }}>{s.pages} pagina{s.pages === 1 ? '' : '’s'} · {fmtSize(s.bytes.length)}</Text>
            </View>
            <IconBtn icon="arrow-up" label={`${s.name} naar boven`} disabled={i === 0} onPress={() => move(i, -1)} />
            <IconBtn icon="arrow-down" label={`${s.name} naar beneden`} disabled={i === items.length - 1} onPress={() => move(i, 1)} />
            <IconBtn icon="close-circle-outline" label={`${s.name} verwijderen`} color={t.danger} onPress={() => setItems((a) => a.filter((x) => x.id !== s.id))} />
          </View>
        ))}
        <Btn label="Toevoegen" icon="add" kind="ghost" onPress={add} style={{ marginTop: 6 }} />
      </ScrollView>
      <View style={{ padding: 16, gap: 8, backgroundColor: t.barBg }}>
        <Btn label={`Samenvoegen${total ? ` (${total} pagina’s)` : ''}`} icon="git-merge-outline" onPress={merge} disabled={items.length < 2} />
        <Btn label="Pagina’s apart bewerken" kind="ghost" onPress={() => onFine(items)} disabled={!items.length} />
      </View>
      {busy ? <Busy text={busy} /> : null}
    </View>
  );
}
