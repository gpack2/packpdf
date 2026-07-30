import { eraserHits, strokePathD, thinPoints } from '../geometry';
import { addCmd, removeCmd, type History } from '../history';
import { renderPage, type PageInfo, type RenderHandle } from '../pdf/render';
import type { AnnotationStore } from '../store';
import {
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_WIDTH,
  newId,
  type Point,
  type TextBox,
  type Tool,
} from '../types';
import { mountTextBox, startDraftTextBox, updateTextBoxEl } from './textbox';

export interface AppState {
  tool: Tool;
  color: string;
  highlightColor: string;
  penWidth: number;
  fontSize: number;
  zoom: number;
  selectedId: string | null;
}

/** Shared mutable app context owned by main.ts. */
export interface AppCtx {
  store: AnnotationStore;
  history: History;
  state: AppState;
  select(id: string | null): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Eraser hit radius in screen pixels (converted to page units per zoom). */
const ERASER_RADIUS = 6;

export class PageView {
  readonly el: HTMLDivElement;
  private canvas = document.createElement('canvas');
  private svg: SVGSVGElement;
  private layer = document.createElement('div');
  private visible = false;
  private renderedZoom = 0;
  private inflightZoom = 0;
  private handle: RenderHandle | null = null;

  constructor(
    private ctx: AppCtx,
    readonly info: PageInfo,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'page';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${info.width} ${info.height}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.layer.className = 'text-layer';
    this.el.append(this.canvas, this.svg, this.layer);
    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.applyZoom();
  }

  private get zoom(): number {
    return this.ctx.state.zoom;
  }

  /** Resizes to the current zoom (cheap); canvas re-render happens separately. */
  applyZoom(): void {
    const w = this.info.width * this.zoom;
    const h = this.info.height * this.zoom;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.renderOverlay();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.renderCanvas();
  }

  renderCanvas(): void {
    if (!this.visible) return;
    const target = this.zoom;
    if (this.renderedZoom === target || (this.handle && this.inflightZoom === target)) return;
    this.handle?.cancel();
    this.inflightZoom = target;
    const handle = renderPage(this.info, this.canvas, target);
    this.handle = handle;
    void handle.done.then(() => {
      if (this.handle === handle) {
        this.handle = null;
        this.renderedZoom = target;
      }
    });
  }

  /** Rebuilds SVG strokes and reconciles textboxes from the store. */
  renderOverlay(): void {
    const anns = this.ctx.store.pageAnnotations(this.info.index);
    const selectedId = this.ctx.state.selectedId;

    for (const p of [...this.svg.querySelectorAll('[data-id], .halo')]) p.remove();
    const live = this.svg.querySelector('.live');
    for (const a of anns) {
      if (a.kind !== 'stroke') continue;
      const d = strokePathD(a.points);
      if (a.id === selectedId) {
        const halo = document.createElementNS(SVG_NS, 'path');
        halo.setAttribute('class', 'halo');
        halo.setAttribute('d', d);
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', '#93b6f8');
        halo.setAttribute('stroke-width', String(a.width + 6 / this.zoom));
        halo.setAttribute('stroke-linecap', 'round');
        halo.setAttribute('stroke-linejoin', 'round');
        this.svg.insertBefore(halo, live);
      }
      const path = document.createElementNS(SVG_NS, 'path');
      path.dataset.id = a.id;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', a.color);
      path.setAttribute('stroke-width', String(a.width));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      if (a.opacity !== undefined && a.opacity < 1) {
        path.setAttribute('stroke-opacity', String(a.opacity));
        path.style.mixBlendMode = 'multiply';
      }
      this.svg.insertBefore(path, live);
    }

    const boxes = new Map<string, TextBox>();
    for (const a of anns) if (a.kind === 'text') boxes.set(a.id, a);
    for (const el of [...this.layer.querySelectorAll<HTMLTextAreaElement>('.textbox[data-id]')]) {
      const t = boxes.get(el.dataset.id ?? '');
      if (!t) {
        el.remove();
        continue;
      }
      boxes.delete(t.id);
      // Leave the focused (editing) box alone so caret and value survive.
      if (document.activeElement !== el) updateTextBoxEl(el, t, this.zoom, t.id === selectedId);
    }
    for (const t of boxes.values()) mountTextBox(this.ctx, this.layer, t);
  }

  destroy(): void {
    this.handle?.cancel();
    this.el.remove();
  }

  private toPagePoint(e: { clientX: number; clientY: number }, rect?: DOMRect): Point {
    const r = rect ?? this.el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // Textboxes own their pointer events (and stop propagation).
    if ((e.target as Element).closest?.('.textbox')) return;
    switch (this.ctx.state.tool) {
      case 'pen':
      case 'highlight':
        this.startStroke(e);
        break;
      case 'eraser':
        this.startErase(e);
        break;
      case 'text': {
        e.preventDefault();
        this.ctx.select(null);
        startDraftTextBox(this.ctx, this.layer, this.info.index, this.toPagePoint(e));
        break;
      }
      case 'select': {
        const pathEl = (e.target as Element).closest?.('path[data-id]') as SVGPathElement | null;
        this.ctx.select(pathEl?.dataset.id ?? null);
        break;
      }
    }
  };

  private trackPointer(
    e: PointerEvent,
    onMove: (ev: PointerEvent) => void,
    onEnd: (commit: boolean) => void,
  ): void {
    this.el.setPointerCapture(e.pointerId);
    const finish = (commit: boolean) => {
      this.el.removeEventListener('pointermove', onMove);
      this.el.removeEventListener('pointerup', onUp);
      this.el.removeEventListener('pointercancel', onCancel);
      onEnd(commit);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    this.el.addEventListener('pointermove', onMove);
    this.el.addEventListener('pointerup', onUp);
    this.el.addEventListener('pointercancel', onCancel);
  }

  private startStroke(e: PointerEvent): void {
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const raw: Point[] = [this.toPagePoint(e, rect)];
    const highlight = this.ctx.state.tool === 'highlight';
    const color = highlight ? this.ctx.state.highlightColor : this.ctx.state.color;
    const width = highlight ? HIGHLIGHT_WIDTH : this.ctx.state.penWidth;
    const opacity = highlight ? HIGHLIGHT_OPACITY : undefined;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'live');
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
    this.svg.append(path);

    let rafId = 0;
    const flush = () => {
      rafId = 0;
      path.setAttribute('d', strokePathD(raw));
    };
    this.trackPointer(
      e,
      (ev) => {
        const events = ev.getCoalescedEvents?.() ?? [ev];
        for (const ce of events) raw.push(this.toPagePoint(ce, rect));
        if (!rafId) rafId = requestAnimationFrame(flush);
      },
      (commit) => {
        if (rafId) cancelAnimationFrame(rafId);
        path.remove();
        if (!commit) return;
        this.ctx.history.exec(
          addCmd(this.ctx.store, {
            id: newId(),
            kind: 'stroke',
            page: this.info.index,
            points: thinPoints(raw, 1.5),
            color,
            width,
            ...(opacity !== undefined ? { opacity } : {}),
          }),
        );
      },
    );
  }

  private startErase(e: PointerEvent): void {
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    let prev = this.toPagePoint(e, rect);
    const eraseAlong = (from: Point, to: Point) => {
      for (const a of this.ctx.store.pageAnnotations(this.info.index)) {
        if (a.kind !== 'stroke') continue;
        if (eraserHits(a.points, from, to, ERASER_RADIUS / this.zoom + a.width / 2)) {
          this.ctx.history.exec(removeCmd(this.ctx.store, a));
        }
      }
    };
    eraseAlong(prev, prev);
    this.trackPointer(
      e,
      (ev) => {
        const cur = this.toPagePoint(ev, rect);
        eraseAlong(prev, cur);
        prev = cur;
      },
      () => {},
    );
  }
}
