import { useEffect, useRef, useState } from 'react';
import fontUrl from '../assets/NotoSans-Regular.ttf?url';
import monoFontUrl from '../assets/NotoSansMono-Regular.ttf?url';
import { tokenizeCode } from '../code';
import {
  confirmDiscard,
  guardWindowClose,
  inDesktop,
  onOsFileOpen,
  saveWithDialog,
} from '../desktop';
import { removeCmd } from '../history';
import { colorSvg, texToSvg } from '../math';
import { loadPdf } from '../pdf/render';
import { savePdf, type PageGeom, type RasterAsset } from '../pdf/save';
import type { CodeBlock, DiagramBox, MathBox, TokenLine, Tool } from '../types';
import { sceneToPng } from './DiagramView';
import { svgToPng } from './rasterize';
import { Scroller } from './Scroller';
import { setTool, Toolbar } from './Toolbar';
import {
  history,
  select,
  session,
  showBanner,
  store,
  uiState,
  useSession,
  useUiState,
  viewApi,
} from './state';

let fontBytes: Uint8Array | null = null;
let monoBytes: Uint8Array | null = null;

async function fetchFont(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function openFile(file: File, bumpDocSeq: () => void): Promise<void> {
  if (
    session.get().dirty &&
    store.count > 0 &&
    !(await confirmDiscard('Discard the annotations on the current PDF?'))
  ) {
    return;
  }
  let bytes: Uint8Array;
  let loaded;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    loaded = await loadPdf(bytes);
  } catch (err) {
    const name = (err as Error | undefined)?.name;
    showBanner(
      name === 'PasswordException'
        ? 'This PDF is password-protected — unlock it first, then open it here.'
        : `Couldn't open “${file.name}” as a PDF.`,
    );
    return;
  }

  session.get().loaded?.destroy();
  store.clear();
  history.clear();
  bumpDocSeq();
  select(null);
  uiState.patch({ banner: null });
  session.patch({
    loaded,
    originalBytes: bytes,
    baseName: file.name.replace(/\.pdf$/i, '') || 'document',
    dirty: false,
  });
  uiState.patch({ zoom: viewApi.fitZoom() });
}

async function save(): Promise<void> {
  const { loaded, originalBytes, baseName } = session.get();
  if (!loaded || !originalBytes) return;
  try {
    fontBytes ??= await fetchFont(fontUrl);
    const annotations = store.all();

    // Code blocks flatten as colored vector text: embed the mono font and
    // precompute Shiki token runs here so savePdf stays DOM- and async-free.
    let monoFontBytes: Uint8Array | undefined;
    let codeTokens: Map<string, TokenLine[]> | undefined;
    const codeAnns = annotations.filter((a): a is CodeBlock => a.kind === 'code');
    if (codeAnns.length > 0) {
      monoBytes ??= await fetchFont(monoFontUrl);
      monoFontBytes = monoBytes;
      codeTokens = new Map();
      for (const c of codeAnns) codeTokens.set(c.id, await tokenizeCode(c.code, c.lang));
    }

    // Formulas flatten as high-res rasters of the exact SVG shown on screen.
    let mathImages: Map<string, RasterAsset> | undefined;
    const mathAnns = annotations.filter((a): a is MathBox => a.kind === 'math');
    if (mathAnns.length > 0) {
      mathImages = new Map();
      for (const m of mathAnns) {
        const r = texToSvg(m.tex, m.fontSize);
        mathImages.set(m.id, await svgToPng(colorSvg(r.svg, m.color), r.width, r.height, 4));
      }
    }

    // Diagrams flatten via Excalidraw's own PNG export at 3x of the displayed
    // size, so scaled-up diagrams keep their pixel density (capped for memory).
    let diagramImages: Map<string, RasterAsset> | undefined;
    const diagramAnns = annotations.filter((a): a is DiagramBox => a.kind === 'diagram');
    if (diagramAnns.length > 0) {
      diagramImages = new Map();
      for (const d of diagramAnns) {
        const px = Math.min(8, Math.max(1, 3 * (d.scale ?? 1)));
        diagramImages.set(d.id, await sceneToPng(d.scene, px));
      }
    }

    const pageGeoms: PageGeom[] = loaded.pages.map((p) => ({
      transform: p.transform,
      rotation: p.rotation,
    }));
    const out = await savePdf({
      originalBytes,
      fontBytes,
      annotations,
      pageGeoms,
      monoFontBytes,
      codeTokens,
      mathImages,
      diagramImages,
    });
    if (inDesktop) {
      const saved = await saveWithDialog(out, `${baseName}-annotated.pdf`);
      if (!saved) return; // user cancelled the dialog
    } else {
      const blob = new Blob([out.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}-annotated.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    session.patch({ dirty: false });
  } catch {
    showBanner('Saving failed — your annotations are still here. Try again.');
  }
}

function deleteSelection(): void {
  const id = uiState.get().selectedId;
  if (!id) return;
  const a = store.get(id);
  if (a) history.exec(removeCmd(store, a));
  select(null);
}

export function App() {
  const { banner } = useUiState();
  const { loaded } = useSession();
  const [docSeq, setDocSeq] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const open = (f: File) => void openFile(f, () => setDocSeq((n) => n + 1));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // contenteditable covers CodeMirror; math-field covers MathLive.
      const inField =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        (target?.isContentEditable ?? false) ||
        target?.tagName === 'MATH-FIELD';
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if (inField) return; // native undo/caret behavior while editing
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        select(null);
        return;
      }
      if (!mod) {
        const tools: Record<string, Tool> = {
          v: 'select',
          p: 'pen',
          h: 'highlight',
          t: 'text',
          e: 'eraser',
          c: 'code',
          m: 'math',
          d: 'diagram',
        };
        const t = tools[key];
        if (t) setTool(t);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.add('dragging');
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) document.body.classList.remove('dragging');
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.remove('dragging');
      const f = e.dataTransfer?.files?.[0];
      if (f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) open(f);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.get().dirty && store.count > 0) e.preventDefault();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onOsFileOpen((f) => open(f));
    guardWindowClose(() => session.get().dirty && store.count > 0);
    document.fonts?.load('16px "PackPDF Sans"').catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Toolbar onOpen={() => fileInputRef.current?.click()} onSave={() => void save()} />
      <div className={`banner${banner ? '' : ' hidden'}`}>
        <span>{banner}</span>
        <button title="Dismiss" onClick={() => uiState.patch({ banner: null })}>
          ✕
        </button>
      </div>
      <Scroller
        loaded={loaded}
        docSeq={docSeq}
        onOpenClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) open(f);
        }}
      />
    </>
  );
}
