import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { bytesToB64 } from '../engine/base64';
import { RENDERER_HTML } from './rendererHtml';

export type Rendered = { uri: string; w: number; h: number; wPt: number; hPt: number };
export type RenderApi = {
  load(bytes: Uint8Array): Promise<{ docId: string; pages: number }>;
  render(docId: string, page: number, maxWidth: number, opts?: { fmt?: 'png' | 'jpeg'; quality?: number; maxScale?: number }): Promise<Rendered>;
  free(docId: string): void;
  /** Zoekt de hoeken van het papier in een foto (genormaliseerd, TL TR BR BL). */
  detect(b64: string): Promise<Corner[]>;
  /** Rechtzetten + opschonen van een foto tot een documentscan (JPEG). */
  scan(b64: string, o: { corners?: Corner[]; mode: ScanMode; shadow?: boolean; maxSide?: number; quality?: number; fmt?: 'jpeg' | 'png' }): Promise<{ uri: string; w: number; h: number }>;
  /** Kiest de beste bewerking voor een foto (stand, schaduw, draaien) met uitleg in gewone taal. */
  suggest(b64: string, o: { corners?: Corner[] }): Promise<ScanSuggestion>;
};
export type Corner = { x: number; y: number };
export type ScanMode = 'document' | 'gray' | 'color' | 'original';
export type ScanSuggestion = { mode: ScanMode; shadow: boolean; rotate: 0 | 90; notes: string[]; found: boolean };

const WV = WebView as unknown as React.ComponentType<any>;
const Ctx = createContext<RenderApi | null>(null);
export const useRenderer = () => {
  const r = useContext(Ctx);
  if (!r) throw new Error('RendererProvider ontbreekt');
  return r;
};

/** Verborgen WebView met pdf.js (lokaal ingebakken). Alle PDF-pagina's worden op het toestel gerenderd. */
export function RendererProvider({ children }: { children: React.ReactNode }) {
  const web = useRef<any>(null);
  const ready = useRef<Promise<void>>(null as any);
  const readyResolve = useRef<() => void>(() => {});
  if (!ready.current) ready.current = new Promise<void>((r) => { readyResolve.current = r; });
  const pending = useRef(new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>());
  const seq = useRef(1);

  const send = useCallback(async (msg: Record<string, unknown>) => {
    await ready.current;
    const id = seq.current++;
    return new Promise<any>((res, rej) => {
      pending.current.set(id, { res, rej });
      web.current?.injectJavaScript(`window.handle(${JSON.stringify({ ...msg, id })});true;`);
    });
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.ready) { readyResolve.current(); return; }
    const p = pending.current.get(m.id);
    if (!p) return;
    pending.current.delete(m.id);
    if (m.ok) p.res(m); else p.rej(new Error(m.error || 'Renderen mislukt'));
  }, []);

  const api = useMemo<RenderApi>(() => ({
    async load(bytes) {
      const docId = `d${seq.current++}`;
      const r = await send({ op: 'load', docId, b64: bytesToB64(bytes) });
      return { docId, pages: r.pages };
    },
    async render(docId, page, maxWidth, opts) {
      const r = await send({ op: 'render', docId, page, maxWidth, fmt: opts?.fmt ?? 'jpeg', quality: opts?.quality ?? 0.85, maxScale: opts?.maxScale });
      return { uri: r.dataUrl, w: r.w, h: r.h, wPt: r.wPt, hPt: r.hPt };
    },
    free(docId) { send({ op: 'free', docId }).catch(() => {}); },
    async detect(b64) { const r = await send({ op: 'detect', b64 }); return r.corners; },
    async scan(b64, o) { const r = await send({ op: 'scan', b64, ...o }); return { uri: r.dataUrl, w: r.w, h: r.h }; },
    async suggest(b64, o) { const r = await send({ op: 'suggest', b64, ...o }); return { mode: r.mode, shadow: r.shadow, rotate: r.rotate, notes: r.notes, found: r.found }; },
  }), [send]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <WV ref={web} originWhitelist={['*']} source={{ html: RENDERER_HTML }} onMessage={onMessage} javaScriptEnabled
        allowFileAccess={false} allowUniversalAccessFromFileURLs={false} setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(r: { url: string }) => r.url === 'about:blank' || r.url.startsWith('data:') || r.url.startsWith('blob:')}
        style={{ position: 'absolute', width: 2, height: 2, opacity: 0.01, left: 0, top: 0 }} pointerEvents="none" importantForAccessibility="no-hide-descendants" />
    </Ctx.Provider>
  );
}
