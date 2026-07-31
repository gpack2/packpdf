# React migration + rich annotations (code / math / diagrams)

Approved direction from brainstorming (2026-07-31). Four phases, sequential,
one commit per phase minimum. Each later phase assumes the previous landed.

## Decisions of record

- React 19 migration first; Excalidraw requires React, everything else rides along.
- Code: CodeMirror 6 edits, Shiki (github-light) renders static view AND emits
  the tokens flattened into the PDF as colored vector text runs (Noto Sans Mono,
  subset-embedded only when a code block exists).
- Math: MathLive `<math-field>` is the input widget (emits LaTeX). MathJax
  (SVG output) renders static display and save-time rasterization. KaTeX was
  dropped: HTML-only output would force foreignObject rasterization, which is
  unreliable in WKWebView (the Tauri shell's engine).
- Diagrams: Excalidraw in a modal editor; scene JSON stored on the annotation;
  static display via exportToSvg; PDF flattening via exportToBlob PNG at 3x.
- savePdf stays DOM-free and unit-testable: browser-side code precomputes
  "render assets" (Shiki token lines, math PNGs, diagram PNGs) keyed by
  annotation id and passes them in alongside the annotations.

## Phase 0 — React migration (behavior-identical)

- Unchanged: store.ts, history.ts, types.ts, coords.ts, geometry.ts, pdf/*,
  desktop.ts, all Rust/Tauri code, all 39 existing tests.
- App state (tool, color, zoom, selection) becomes a tiny observable store;
  both stores bridge to React via useSyncExternalStore.
- <App> owns banner, drag-drop, shortcuts, open/save orchestration.
  <Toolbar> pure props. <Page> keeps pdf.js canvas, IntersectionObserver
  gating, and zoom scroll-pinning imperative behind refs. Overlay annotations
  are React components; textbox port preserves the drag/edit/blur state
  machine and one-undo-per-editing-session coalescing.
- Single cut-over on main; parity checklist: place/edit/drag/erase, undo
  coalescing, zoom pinning (wheel + buttons + fit), file open (button, drop,
  OS event), save (browser download / native dialog), dirty guards, banner.
- New tests: Vitest + jsdom + RTL for draft textbox lifecycle, eraser,
  undo coalescing.

## Phase 1 — code blocks

- Type: { id, kind:'code', page, x, y, code, fontSize, lang } (lang defaults
  to 'c'; curated Shiki languages: c, cpp, python, rust, javascript,
  typescript, java, bash, json).
- Card look: #f6f8fa bg, 1px #d0d7de border, 6px radius, 10px padding,
  Noto Sans Mono. Same card drawn in the PDF (rect + border + token runs).
- Editing: CM6 (lang-cpp etc. per lang, theme matched to github-light);
  static: Shiki codeToHtml. Tab = 2 spaces. Empty on blur evaporates.
- Tool key C. Language picker: small select shown only while selected.
- savePdf gains monoFontBytes + codeTokens (Map<id, TokenLine[]>, TokenLine =
  {text, color}[]). Tests inject tokens directly.

## Phase 2 — math

- Type: { id, kind:'math', page, x, y, tex, fontSize, color }.
- math.ts: texToSvg(tex, fontSize) via mathjax-full liteAdaptor (node-safe,
  testable). Static display: inline SVG. Editing: MathLive math-field +
  live preview; fonts self-hosted under public/vendor/mathlive.
- Save: browser rasterizes SVG -> canvas at 4x -> PNG bytes; savePdf gets
  mathImages (Map<id, {png, width, height}>) and places at box position with
  the page's inverse transform + rotation.
- Tool key M. Color follows toolbar color (SVG fill / currentColor).

## Phase 3 — diagrams

- Type: { id, kind:'diagram', page, x, y, width, height, scene } (scene =
  serialized Excalidraw JSON).
- Tool key D: click places a default 320x220 box and opens a modal Excalidraw
  editor; Save/Cancel buttons; double-click reopens. Static display: cached
  exportToSvg result. Empty scenes evaporate on save.
- PDF: exportToBlob PNG at 3x -> diagramImages map into savePdf.
- Self-host Excalidraw fonts/assets (EXCALIDRAW_ASSET_PATH) so the Tauri app
  works offline.

## Verification (every phase)

npm test + npm run build green; Chrome pass against vite preview; final
phase adds a node flatten-check script (each kind -> output PDF read
visually) and a Tauri release rebuild + launch.
