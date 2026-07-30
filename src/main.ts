import './styles.css';
import fontUrl from './assets/NotoSans-Regular.ttf?url';
import { History, removeCmd, updateCmd } from './history';
import { loadPdf, type LoadedPdf } from './pdf/render';
import { savePdf, type PageGeom } from './pdf/save';
import { AnnotationStore } from './store';
import type { Annotation, Tool } from './types';
import { PageView, type AppCtx, type AppState } from './ui/pageView';
import { Toolbar } from './ui/toolbar';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.15;

class App {
  private store = new AnnotationStore();
  private history = new History();
  private state: AppState = {
    tool: 'select',
    color: '#e0322b',
    penWidth: 2,
    fontSize: 14,
    zoom: 1,
    selectedId: null,
  };
  private ctx: AppCtx;

  private toolbar: Toolbar;
  private banner: HTMLElement;
  private bannerMsg: HTMLElement;
  private scroller: HTMLElement;
  private pagesEl: HTMLElement;
  private empty: HTMLElement;
  private fileInput: HTMLInputElement;

  private loaded: LoadedPdf | null = null;
  private originalBytes: Uint8Array | null = null;
  private fontBytes: Uint8Array | null = null;
  private baseName = 'document';
  private pageViews: PageView[] = [];
  private viewByEl = new Map<Element, PageView>();
  private io: IntersectionObserver | null = null;
  private dirty = false;
  private zoomTimer = 0;

  constructor(root: HTMLElement) {
    this.ctx = {
      store: this.store,
      history: this.history,
      state: this.state,
      select: (id) => this.select(id),
    };

    this.toolbar = new Toolbar({
      onTool: (t) => this.setTool(t),
      onColor: (c) => {
        this.state.color = c;
        this.restyleSelection({ color: c });
        this.syncToolbar();
      },
      onPenWidth: (w) => {
        this.state.penWidth = w;
        this.restyleSelection({ width: w }, 'stroke');
        this.syncToolbar();
      },
      onFontSize: (s) => {
        this.state.fontSize = s;
        this.restyleSelection({ fontSize: s }, 'text');
        this.syncToolbar();
      },
      onZoom: (dir) => this.setZoom(this.state.zoom * (dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP)),
      onFitWidth: () => this.setZoom(this.fitZoom()),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onOpen: () => this.fileInput.click(),
      onSave: () => void this.save(),
    });

    this.banner = document.createElement('div');
    this.banner.className = 'banner hidden';
    this.bannerMsg = document.createElement('span');
    const dismiss = document.createElement('button');
    dismiss.textContent = '✕';
    dismiss.title = 'Dismiss';
    dismiss.addEventListener('click', () => this.banner.classList.add('hidden'));
    this.banner.append(this.bannerMsg, dismiss);

    this.scroller = document.createElement('main');
    this.scroller.className = 'scroller';
    this.empty = document.createElement('div');
    this.empty.className = 'empty';
    this.empty.innerHTML = `
      <div class="drop-card">
        <h2>Drop a PDF here</h2>
        <p>Exams, homework, lab handouts — annotate and save a copy.</p>
        <button type="button">Open a PDF</button>
      </div>`;
    this.empty.querySelector('button')!.addEventListener('click', () => this.fileInput.click());
    this.pagesEl = document.createElement('div');
    this.pagesEl.className = 'pages hidden';
    this.pagesEl.dataset.tool = this.state.tool;
    this.scroller.append(this.empty, this.pagesEl);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/pdf,.pdf';
    this.fileInput.className = 'hidden';
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.openFile(f);
    });

    root.append(this.toolbar.el, this.banner, this.scroller, this.fileInput);

    this.store.onChange((page) => {
      this.dirty = true;
      if (page < 0) this.renderAllOverlays();
      else this.pageViews[page]?.renderOverlay();
    });
    this.history.onChange(() => this.syncToolbar());

    this.wireGlobalEvents();
    document.fonts?.load('16px "PackPDF Sans"').catch(() => {});
    this.syncToolbar();
  }

  private wireGlobalEvents(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void this.save();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        this.fileInput.click();
        return;
      }
      if (inField) return; // native undo/caret behavior while editing
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.history.redo();
        else this.history.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        this.history.redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        this.select(null);
        return;
      }
      if (!mod) {
        const tools: Record<string, Tool> = { v: 'select', p: 'pen', t: 'text', e: 'eraser' };
        const t = tools[key];
        if (t) this.setTool(t);
      }
    });

    this.scroller.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.setZoom(this.state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      },
      { passive: false },
    );

    this.scroller.addEventListener('pointerdown', (e) => {
      // Deselect when clicking the gray backdrop around pages.
      if (e.target === this.scroller || e.target === this.pagesEl) this.select(null);
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.classList.add('dragging');
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) document.body.classList.remove('dragging');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      document.body.classList.remove('dragging');
      const f = e.dataTransfer?.files?.[0];
      if (f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) void this.openFile(f);
    });

    window.addEventListener('beforeunload', (e) => {
      if (this.dirty && this.store.count > 0) e.preventDefault();
    });
  }

  private select(id: string | null): void {
    if (this.state.selectedId === id) return;
    this.state.selectedId = id;
    this.renderAllOverlays();
  }

  private setTool(t: Tool): void {
    this.state.tool = t;
    this.pagesEl.dataset.tool = t;
    if (t !== 'select') this.select(null);
    this.syncToolbar();
  }

  private deleteSelection(): void {
    const id = this.state.selectedId;
    if (!id) return;
    const a = this.store.get(id);
    if (a) this.history.exec(removeCmd(this.store, a));
    this.select(null);
  }

  private restyleSelection(patch: Partial<Annotation>, kind?: Annotation['kind']): void {
    const id = this.state.selectedId;
    if (!id) return;
    const a = this.store.get(id);
    if (!a || (kind && a.kind !== kind)) return;
    this.history.exec(updateCmd(this.store, a, { ...a, ...patch } as Annotation));
  }

  private renderAllOverlays(): void {
    for (const pv of this.pageViews) pv.renderOverlay();
  }

  private syncToolbar(): void {
    this.toolbar.sync(this.state, this.history.canUndo, this.history.canRedo, !!this.loaded);
  }

  private showBanner(msg: string): void {
    this.bannerMsg.textContent = msg;
    this.banner.classList.remove('hidden');
  }

  private fitZoom(): number {
    if (!this.loaded) return 1;
    const maxW = Math.max(...this.loaded.pages.map((p) => p.width));
    const fit = (this.scroller.clientWidth - 48) / maxW;
    return Math.min(1.5, Math.max(ZOOM_MIN, fit));
  }

  private setZoom(z: number): void {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (zoom === this.state.zoom) return;
    this.state.zoom = zoom;
    for (const pv of this.pageViews) pv.applyZoom();
    this.syncToolbar();
    clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => {
      for (const pv of this.pageViews) pv.renderCanvas();
    }, 150);
  }

  private teardown(): void {
    this.io?.disconnect();
    this.io = null;
    for (const pv of this.pageViews) pv.destroy();
    this.pageViews = [];
    this.viewByEl.clear();
    this.loaded?.destroy();
    this.loaded = null;
  }

  private async openFile(file: File): Promise<void> {
    if (
      this.dirty &&
      this.store.count > 0 &&
      !confirm('Discard the annotations on the current PDF?')
    ) {
      return;
    }
    let loaded: LoadedPdf;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      loaded = await loadPdf(bytes);
    } catch (err) {
      const name = (err as Error | undefined)?.name;
      this.showBanner(
        name === 'PasswordException'
          ? 'This PDF is password-protected — unlock it first, then open it here.'
          : `Couldn't open “${file.name}” as a PDF.`,
      );
      return;
    }

    this.teardown();
    this.banner.classList.add('hidden');
    this.loaded = loaded;
    this.originalBytes = bytes;
    this.baseName = file.name.replace(/\.pdf$/i, '') || 'document';
    this.store.clear();
    this.history.clear();
    this.state.selectedId = null;

    this.empty.classList.add('hidden');
    this.pagesEl.classList.remove('hidden');
    this.state.zoom = this.fitZoom();

    this.io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) this.viewByEl.get(en.target)?.setVisible(en.isIntersecting);
      },
      { root: this.scroller, rootMargin: '600px 0px' },
    );
    for (const info of loaded.pages) {
      const pv = new PageView(this.ctx, info);
      this.pageViews.push(pv);
      this.viewByEl.set(pv.el, pv);
      this.pagesEl.append(pv.el);
      this.io.observe(pv.el);
    }
    this.scroller.scrollTop = 0;
    this.dirty = false;
    this.syncToolbar();
  }

  private async save(): Promise<void> {
    if (!this.loaded || !this.originalBytes) return;
    try {
      if (!this.fontBytes) {
        const res = await fetch(fontUrl);
        this.fontBytes = new Uint8Array(await res.arrayBuffer());
      }
      const pageGeoms: PageGeom[] = this.loaded.pages.map((p) => ({
        transform: p.transform,
        rotation: p.rotation,
      }));
      const out = await savePdf({
        originalBytes: this.originalBytes,
        fontBytes: this.fontBytes,
        annotations: this.store.all(),
        pageGeoms,
      });
      const blob = new Blob([out.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.baseName}-annotated.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.dirty = false;
    } catch {
      this.showBanner('Saving failed — your annotations are still here. Try again.');
    }
  }
}

new App(document.querySelector<HTMLDivElement>('#app')!);
