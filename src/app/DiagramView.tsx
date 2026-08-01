import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { addCmd, removeCmd, updateCmd } from '../history';
import { newId, type DiagramBox, type Point } from '../types';
import { startDragMove } from './dragMove';
import { startDragResize } from './resize';
import { commitActiveEdit, history, select, store, uiState } from './state';
import '@excalidraw/excalidraw/index.css';

// Excalidraw resolves its lazy-loaded fonts against this path; the files are
// copied from the package into public/ so the desktop app works offline.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
}

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
);

export interface SceneData {
  elements: readonly unknown[];
  files: Record<string, unknown>;
}

export function parseScene(scene: string): SceneData {
  try {
    const parsed = JSON.parse(scene) as Partial<SceneData>;
    return { elements: parsed.elements ?? [], files: parsed.files ?? {} };
  } catch {
    return { elements: [], files: {} };
  }
}

/** Exports the scene to SVG markup plus its intrinsic px size. */
async function sceneToSvg(scene: string): Promise<{ svg: string; width: number; height: number }> {
  const { exportToSvg } = await import('@excalidraw/excalidraw');
  const data = parseScene(scene);
  const svg = await exportToSvg({
    elements: data.elements as never[],
    files: data.files as never,
    appState: { exportBackground: false },
  });
  return {
    svg: svg.outerHTML,
    width: parseFloat(svg.getAttribute('width') ?? '1'),
    height: parseFloat(svg.getAttribute('height') ?? '1'),
  };
}

/** Exports the scene to PNG bytes at `scale`x for PDF embedding. */
export async function sceneToPng(
  scene: string,
  scale: number,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  const { exportToBlob } = await import('@excalidraw/excalidraw');
  const data = parseScene(scene);
  let width = 1;
  let height = 1;
  const blob = await exportToBlob({
    elements: data.elements as never[],
    files: data.files as never,
    appState: { exportBackground: false },
    mimeType: 'image/png',
    getDimensions: (w: number, h: number) => {
      width = w;
      height = h;
      return { width: w * scale, height: h * scale, scale };
    },
  });
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}

type ExcalidrawAPI = {
  getSceneElements: () => readonly { isDeleted?: boolean }[];
  getFiles: () => Record<string, unknown>;
};

function DiagramEditorModal({
  initialScene,
  onSave,
  onCancel,
}: {
  initialScene: string;
  onSave: (scene: string | null) => void;
  onCancel: () => void;
}) {
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const initial = useRef(parseScene(initialScene));

  const commit = () => {
    const api = apiRef.current;
    if (!api) return onCancel();
    const elements = api.getSceneElements().filter((el) => !el.isDeleted);
    if (elements.length === 0) return onSave(null); // empty scene evaporates
    onSave(JSON.stringify({ elements, files: api.getFiles() }));
  };

  return (
    <div className="diagram-modal" onPointerDown={(e) => e.stopPropagation()}>
      <div className="diagram-modal-inner">
        <div className="diagram-canvas">
          <Suspense fallback={<div className="diagram-loading">Loading diagram editor…</div>}>
            <Excalidraw
              excalidrawAPI={(api) => {
                apiRef.current = api as unknown as ExcalidrawAPI;
              }}
              initialData={{
                elements: initial.current.elements as never[],
                files: initial.current.files as never,
              }}
            />
          </Suspense>
        </div>
        <div className="diagram-modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={commit}>
            Save diagram
          </button>
        </div>
      </div>
    </div>
  );
}

export function DiagramView({
  d,
  zoom,
  selected,
}: {
  d: DiagramBox;
  zoom: number;
  selected: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [rendered, setRendered] = useState<{ svg: string; width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    void sceneToSvg(d.scene).then((r) => {
      if (alive) setRendered(r);
    });
    return () => {
      alive = false;
    };
  }, [d.scene]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    const tool = uiState.get().tool;
    if (tool === 'eraser') {
      e.preventDefault();
      e.stopPropagation();
      history.exec(removeCmd(store, d));
      return;
    }
    if (tool === 'diagram') {
      e.stopPropagation();
      e.preventDefault();
      commitActiveEdit();
      startDragMove(el, d, e, () => setEditing(true));
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      e.preventDefault();
      commitActiveEdit();
      select(d.id);
      if (e.detail >= 2) setEditing(true);
      else startDragMove(el, d, e);
    }
  };

  // Corner drag adjusts the display scale, keeping the aspect ratio; the
  // scene itself is untouched so re-editing keeps working at any size.
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    const scaleFor = (dx: number) =>
      Math.max(0.1, Math.min(10, (d.scale ?? 1) * ((startW + dx) / startW))) / (d.scale ?? 1);
    startDragResize(e.currentTarget, e, {
      onMove: (dx) => {
        const s = scaleFor(dx);
        el.style.width = `${startW * s}px`;
        el.style.height = `${startH * s}px`;
      },
      onEnd: (dx, _dy, commit) => {
        const s = commit ? scaleFor(dx) : 1;
        el.style.width = `${startW * s}px`;
        el.style.height = `${startH * s}px`;
        const scale = (d.scale ?? 1) * s;
        const cur = store.get(d.id);
        if (commit && cur?.kind === 'diagram' && scale !== (cur.scale ?? 1)) {
          history.exec(updateCmd(store, cur, { ...cur, scale }));
        }
      },
    });
  };

  const scale = d.scale ?? 1;

  return (
    <>
      <div
        ref={rootRef}
        className={`diagrambox${selected ? ' selected' : ''}`}
        data-id={d.id}
        style={{
          left: d.x * zoom,
          top: d.y * zoom,
          width: (rendered?.width ?? 120) * scale * zoom,
          height: (rendered?.height ?? 80) * scale * zoom,
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          if (uiState.get().tool === 'select' && !editing) setEditing(true);
        }}
      >
        {rendered ? (
          // eslint-disable-next-line react/no-danger
          <div className="diagram-render" dangerouslySetInnerHTML={{ __html: rendered.svg }} />
        ) : (
          <div className="diagram-loading">…</div>
        )}
        {selected && (
          <div className="resize-handle se" title="Drag to resize" onPointerDown={onResizeDown} />
        )}
      </div>
      {editing && (
        <DiagramEditorModal
          initialScene={d.scene}
          onCancel={() => setEditing(false)}
          onSave={(scene) => {
            setEditing(false);
            const cur = store.get(d.id);
            if (!cur || cur.kind !== 'diagram') return;
            if (scene === null) {
              history.exec(removeCmd(store, cur));
              select(null);
            } else if (scene !== cur.scene) {
              history.exec(updateCmd(store, cur, { ...cur, scene }));
            }
          }}
        />
      )}
    </>
  );
}

/** Draft diagram: opens the editor immediately; joins the store on Save. */
export function DraftDiagram({
  page,
  at,
  onDone,
}: {
  page: number;
  at: Point;
  onDone: () => void;
}) {
  return (
    <DiagramEditorModal
      initialScene=""
      onCancel={onDone}
      onSave={(scene) => {
        onDone();
        if (scene === null) return;
        history.exec(
          addCmd(store, { id: newId(), kind: 'diagram', page, x: at.x, y: at.y, scene }),
        );
      }}
    />
  );
}
