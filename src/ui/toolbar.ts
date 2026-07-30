import type { Tool } from '../types';
import type { AppState } from './pageView';

export interface ToolbarCallbacks {
  onTool(t: Tool): void;
  onColor(c: string): void;
  onHighlightColor(c: string): void;
  onPenWidth(w: number): void;
  onFontSize(s: number): void;
  onZoom(dir: -1 | 1): void;
  onFitWidth(): void;
  onUndo(): void;
  onRedo(): void;
  onOpen(): void;
  onSave(): void;
}

const SWATCHES = ['#1d1d1f', '#e0322b', '#2563eb', '#16a34a'];
const HIGHLIGHT_SWATCHES = ['#ffe600', '#6ee86e', '#ff8ac2', '#7ac7ff'];
const WIDTHS = [2, 4, 8];

const ICONS: Record<Tool, string> = {
  select:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M5 3l14 10.5h-6.6l3.6 7-2.7 1.3-3.5-7L5 19.5z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  highlight:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M14.2 3.4l6.4 6.4-8.9 8.9-6.4-6.4z"/><path d="M4.4 13.2l6.4 6.4-1.3 1.3H3v-2.5z" opacity=".55"/><path d="M3 22h18v1.6H3z" opacity=".4"/></svg>',
  text: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M5 4v3h5.5v12h3V7H19V4z"/></svg>',
  eraser:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M15.14 3a2 2 0 0 0-1.41.59L2.59 14.73a2 2 0 0 0 0 2.83L5.03 20h7.66l8.72-8.72a2 2 0 0 0 0-2.83l-4.86-4.86A2 2 0 0 0 15.14 3zm-4.9 15H5.86l-1.86-1.86 5.51-5.51 4.85 4.86z"/></svg>',
};

const TOOL_TITLES: Record<Tool, string> = {
  select: 'Select / move (V)',
  pen: 'Pen (P)',
  highlight: 'Highlighter (H)',
  text: 'Text (T)',
  eraser: 'Eraser (E)',
};

export class Toolbar {
  readonly el: HTMLElement;
  private toolBtns: HTMLButtonElement[];
  private swatchBtns: HTMLButtonElement[];
  private hlSwatchBtns: HTMLButtonElement[];
  private penSwatchGroup: HTMLElement;
  private hlSwatchGroup: HTMLElement;
  private customColor: HTMLInputElement;
  private widthBtns: HTMLButtonElement[];
  private fontSize: HTMLInputElement;
  private zoomLabel: HTMLElement;
  private zoomIn: HTMLButtonElement;
  private zoomOut: HTMLButtonElement;
  private fit: HTMLButtonElement;
  private undo: HTMLButtonElement;
  private redo: HTMLButtonElement;
  private save: HTMLButtonElement;

  constructor(cb: ToolbarCallbacks) {
    this.el = document.createElement('header');
    this.el.className = 'toolbar';
    this.el.innerHTML = `
      <div class="brand">PackPDF</div>
      <div class="tb-group tools">
        ${(Object.keys(ICONS) as Tool[])
          .map(
            (t) =>
              `<button class="tb-btn" data-tool="${t}" title="${TOOL_TITLES[t]}" aria-pressed="false">${ICONS[t]}</button>`,
          )
          .join('')}
      </div>
      <div class="tb-group swatches pen-swatches">
        ${SWATCHES.map(
          (c) =>
            `<button class="swatch" data-color="${c}" title="${c}" style="background:${c}"></button>`,
        ).join('')}
        <label class="swatch custom" title="Custom color"><input type="color" value="#e0322b"></label>
      </div>
      <div class="tb-group swatches hl-swatches hidden">
        ${HIGHLIGHT_SWATCHES.map(
          (c) =>
            `<button class="swatch" data-hcolor="${c}" title="${c}" style="background:${c}"></button>`,
        ).join('')}
      </div>
      <div class="tb-group widths">
        ${WIDTHS.map(
          (w, i) =>
            `<button class="tb-btn width" data-width="${w}" title="Pen width ${w}"><i style="width:${4 + i * 3}px;height:${4 + i * 3}px"></i></button>`,
        ).join('')}
      </div>
      <div class="tb-group">
        <input type="number" class="fontsize" min="6" max="96" step="1" value="14" title="Text size (pt)">
      </div>
      <div class="tb-group zoom">
        <button class="tb-btn zoom-out" title="Zoom out">&minus;</button>
        <span class="zoom-label">100%</span>
        <button class="tb-btn zoom-in" title="Zoom in">+</button>
        <button class="tb-btn fit" title="Fit page width">Fit</button>
      </div>
      <div class="tb-group history">
        <button class="tb-btn undo" title="Undo (Ctrl+Z)">&#x21B6;</button>
        <button class="tb-btn redo" title="Redo (Ctrl+Shift+Z)">&#x21B7;</button>
      </div>
      <div class="tb-spacer"></div>
      <button class="open" title="Open a PDF (Ctrl+O)">Open</button>
      <button class="save" title="Download annotated PDF (Ctrl+S)">Save</button>
    `;

    const q = <T extends Element>(sel: string): T => this.el.querySelector(sel) as T;
    this.toolBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-tool]')];
    this.swatchBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-color]')];
    this.hlSwatchBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-hcolor]')];
    this.penSwatchGroup = q<HTMLElement>('.pen-swatches');
    this.hlSwatchGroup = q<HTMLElement>('.hl-swatches');
    this.customColor = q<HTMLInputElement>('input[type=color]');
    this.widthBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-width]')];
    this.fontSize = q<HTMLInputElement>('.fontsize');
    this.zoomLabel = q<HTMLElement>('.zoom-label');
    this.zoomIn = q<HTMLButtonElement>('.zoom-in');
    this.zoomOut = q<HTMLButtonElement>('.zoom-out');
    this.fit = q<HTMLButtonElement>('.fit');
    this.undo = q<HTMLButtonElement>('.undo');
    this.redo = q<HTMLButtonElement>('.redo');
    this.save = q<HTMLButtonElement>('.save');

    for (const b of this.toolBtns)
      b.addEventListener('click', () => cb.onTool(b.dataset.tool as Tool));
    for (const b of this.swatchBtns)
      b.addEventListener('click', () => cb.onColor(b.dataset.color ?? '#1d1d1f'));
    this.customColor.addEventListener('input', () => cb.onColor(this.customColor.value));
    for (const b of this.hlSwatchBtns)
      b.addEventListener('click', () => cb.onHighlightColor(b.dataset.hcolor ?? '#ffe600'));
    for (const b of this.widthBtns)
      b.addEventListener('click', () => cb.onPenWidth(Number(b.dataset.width)));
    this.fontSize.addEventListener('change', () => {
      const v = Math.max(6, Math.min(96, Math.round(Number(this.fontSize.value) || 14)));
      this.fontSize.value = String(v);
      cb.onFontSize(v);
    });
    this.zoomIn.addEventListener('click', () => cb.onZoom(1));
    this.zoomOut.addEventListener('click', () => cb.onZoom(-1));
    this.fit.addEventListener('click', () => cb.onFitWidth());
    this.undo.addEventListener('click', () => cb.onUndo());
    this.redo.addEventListener('click', () => cb.onRedo());
    q<HTMLButtonElement>('.open').addEventListener('click', () => cb.onOpen());
    this.save.addEventListener('click', () => cb.onSave());
  }

  sync(state: AppState, canUndo: boolean, canRedo: boolean, hasDoc: boolean): void {
    for (const b of this.toolBtns) {
      const active = b.dataset.tool === state.tool;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    const hl = state.tool === 'highlight';
    this.penSwatchGroup.classList.toggle('hidden', hl);
    this.hlSwatchGroup.classList.toggle('hidden', !hl);
    let preset = false;
    for (const b of this.swatchBtns) {
      const active = b.dataset.color === state.color;
      preset ||= active;
      b.classList.toggle('active', active);
    }
    this.customColor.parentElement?.classList.toggle('active', !preset);
    if (document.activeElement !== this.customColor) this.customColor.value = state.color;
    for (const b of this.hlSwatchBtns)
      b.classList.toggle('active', b.dataset.hcolor === state.highlightColor);
    for (const b of this.widthBtns) {
      b.classList.toggle('active', Number(b.dataset.width) === state.penWidth);
      b.disabled = hl; // highlighter width is fixed
    }
    if (document.activeElement !== this.fontSize) this.fontSize.value = String(state.fontSize);
    this.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    this.undo.disabled = !canUndo;
    this.redo.disabled = !canRedo;
    this.save.disabled = !hasDoc;
    this.zoomIn.disabled = !hasDoc;
    this.zoomOut.disabled = !hasDoc;
    this.fit.disabled = !hasDoc;
  }
}
