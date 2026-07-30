# PackPDF Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Client-side PDF annotation editor: open a PDF, add textboxes and freehand ink, undo/redo/erase/move/restyle, save an annotated copy.

**Architecture:** Vite + vanilla TypeScript SPA. pdf.js renders pages to canvases in a scrollable column; each page gets an SVG overlay (ink) and a div layer (textboxes). Annotations live in an in-memory store keyed by page, in scale-1 pdf.js viewport coordinates. pdf-lib + fontkit flatten annotations into a copy of the original bytes on save.

**Tech Stack:** TypeScript (strict), Vite, vitest, `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit`, bundled Noto Sans TTF (OFL).

## Global Constraints

- Runtime deps limited to: `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit`. No UI framework.
- TypeScript `strict: true`; `tsc --noEmit` and `vite build` must stay clean.
- Annotation coordinates are **scale-1 pdf.js viewport coordinates** (top-left origin, y-down) everywhere except inside `pdf/save.ts`.
- Saved file name: `<original-basename>-annotated.pdf`.
- Textboxes: no soft wrap (`white-space: pre`, `wrap="off"`, zero padding); Enter makes new lines; line-height factor fixed at **1.3** in both CSS and save path.
- Bundled font: `src/assets/NotoSans-Regular.ttf` used for on-screen textboxes (`@font-face "PackPDF Sans"`) and embedded on save.
- Pure modules (`coords`, `geometry`, `store`, `history`, `pdf/save`) must not touch the DOM.
- Commit after every green test cycle.

---

### Task 1: Scaffold Vite + TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `README.md`, `src/main.ts` (stub), `src/styles.css` (base), `src/assets/NotoSans-Regular.ttf` (downloaded)

**Interfaces:**
- Produces: working `npm run dev` / `npm run build` / `npm test` (vitest) commands; font asset at `src/assets/NotoSans-Regular.ttf`.

- [ ] **Step 1: Init package**

```jsonc
// package.json
{
  "name": "packpdf",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

Run: `npm i -D vite typescript vitest && npm i pdfjs-dist pdf-lib @pdf-lib/fontkit`

- [ ] **Step 2: tsconfig + vite config**

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({ build: { target: 'es2022' } });
```

- [ ] **Step 3: Download font** (canonical notofonts location, jsdelivr fallback)

Run: `curl -fL -o src/assets/NotoSans-Regular.ttf https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf`
Verify: `file src/assets/NotoSans-Regular.ttf` reports TrueType.

- [ ] **Step 4: index.html + stub main.ts + base styles; `.gitignore` (node_modules, dist); README with OFL font attribution**

```html
<!-- index.html -->
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PackPDF</title>
</head><body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body></html>
```

- [ ] **Step 5: Verify build works**

Run: `npm run build` → succeeds. `npm test` → "no test files" is acceptable at this task only.

- [ ] **Step 6: Commit** `chore: scaffold vite + ts + deps + bundled font`

---

### Task 2: types.ts + coords.ts (transform math)

**Files:**
- Create: `src/types.ts`, `src/coords.ts`
- Test: `tests/coords.test.ts`

**Interfaces (Produces):**

```ts
// src/types.ts
export type Tool = 'select' | 'pen' | 'text' | 'eraser';
export interface Point { x: number; y: number }
export interface Stroke {
  id: string; kind: 'stroke'; page: number;
  points: Point[]; color: string; width: number;
}
export interface TextBox {
  id: string; kind: 'text'; page: number;
  x: number; y: number; text: string; color: string; fontSize: number;
}
export type Annotation = Stroke | TextBox;
export const LINE_HEIGHT_FACTOR = 1.3;
export function newId(): string; // 'a' + counter + random suffix
```

```ts
// src/coords.ts — [a,b,c,d,e,f] maps (x,y) -> (a*x+c*y+e, b*x+d*y+f)
export type Matrix = [number, number, number, number, number, number];
export function applyTransform(m: Matrix, p: Point): Point;
export function invertTransform(m: Matrix): Matrix;
// Replicates pdf.js PageViewport transform at scale 1 for viewBox [0,0,w,h]:
export function viewportTransform(w: number, h: number, rotation: 0|90|180|270): Matrix;
export function viewportSize(w: number, h: number, rotation: 0|90|180|270): { width: number; height: number };
```

Known-good matrices (from pdf.js PageViewport source, scale 1):
- r=0: `[1,0,0,-1,0,h]`, size (w,h)
- r=90: `[0,1,1,0,0,0]`, size (h,w)
- r=180: `[-1,0,0,1,w,0]`, size (w,h)
- r=270: `[0,-1,-1,0,h,w]`, size (h,w)

Inverse: `det = a*d-b*c`; `[d/det, -b/det, -c/det, a/det, (c*f-d*e)/det, (b*e-a*f)/det]`.

- [ ] **Step 1: Write failing tests** — for each rotation: PDF corner points map to expected viewport corners (e.g. r=0: PDF (0,h) top-left → viewport (0,0); PDF (0,0) → viewport (0,h)); `applyTransform(invertTransform(m), applyTransform(m, p)) ≈ p` for random points, all rotations.
- [ ] **Step 2: Run** `npx vitest run tests/coords.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat: types + viewport/PDF coordinate transforms`

---

### Task 3: geometry.ts (thinning, smoothing, eraser hit-test)

**Files:**
- Create: `src/geometry.ts`
- Test: `tests/geometry.test.ts`

**Interfaces (Produces):**

```ts
export function thinPoints(points: Point[], minDist?: number): Point[]; // default 1.5; always keeps first & last
export function strokePathD(points: Point[]): string;
// n=1: "M x y L x+0.01 y" (dot w/ round cap); n=2: "M..L..";
// n>=3: M p0, then for i in 1..n-2: "Q p[i] mid(p[i],p[i+1])", then "L p[n-1]". 2-decimal coords.
export function segmentDist(p: Point, a: Point, b: Point): number;
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean;
export function segmentSegmentDist(a1: Point, a2: Point, b1: Point, b2: Point): number; // 0 if intersecting
export function eraserHits(stroke: Point[], from: Point, to: Point, threshold: number): boolean;
// single-point stroke: point-to-segment distance; else any consecutive stroke segment within threshold
```

- [ ] **Step 1: Failing tests** — thinning drops clustered points, keeps endpoints; d-string exact for 1/2/3-point inputs; `segmentDist` known values (point above middle of segment, beyond endpoint); crossing segments → intersect true, dist 0; parallel segments → correct gap; `eraserHits` true when eraser segment crosses a stroke, false when passing outside threshold.
- [ ] **Step 2: Run → FAIL.** 
- [ ] **Step 3: Implement** (point-to-segment via clamped projection; segment intersection via orientation signs incl. collinear-overlap; seg-seg dist = 0 if intersecting else min of 4 point-seg distances).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat: stroke geometry (thinning, smoothing, eraser hit-test)`

---

### Task 4: store.ts + history.ts

**Files:**
- Create: `src/store.ts`, `src/history.ts`
- Test: `tests/store.test.ts`, `tests/history.test.ts`

**Interfaces (Produces):**

```ts
// src/store.ts
export type StoreListener = (page: number) => void;
export class AnnotationStore {
  add(a: Annotation): void;
  remove(id: string): Annotation | undefined;
  replace(a: Annotation): void;            // by id; emits change
  get(id: string): Annotation | undefined;
  pageAnnotations(page: number): readonly Annotation[];
  all(): Annotation[];
  get count(): number;
  onChange(fn: StoreListener): () => void; // returns unsubscribe
  clear(): void;                           // emits page -1
}

// src/history.ts
export interface Command { do(): void; undo(): void }
export class History {
  exec(cmd: Command): void;   // do() + push + clear redo tail
  undo(): boolean; redo(): boolean;
  get canUndo(): boolean; get canRedo(): boolean;
  onChange(fn: () => void): () => void;
  clear(): void;
}
export const addCmd = (s: AnnotationStore, a: Annotation): Command =>
  ({ do: () => s.add(a), undo: () => { s.remove(a.id); } });
export const removeCmd = (s: AnnotationStore, a: Annotation): Command =>
  ({ do: () => { s.remove(a.id); }, undo: () => s.add(a) });
export const updateCmd = (s: AnnotationStore, before: Annotation, after: Annotation): Command =>
  ({ do: () => s.replace(after), undo: () => s.replace(before) });
```

- [ ] **Step 1: Failing tests** — store: add/get/remove/replace/pageAnnotations filtering/count/listener page arg/unsubscribe/clear. history: exec-undo-redo round-trip on a real store; new exec truncates redo; canUndo/canRedo flags; update command restores before-snapshot.
- [ ] **Step 2: Run → FAIL.** 
- [ ] **Step 3: Implement** (Map<string, Annotation> + insertion order per page preserved via array index or ordered Map iteration).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat: annotation store + undo/redo history`

---

### Task 5: pdf/save.ts (flatten pipeline)

**Files:**
- Create: `src/pdf/save.ts`
- Test: `tests/save.test.ts`

**Interfaces (Produces):**

```ts
export interface PageGeom { transform: Matrix; rotation: 0|90|180|270 }
export interface SaveInput {
  originalBytes: Uint8Array;
  fontBytes: Uint8Array;
  annotations: Annotation[];
  pageGeoms: PageGeom[];   // indexed by page
}
export function hexToRgb01(hex: string): { r: number; g: number; b: number };
export function baselineOffsets(metrics: {ascent:number; descent:number; unitsPerEm:number},
  fontSize: number): { first: number; lineHeight: number };
// lineHeight = 1.3*fontSize; content = (ascent-descent)/upm*fontSize (descent is negative);
// first = (lineHeight-content)/2 + ascent/upm*fontSize   (CSS half-leading model)
export async function savePdf(input: SaveInput): Promise<Uint8Array>;
```

Algorithm (the load-bearing part):
1. `PDFDocument.load(originalBytes)`; `doc.registerFontkit(fontkit)`; `font = await doc.embedFont(fontBytes, { subset: true })`.
2. Metrics via `fontkit.create(fontBytes)` → `{ascent, descent, unitsPerEm}`.
3. Per stroke: `inv = invertTransform(geom.transform)`; map every point (and smoothing happens AFTER mapping is unnecessary — smoothing is affine-safe, so build d from mapped points): `u = applyTransform(inv, p)`; build path with `strokePathD` over `{x: u.x, y: -u.y}` (drawSvgPath places path point (sx,sy) at (x+sx, y−sy); with x:0,y:0 supplying (u.x, −u.y) lands exactly at (u.x, u.y)). Draw: `page.drawSvgPath(d, { x: 0, y: 0, borderColor: rgb(...), borderWidth: stroke.width, borderLineCap: LineCapStyle.Round, borderOpacity: 1 })`.
4. Per textbox: split on `\n`; `{first, lineHeight} = baselineOffsets(...)`; for line i, viewport anchor `(t.x, t.y + first + i*lineHeight)` → `applyTransform(inv, anchor)` → `page.drawText(line, { x, y, size, font, color, rotate: degrees(geom.rotation) })`. (`degrees(rotation)` keeps glyphs upright on /Rotate'd pages — verified against all four viewport matrices.)
5. Skip empty lines (`drawText('')` wasteful) but still advance line index. Return `doc.save()`.

- [ ] **Step 1: Failing tests** — `hexToRgb01('#ff0080')`; `baselineOffsets` with Noto-like metrics (ascent 1069, descent −293, upm 1000, size 14 → lineHeight 18.2, first = (18.2−19.068)/2 + 14.966 = 14.532 ± .01). Round-trip test: build a fresh 612×792 pdf-lib doc in the test, save to bytes; run `savePdf` with one stroke + one textbox `"μ = 0.5\nΩ line2"` at rotation 0 (`transform: viewportTransform(612,792,0)`), font bytes read from `src/assets/NotoSans-Regular.ttf` via `fs`; assert output loads in pdf-lib, page count 1, byte length > input; extract text with `pdfjs-dist/legacy/build/pdf.mjs` `getTextContent()` and assert it contains `μ = 0.5` and `Ω line2`. Second case: rotation 90 geom → still saves without throwing and text extraction still finds the strings.
- [ ] **Step 2: Run → FAIL.** 
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat: pdf-lib save pipeline (ink paths + embedded-font text)`

---

### Task 6: pdf/render.ts (pdf.js wrapper)

**Files:**
- Create: `src/pdf/render.ts`

**Interfaces (Produces):**

```ts
export interface PageInfo {
  index: number; rotation: 0|90|180|270;
  transform: Matrix;                 // scale-1 viewport transform from pdf.js
  width: number; height: number;     // scale-1 viewport CSS size
  page: PDFPageProxy;
}
export interface LoadedPdf { doc: PDFDocumentProxy; pages: PageInfo[] }
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf>;
export function renderPage(info: PageInfo, canvas: HTMLCanvasElement, zoom: number): { done: Promise<void>; cancel(): void };
```

Details that WILL bite if missed:
- `GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()` — or `?url` import; must be set before `getDocument`.
- **Pass a copy** to `getDocument({ data: bytes.slice() })` — pdf.js transfers the buffer to its worker and detaches it; the original must stay usable for pdf-lib save.
- `rotation = ((page.rotate % 360) + 360) % 360` as 0|90|180|270; `transform` from `page.getViewport({scale:1}).transform`.
- Render at `scale: zoom * devicePixelRatio` into `canvas.width/height`, set CSS size to `zoom * info.width/height`; keep the returned render task; `cancel()` calls `task.cancel()` and swallows `RenderingCancelledException`.

- [ ] **Step 1: Implement** (no unit test — DOM/worker-bound; exercised by Task 8 dev usage and Task 9 E2E).
- [ ] **Step 2: `npm run build` clean → Commit** `feat: pdf.js loading + page rendering wrapper`

---

### Task 7: UI — pageView, textbox, toolbar, styles

**Files:**
- Create: `src/ui/pageView.ts`, `src/ui/textbox.ts`, `src/ui/toolbar.ts`, full `src/styles.css`

**Interfaces:**
- Consumes: store/history commands (Task 4), geometry (Task 3), `PageInfo`/`renderPage` (Task 6).
- Produces:

```ts
// ui/pageView.ts
export interface AppCtx {   // shared mutable context owned by main.ts
  store: AnnotationStore; history: History;
  state: { tool: Tool; color: string; penWidth: number; fontSize: number;
           zoom: number; selectedId: string | null };
  select(id: string | null): void;
  markDirty(): void;
}
export class PageView {
  readonly el: HTMLElement;              // .page container
  constructor(ctx: AppCtx, info: PageInfo);
  setZoom(zoom: number): void;           // resize + queue re-render
  renderCanvasIfVisible(): void;         // called by IntersectionObserver
  renderOverlay(): void;                 // rebuild svg strokes + reconcile textboxes
  destroy(): void;
}

// ui/textbox.ts
export function mountTextBox(ctx: AppCtx, layer: HTMLElement, t: TextBox): HTMLTextAreaElement;
export function startDraftTextBox(ctx: AppCtx, layer: HTMLElement, page: number, at: Point): void;

// ui/toolbar.ts
export interface ToolbarCallbacks {
  onTool(t: Tool): void; onColor(c: string): void; onPenWidth(w: number): void;
  onFontSize(s: number): void; onZoom(dir: -1 | 1): void; onFitWidth(): void;
  onUndo(): void; onRedo(): void; onOpen(): void; onSave(): void;
}
export class Toolbar {
  readonly el: HTMLElement;
  constructor(cb: ToolbarCallbacks);
  sync(state: AppCtx['state'], canUndo: boolean, canRedo: boolean, hasDoc: boolean): void;
}
```

Behavior contract (each is a checkbox during implementation):

- [ ] **Layering & pointer routing:** page container = relative div sized `zoom*info.width/height`; children: canvas (z0), svg (z1, `viewBox="0 0 w h"` at scale-1, CSS size zoomed), text layer (z2). Container carries `data-tool` from state; CSS: pen/eraser → text layer children `pointer-events:none`; select → textareas interactive, stroke paths `pointer-events:stroke`; text tool → container click creates draft.
- [ ] **Coordinate helper:** `toPagePoint(e) = ((e.clientX-rect.left)/zoom, (e.clientY-rect.top)/zoom)` using container rect.
- [ ] **Pen:** pointerdown (primary) → `setPointerCapture`, start raw point list + live `<path>` in svg; pointermove batches via rAF, appends thinned points, updates `d=strokePathD(pts)`; pointerup → remove live path, `history.exec(addCmd(store, {id:newId(), kind:'stroke', page, points: thinPoints(raw), color, width}))`.
- [ ] **Eraser:** pointerdown/move with capture; per move segment (prev→cur), for each stroke on page `eraserHits(points, prev, cur, 6 + stroke.width/2)` → `history.exec(removeCmd(...))`. Pointerdown directly on a textbox in eraser mode deletes it.
- [ ] **Text tool:** click on empty area → `startDraftTextBox`: absolutely-positioned textarea (DOM only, NOT in store), focused immediately; on blur: non-empty → `history.exec(addCmd(...))`; empty → remove node. Draft styling identical to mounted boxes.
- [ ] **Mounted textboxes (`mountTextBox`):** textarea `wrap="off"`, `white-space:pre`, zero padding, font `PackPDF Sans`, `font-size: fontSize*zoom`, `line-height: 1.3`, `left/top = x*zoom, y*zoom`, color; `readOnly` unless editing. Auto-size on input (`width=0 → scrollWidth`, `height=0 → scrollHeight`). Select mode: pointerdown selects + starts drag (DOM-direct moves; on release if moved → `exec(updateCmd(store, before, {...t, x, y}))`); dblclick → `readOnly=false`, focus, snapshot text; blur → if text changed `exec(updateCmd)`, if emptied `exec(removeCmd)`.
- [ ] **renderOverlay reconciliation:** strokes fully rebuilt (`<path data-id>` per stroke, class `selected` when selected); textboxes reconciled by id (update pos/size/style/value only when not focused) so focus/caret survive unrelated changes.
- [ ] **Selection:** `ctx.select(id)` toggles `.selected` (blue outline); Delete/Backspace (outside textarea) removes selection via `removeCmd`; changing color/pen-width/font-size while something is selected applies `updateCmd` restyle to it.
- [ ] **Toolbar DOM:** tool buttons (Select V, Pen P, Text T, Eraser E) with `aria-pressed`; swatches `#1d1d1f #e0322b #2563eb #16a34a` + `<input type=color>`; pen widths 2/4/8 as dot buttons; font-size `<input type=number min=6 max=96>`; zoom −/%/+ and Fit; Undo/Redo (disabled per flags); Open; **Save** primary button. All buttons `title` tooltips with shortcut.
- [ ] **styles.css:** dark-neutral chrome, light page column (`#e8e8ec` bg, pages white with shadow), fixed toolbar top; `@font-face PackPDF Sans` → `url('./assets/NotoSans-Regular.ttf')`; `.textbox` absolute, transparent bg, `outline: 1px dashed transparent` → visible on hover/selected/editing; crosshair cursor for pen/text, custom cursor for eraser.
- [ ] **Build clean → Commit** `feat: page view, textbox editing, toolbar UI`

---

### Task 8: main.ts (app wiring)

**Files:**
- Modify: `src/main.ts`
- Consumes: everything above.

- [ ] **App state & boot:** build Toolbar + empty-state drop zone ("Drop a PDF here or click Open"); hidden `<input type=file accept="application/pdf">`; drag-drop on window (prevent default, take first `.pdf`).
- [ ] **openFile(file):** if dirty → `confirm('Discard annotations on the current PDF?')`; read `ArrayBuffer` → keep as `originalBytes`; `loadPdf` (remember: pass copy to pdf.js); tear down old PageViews; create one PageView per page into `.pages` scroll container; IntersectionObserver (`rootMargin: '600px 0px'`) drives `renderCanvasIfVisible`; default zoom = fit-width (`(scrollBox.clientWidth − 48) / max(info.width)`, clamped 0.5–3); store/history cleared; errors (encrypted/corrupt) → inline error banner, app stays on empty state.
- [ ] **save():** fetch font bytes once (`import fontUrl from './assets/NotoSans-Regular.ttf?url'`); `savePdf({originalBytes, fontBytes, annotations: store.all(), pageGeoms})`; Blob download `<base>-annotated.pdf`; clear dirty; failures → error banner, state untouched.
- [ ] **Wiring:** store.onChange → renderOverlay on affected pages + dirty=true + toolbar sync; history.onChange → toolbar sync; keyboard: V/P/T/E tools, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl+Y redo, Ctrl/Cmd+S save, Ctrl/Cmd+O open, Delete/Backspace remove selection — all skipped when target is a textarea/input; Ctrl/Cmd+wheel zoom (preventDefault); zoom buttons ×/÷1.15 clamp 0.25–4, re-render visible canvases debounced 150 ms; `beforeunload` guard when dirty.
- [ ] **Build + all tests green → Commit** `feat: app wiring, open/save, zoom, shortcuts`

---

### Task 9: End-to-end verification

- [ ] `npm test` all green; `npm run build` clean.
- [ ] Generate `scratch sample: 3-page PDF via pdf-lib node script (headings + lines of text)`.
- [ ] Live browser (dev server + Chrome automation): open sample via file input; pen-draw on page 1; add textbox `"μ = 3.2 Ω"` on page 2; move it; erase one stroke; undo; redo; zoom in/out; Save; verify download exists, parses with pdf-lib, pdf.js text extraction contains the textbox string.
- [ ] Fix anything found (systematic-debugging if non-obvious), re-run tests.
- [ ] Commit `test: e2e verification fixes` (if changes) — final state green.

---

## Self-Review

- **Spec coverage:** textboxes ✓(T7/8), draw ✓(T7), save ✓(T5/8), undo/redo ✓(T4/7/8), colors/sizes ✓(T7), eraser/delete ✓(T7), move/edit ✓(T7), continuous scroll + lazy render ✓(T8), zoom ✓(T8), errors/beforeunload ✓(T8), fonts/fidelity ✓(T1/5/7), tests ✓(T2–5,9).
- **Placeholders:** none — every step names exact behavior, values, and formulas.
- **Type consistency:** `Matrix`/`Point` shared from T2; command factories (T4) used by T7/8; `PageInfo.transform` (T6) feeds `PageGeom.transform` (T5); `LINE_HEIGHT_FACTOR` 1.3 shared by CSS contract (T7) and `baselineOffsets` (T5). Names cross-checked.
