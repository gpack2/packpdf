import { MathfieldElement } from 'mathlive';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addCmd, removeCmd, updateCmd } from '../history';
import { colorSvg, texToSvg } from '../math';
import { MATH_FONT_SIZE, newId, type MathBox, type Point } from '../types';
import { startDragMove } from './dragMove';
import { commitActiveEdit, history, select, store, uiState } from './state';

// Self-hosted assets so the desktop app works offline; no sounds.
MathfieldElement.fontsDirectory = '/mathlive/fonts';
MathfieldElement.soundsDirectory = null;

function MathFieldEditor({
  initial,
  fontSizePx,
  onCommit,
}: {
  initial: string;
  fontSizePx: number;
  onCommit: (tex: string) => void;
}) {
  const ref = useRef<MathfieldElement>(null);

  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    mf.value = initial;
    const commit = () => onCommit(mf.value);
    mf.addEventListener('focusout', commit);
    mf.focus();
    return () => mf.removeEventListener('focusout', commit);
    // The editing session captures its starting value once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <math-field
      ref={ref}
      style={{ fontSize: fontSizePx }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          ref.current?.blur();
        }
      }}
    />
  );
}

export function MathBoxView({
  m,
  zoom,
  selected,
}: {
  m: MathBox;
  zoom: number;
  selected: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  const rendered = useMemo(() => texToSvg(m.tex, m.fontSize), [m.tex, m.fontSize]);

  const commit = (tex: string) => {
    setEditing(false);
    const cur = store.get(m.id);
    if (!cur || cur.kind !== 'math') return;
    if (tex.trim() === '') {
      history.exec(removeCmd(store, cur));
      select(null);
    } else if (tex !== cur.tex) {
      history.exec(updateCmd(store, cur, { ...cur, tex }));
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    if (editing) {
      e.stopPropagation();
      return;
    }
    const tool = uiState.get().tool;
    if (tool === 'eraser') {
      e.preventDefault();
      e.stopPropagation();
      history.exec(removeCmd(store, m));
      return;
    }
    if (tool === 'math') {
      e.stopPropagation();
      e.preventDefault();
      commitActiveEdit();
      startDragMove(el, m, e, () => setEditing(true));
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      e.preventDefault();
      commitActiveEdit();
      select(m.id);
      if (e.detail >= 2) setEditing(true);
      else startDragMove(el, m, e);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`mathbox${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      data-id={m.id}
      style={{
        left: m.x * zoom,
        top: m.y * zoom,
        color: m.color,
        ...(editing ? {} : { width: rendered.width * zoom }),
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (uiState.get().tool === 'select' && !editing) setEditing(true);
      }}
    >
      {editing ? (
        <MathFieldEditor initial={m.tex} fontSizePx={m.fontSize * zoom} onCommit={commit} />
      ) : (
        <div
          className="math-render"
          title={rendered.error ?? undefined}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: rendered.svg }}
        />
      )}
    </div>
  );
}

/** Draft math box: joins the store only when committed with content. */
export function DraftMathBox({
  page,
  at,
  onDone,
}: {
  page: number;
  at: Point;
  onDone: () => void;
}) {
  const state = uiState.get();
  return (
    <div
      className="mathbox editing draft"
      style={{ left: at.x * state.zoom, top: at.y * state.zoom, color: state.color }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <MathFieldEditor
        initial=""
        fontSizePx={MATH_FONT_SIZE * state.zoom}
        onCommit={(tex) => {
          onDone();
          if (tex.trim() === '') return;
          history.exec(
            addCmd(store, {
              id: newId(),
              kind: 'math',
              page,
              x: at.x,
              y: at.y,
              tex,
              fontSize: MATH_FONT_SIZE,
              color: state.color,
            }),
          );
        }}
      />
    </div>
  );
}
