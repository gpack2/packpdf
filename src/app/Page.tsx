import { useEffect, useRef, useState } from 'react';
import { eraserHits, strokePathD, thinPoints } from '../geometry';
import { addCmd, removeCmd } from '../history';
import { renderPage, type PageInfo, type RenderHandle } from '../pdf/render';
import {
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_WIDTH,
  newId,
  type CodeBlock,
  type MathBox,
  type Point,
  type Stroke,
  type TextBox,
} from '../types';
import { CodeBlockView, DraftCodeBlock } from './CodeBlockView';
import { DraftMathBox, MathBoxView } from './MathBoxView';
import { history, select, store, uiState, useStoreVersion, useUiState } from './state';
import { DraftTextBox, TextBoxView } from './TextBoxView';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Eraser hit radius in screen pixels (converted to page units per zoom). */
const ERASER_RADIUS = 6;

/** Cancels and restarts pdf.js canvas renders as the target zoom moves. */
class CanvasRenderer {
  private renderedZoom = 0;
  private inflightZoom = 0;
  private handle: RenderHandle | null = null;

  constructor(private info: PageInfo) {}

  render(canvas: HTMLCanvasElement, zoom: number): void {
    if (this.renderedZoom === zoom || (this.handle && this.inflightZoom === zoom)) return;
    this.handle?.cancel();
    this.inflightZoom = zoom;
    const handle = renderPage(this.info, canvas, zoom);
    this.handle = handle;
    void handle.done.then(() => {
      if (this.handle === handle) {
        this.handle = null;
        this.renderedZoom = zoom;
      }
    });
  }

  destroy(): void {
    this.handle?.cancel();
  }
}

function toPagePoint(
  el: HTMLElement,
  e: { clientX: number; clientY: number },
  zoom: number,
  rect?: DOMRect,
): Point {
  const r = rect ?? el.getBoundingClientRect();
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}

function trackPointer(
  el: HTMLElement,
  e: React.PointerEvent,
  onMove: (ev: PointerEvent) => void,
  onEnd: (commit: boolean) => void,
): void {
  el.setPointerCapture(e.pointerId);
  const finish = (commit: boolean) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    onEnd(commit);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
}

/** Draws the live stroke imperatively inside a React-untouched <g>. */
function startStroke(pageEl: HTMLDivElement, liveGroup: SVGGElement, e: React.PointerEvent, page: number): void {
  e.preventDefault();
  const { tool, color: penColor, highlightColor, penWidth, zoom } = uiState.get();
  const rect = pageEl.getBoundingClientRect();
  const raw: Point[] = [toPagePoint(pageEl, e, zoom, rect)];
  const highlight = tool === 'highlight';
  const color = highlight ? highlightColor : penColor;
  const width = highlight ? HIGHLIGHT_WIDTH : penWidth;
  const opacity = highlight ? HIGHLIGHT_OPACITY : undefined;

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', String(width));
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  if (opacity !== undefined) {
    path.setAttribute('stroke-opacity', String(opacity));
    path.style.mixBlendMode = 'multiply';
  }
  path.setAttribute('d', strokePathD(raw));
  liveGroup.append(path);

  let rafId = 0;
  const flush = () => {
    rafId = 0;
    path.setAttribute('d', strokePathD(raw));
  };
  trackPointer(
    pageEl,
    e,
    (ev) => {
      const events = ev.getCoalescedEvents?.() ?? [ev];
      for (const ce of events) raw.push(toPagePoint(pageEl, ce, zoom, rect));
      if (!rafId) rafId = requestAnimationFrame(flush);
    },
    (commit) => {
      if (rafId) cancelAnimationFrame(rafId);
      path.remove();
      if (!commit) return;
      history.exec(
        addCmd(store, {
          id: newId(),
          kind: 'stroke',
          page,
          points: thinPoints(raw, 1.5),
          color,
          width,
          ...(opacity !== undefined ? { opacity } : {}),
        }),
      );
    },
  );
}

function startErase(pageEl: HTMLDivElement, e: React.PointerEvent, page: number): void {
  e.preventDefault();
  const zoom = uiState.get().zoom;
  const rect = pageEl.getBoundingClientRect();
  let prev = toPagePoint(pageEl, e, zoom, rect);
  const eraseAlong = (from: Point, to: Point) => {
    for (const a of store.pageAnnotations(page)) {
      if (a.kind !== 'stroke') continue;
      if (eraserHits(a.points, from, to, ERASER_RADIUS / zoom + a.width / 2)) {
        history.exec(removeCmd(store, a));
      }
    }
  };
  eraseAlong(prev, prev);
  trackPointer(
    pageEl,
    e,
    (ev) => {
      const cur = toPagePoint(pageEl, ev, zoom, rect);
      eraseAlong(prev, cur);
      prev = cur;
    },
    () => {},
  );
}

export function Page({
  info,
  registerVisibility,
}: {
  info: PageInfo;
  /** Subscribes this page's root to the scroller's IntersectionObserver. */
  registerVisibility: (el: HTMLElement, setVisible: (v: boolean) => void) => () => void;
}) {
  const { zoom, selectedId } = useUiState();
  useStoreVersion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<SVGGElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<Point | null>(null);
  const [codeDraft, setCodeDraft] = useState<Point | null>(null);
  const [mathDraft, setMathDraft] = useState<Point | null>(null);

  if (!rendererRef.current) rendererRef.current = new CanvasRenderer(info);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const unregister = registerVisibility(el, setVisible);
    return () => {
      unregister();
      rendererRef.current?.destroy();
    };
  }, [registerVisibility]);

  // Scrolling into view renders immediately; zoom changes render debounced,
  // letting the CSS-stretched raster carry the interaction until it settles.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && visible) rendererRef.current?.render(canvas, uiState.get().zoom);
  }, [visible]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const timer = window.setTimeout(() => rendererRef.current?.render(canvas, zoom), 150);
    return () => clearTimeout(timer);
  }, [visible, zoom]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const pageEl = rootRef.current;
    if (!pageEl || e.button !== 0) return;
    // Overlay annotations own their pointer events (and stop propagation).
    if ((e.target as Element).closest?.('.textbox, .codeblock, .mathbox')) return;
    switch (uiState.get().tool) {
      case 'pen':
      case 'highlight':
        if (liveRef.current) startStroke(pageEl, liveRef.current, e, info.index);
        break;
      case 'eraser':
        startErase(pageEl, e, info.index);
        break;
      case 'text': {
        e.preventDefault();
        select(null);
        setDraft(toPagePoint(pageEl, e, uiState.get().zoom));
        break;
      }
      case 'code': {
        e.preventDefault();
        select(null);
        setCodeDraft(toPagePoint(pageEl, e, uiState.get().zoom));
        break;
      }
      case 'math': {
        e.preventDefault();
        select(null);
        setMathDraft(toPagePoint(pageEl, e, uiState.get().zoom));
        break;
      }
      case 'select': {
        const pathEl = (e.target as Element).closest?.('path[data-id]') as SVGPathElement | null;
        select(pathEl?.dataset.id ?? null);
        break;
      }
    }
  };

  const anns = store.pageAnnotations(info.index);
  const strokes = anns.filter((a): a is Stroke => a.kind === 'stroke');
  const boxes = anns.filter((a): a is TextBox => a.kind === 'text');
  const codeBlocks = anns.filter((a): a is CodeBlock => a.kind === 'code');
  const mathBoxes = anns.filter((a): a is MathBox => a.kind === 'math');
  const selectedStroke = strokes.find((s) => s.id === selectedId);
  const w = info.width * zoom;
  const h = info.height * zoom;

  return (
    <div
      ref={rootRef}
      className="page"
      data-page={info.index}
      style={{ width: w, height: h }}
      onPointerDown={onPointerDown}
    >
      <canvas ref={canvasRef} style={{ width: w, height: h }} />
      <svg viewBox={`0 0 ${info.width} ${info.height}`} preserveAspectRatio="none">
        {selectedStroke && (
          <path
            className="halo"
            d={strokePathD(selectedStroke.points)}
            fill="none"
            stroke="#93b6f8"
            strokeWidth={selectedStroke.width + 6 / zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {strokes.map((s) => (
          <path
            key={s.id}
            data-id={s.id}
            d={strokePathD(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...(s.opacity !== undefined && s.opacity < 1
              ? { strokeOpacity: s.opacity, style: { mixBlendMode: 'multiply' as const } }
              : {})}
          />
        ))}
        <g ref={liveRef} />
      </svg>
      <div className="text-layer">
        {boxes.map((t) => (
          <TextBoxView key={t.id} t={t} zoom={zoom} selected={t.id === selectedId} />
        ))}
        {codeBlocks.map((cbAnn) => (
          <CodeBlockView key={cbAnn.id} cb={cbAnn} zoom={zoom} selected={cbAnn.id === selectedId} />
        ))}
        {mathBoxes.map((mb) => (
          <MathBoxView key={mb.id} m={mb} zoom={zoom} selected={mb.id === selectedId} />
        ))}
        {draft && <DraftTextBox page={info.index} at={draft} onDone={() => setDraft(null)} />}
        {codeDraft && (
          <DraftCodeBlock page={info.index} at={codeDraft} onDone={() => setCodeDraft(null)} />
        )}
        {mathDraft && (
          <DraftMathBox page={info.index} at={mathDraft} onDone={() => setMathDraft(null)} />
        )}
      </div>
    </div>
  );
}
