/** Alle coördinaten van annotaties zijn fracties (0..1) van de WEERGEGEVEN pagina, linksboven = (0,0). */
export type Pt = { u: number; v: number };

export type Annotation =
  | { id: string; kind: 'ink'; color: string; width: number; opacity: number; points: Pt[] } // width = fractie van paginabreedte
  | { id: string; kind: 'text'; color: string; text: string; u: number; v: number; size: number } // size = fractie van paginabreedte
  | { id: string; kind: 'signature'; color: string; u: number; v: number; w: number; h: number; strokes: Pt[][]; width: number } // strokes in 0..1 van de handtekeningbox
  | { id: string; kind: 'image'; u: number; v: number; w: number; h: number; mime: 'image/png' | 'image/jpeg'; b64: string };

export type AnnotationMap = Record<number, Annotation[]>; // per paginanummer (0-gebaseerd)

export type SourceKind = 'pdf' | 'png' | 'jpg';
export type Source = { id: string; name: string; kind: SourceKind; bytes: Uint8Array };
/** Eén pagina in een collage: verwijst naar een bron (PDF-pagina of afbeelding). */
export type PageRef = { key: string; sourceId: string; pageIndex: number; rotation: number }; // rotation = extra graden (0/90/180/270)

export type FormField =
  | { name: string; type: 'text'; value: string }
  | { name: string; type: 'check'; value: boolean }
  | { name: string; type: 'choice'; value: string; options: string[] };
export type FormValues = Record<string, string | boolean>;
