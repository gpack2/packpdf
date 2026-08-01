import { useEffect, useLayoutEffect, useRef } from 'react';
import { addCmd, removeCmd, updateCmd } from '../history';
import { LINE_HEIGHT_FACTOR, newId, type Point, type TextBox } from '../types';
import { startDragMove } from './dragMove';
import { startDragResize } from './resize';
import { commitActiveEdit, history, select, store, uiState } from './state';

/** Narrowest wrap width a resize can set, in page units. */
const MIN_TEXT_WIDTH = 24;

/**
 * Sizes the textarea to its content. With `widthPx` the width is fixed (text
 * wraps inside it) and only the height follows the content.
 */
export function autosize(el: HTMLTextAreaElement, widthPx?: number): void {
  if (widthPx !== undefined) {
    el.style.width = `${widthPx}px`;
  } else {
    el.style.width = '0px';
  }
  el.style.height = '0px';
  if (widthPx === undefined) el.style.width = `${el.scrollWidth + 4}px`;
  el.style.height = `${el.scrollHeight}px`;
}

export function TextBoxView({
  t,
  zoom,
  selected,
}: {
  t: TextBox;
  zoom: number;
  selected: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  // The editing session is DOM-local state (readOnly flag + snapshot for
  // one-coalesced-undo), exactly like the pre-React implementation.
  const snapshot = useRef<string | null>(null);

  const widthPx = t.width !== undefined ? t.width * zoom : undefined;

  // Keep value/size in sync with the store unless the box is being edited.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.value !== t.text) el.value = t.text;
    autosize(el, widthPx);
  }, [t.text, t.fontSize, t.width, widthPx, zoom]);

  const beginEdit = () => {
    const el = ref.current;
    if (!el) return;
    snapshot.current = t.text;
    el.readOnly = false;
    el.classList.add('editing');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLTextAreaElement>) => {
    const el = ref.current;
    const wrap = wrapRef.current;
    if (!el || !wrap || e.button !== 0) return;
    const tool = uiState.get().tool;
    if (tool === 'eraser') {
      e.preventDefault();
      e.stopPropagation();
      history.exec(removeCmd(store, t));
      return;
    }
    if (tool === 'text') {
      e.stopPropagation();
      if (el.readOnly) {
        // Drag moves the box; a motionless click opens it for editing.
        e.preventDefault();
        commitActiveEdit();
        startDragMove(wrap, t, e, beginEdit);
      }
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      if (!el.readOnly) return; // editing: native caret/selection behavior
      e.preventDefault();
      commitActiveEdit();
      select(t.id);
      if (e.detail >= 2) beginEdit();
      else startDragMove(wrap, t, e);
    }
  };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const z = uiState.get().zoom;
    const startW = el.offsetWidth;
    const clampPx = (w: number) => Math.max(MIN_TEXT_WIDTH * z, w);
    // Wrap live during the drag; React reconciles these on the commit render,
    // and the cancel path restores them for a still-unwrapped box.
    el.wrap = 'soft';
    el.style.whiteSpace = 'pre-wrap';
    startDragResize(e.currentTarget, e, {
      onMove: (dx) => autosize(el, clampPx(startW + dx)),
      onEnd: (dx, _dy, commit) => {
        const w = clampPx(startW + dx) / z;
        const cur = store.get(t.id);
        if (commit && cur?.kind === 'text' && w !== cur.width) {
          history.exec(updateCmd(store, cur, { ...cur, width: w }));
        } else {
          const keepWidth = cur?.kind === 'text' ? cur.width : t.width;
          if (keepWidth === undefined) {
            el.wrap = 'off';
            el.style.whiteSpace = 'pre';
          }
          autosize(el, keepWidth !== undefined ? keepWidth * z : undefined);
        }
      },
    });
  };

  return (
    <div ref={wrapRef} className="textbox-wrap" style={{ left: t.x * zoom, top: t.y * zoom }}>
      <textarea
        ref={ref}
        className={`textbox${selected ? ' selected' : ''}`}
        data-id={t.id}
        wrap={t.width !== undefined ? 'soft' : 'off'}
        spellCheck={false}
        rows={1}
        readOnly
        defaultValue={t.text}
        style={{
          fontSize: t.fontSize * zoom,
          color: t.color,
          caretColor: t.color,
          whiteSpace: t.width !== undefined ? 'pre-wrap' : 'pre',
        }}
        onInput={(e) => autosize(e.currentTarget, widthPx)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            ref.current?.blur();
          }
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          if (uiState.get().tool === 'select' && ref.current?.readOnly) beginEdit();
        }}
        onBlur={() => {
          const el = ref.current;
          if (!el || el.readOnly) return; // not in an editing session
          el.readOnly = true;
          el.classList.remove('editing');
          const value = el.value;
          if (value.trim() === '') {
            history.exec(removeCmd(store, t));
            select(null);
          } else if (snapshot.current !== null && value !== snapshot.current) {
            // One coalesced undo entry per editing session.
            history.exec(updateCmd(store, t, { ...t, text: value }));
          }
          snapshot.current = null;
        }}
      />
      {selected && (
        <div
          className="resize-handle e"
          title="Drag to set text width"
          onPointerDown={onResizeDown}
        />
      )}
    </div>
  );
}

/**
 * A draft textbox lives only in the DOM; it joins the store (as a single
 * undoable add) on blur when non-empty, and evaporates when left empty.
 * `at` is the click point, anchored at the vertical center of the first line.
 */
export function DraftTextBox({
  page,
  at,
  onDone,
}: {
  page: number;
  at: Point;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { zoom, color, fontSize } = uiState.get();
  const pos = useRef({ x: at.x, y: at.y - (LINE_HEIGHT_FACTOR * fontSize) / 2 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    autosize(el);
    el.focus();
  }, []);

  return (
    <div
      className="textbox-wrap"
      style={{ left: pos.current.x * zoom, top: pos.current.y * zoom }}
    >
      <textarea
        ref={ref}
        className="textbox editing draft"
        wrap="off"
        spellCheck={false}
        rows={1}
        style={{
          fontSize: fontSize * zoom,
          color,
          caretColor: color,
        }}
        onInput={(e) => autosize(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            ref.current?.blur();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => {
          const value = ref.current?.value ?? '';
          onDone();
          if (value.trim() === '') return;
          history.exec(
            addCmd(store, {
              id: newId(),
              kind: 'text',
              page,
              x: pos.current.x,
              y: pos.current.y,
              text: value,
              color,
              fontSize,
            }),
          );
        }}
      />
    </div>
  );
}
