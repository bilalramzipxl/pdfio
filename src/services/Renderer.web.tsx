import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { bytesToB64 } from '../engine/base64';
import { RENDERER_HTML } from './rendererHtml';
import type { RenderApi } from './Renderer';

export type { Rendered, RenderApi } from './Renderer';
const Ctx = createContext<RenderApi | null>(null);
export const useRenderer = () => {
  const r = useContext(Ctx);
  if (!r) throw new Error('RendererProvider ontbreekt');
  return r;
};

/** Webvariant (alleen voor controle in een browser): verborgen iframe met dezelfde pdf.js-pagina. */
export function RendererProvider({ children }: { children: React.ReactNode }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef(new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>());
  const seq = useRef(1);
  const readyP = useRef<Promise<void>>(null as any);
  const readyRes = useRef<() => void>(() => {});
  if (!readyP.current) readyP.current = new Promise<void>((r) => { readyRes.current = r; });

  useEffect(() => {
    const f = document.createElement('iframe');
    f.srcdoc = RENDERER_HTML;
    f.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;border:0;left:0;top:0;pointer-events:none';
    f.setAttribute('aria-hidden', 'true');
    document.body.appendChild(f);
    frame.current = f;
    const onMsg = (e: MessageEvent) => {
      const m = e.data?.pdfRenderer;
      if (!m) return;
      if (m.ready) { readyRes.current(); return; }
      const p = pending.current.get(m.id);
      if (!p) return;
      pending.current.delete(m.id);
      if (m.ok) p.res(m); else p.rej(new Error(m.error || 'Renderen mislukt'));
    };
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); f.remove(); };
  }, []);

  const send = async (msg: Record<string, unknown>) => {
    await readyP.current;
    const id = seq.current++;
    return new Promise<any>((res, rej) => {
      pending.current.set(id, { res, rej });
      (frame.current!.contentWindow as any).handle({ ...msg, id });
    });
  };

  const api = useMemo<RenderApi>(() => ({
    async load(bytes) { const docId = `d${seq.current++}`; const r = await send({ op: 'load', docId, b64: bytesToB64(bytes) }); return { docId, pages: r.pages }; },
    async render(docId, page, maxWidth, opts) {
      const r = await send({ op: 'render', docId, page, maxWidth, fmt: opts?.fmt ?? 'jpeg', quality: opts?.quality ?? 0.85, maxScale: opts?.maxScale });
      return { uri: r.dataUrl, w: r.w, h: r.h, wPt: r.wPt, hPt: r.hPt };
    },
    free(docId) { send({ op: 'free', docId }).catch(() => {}); },
    async detect(b64) { const r = await send({ op: 'detect', b64 }); return r.corners; },
    async scan(b64, o) { const r = await send({ op: 'scan', b64, ...o }); return { uri: r.dataUrl, w: r.w, h: r.h }; },
    async suggest(b64, o) { const r = await send({ op: 'suggest', b64, ...o }); return { mode: r.mode, shadow: r.shadow, rotate: r.rotate, notes: r.notes, found: r.found }; },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
