# PackPDF — PDF Annotation Editor Design

**Date:** 2026-07-30
**Status:** Approved

## Purpose

A simple, fast, client-side PDF editor for schoolwork (exams, homework, lab
handouts). Core loop: open a PDF → write on it (textboxes + freehand ink) →
save an annotated copy. No accounts, no persistence, one document at a time.

## Requirements

- Insert textboxes anywhere on any page; re-edit, move, restyle, delete them.
- Draw freehand anywhere with the mouse; erase whole strokes.
- Save the PDF with annotations flattened in as real vector paths and text.
- Undo/redo for every mutation (Ctrl+Z / Ctrl+Shift+Z).
- Color and size options for pen and text.
- Continuous vertical scroll through all pages; zoom.
- Fast and responsive; no persistent storage.

Out of scope (YAGNI): soft-wrap in textboxes (Enter makes new lines; boxes
auto-size to content), highlighter, shapes, stylus pressure, multi-document
tabs, cloud anything.

## Architecture

Vite + vanilla TypeScript single-page app; everything runs in the browser.

- **Render:** pdf.js (`pdfjs-dist`) renders each page into one `<canvas>`,
  stacked in a scrollable column.
- **Annotate:** each page has two overlay layers with the same footprint:
  an `<svg>` for ink strokes and a `<div>` layer for textboxes
  (auto-sizing `<textarea>`s, `white-space: pre`, `wrap="off"`).
- **State:** one in-memory `AnnotationStore` keyed by page index; overlays are
  views of it. Original PDF bytes are kept in memory.
- **Save:** pdf-lib + `@pdf-lib/fontkit` stamp annotations into a copy of the
  original bytes; browser downloads `<name>-annotated.pdf`.

### Module layout

```
src/
  main.ts           bootstrap + app wiring
  types.ts          Stroke, TextBox, Tool, styles
  coords.ts         viewport<->PDF-user-space transforms (pure)
  geometry.ts       point thinning, path smoothing, stroke hit-testing (pure)
  store.ts          AnnotationStore + change events (pure)
  history.ts        undo/redo command stack (pure)
  pdf/render.ts     pdf.js loading, lazy page rendering
  pdf/save.ts       pdf-lib export pipeline (pure w.r.t. DOM)
  ui/toolbar.ts     toolbar DOM + bindings
  ui/pageView.ts    per-page canvas + overlays + pointer handlers
  ui/textbox.ts     textarea create/edit/drag behavior
  styles.css
```

Pure modules (`coords`, `geometry`, `store`, `history`, `pdf/save`) have no
DOM dependency and are unit-tested with vitest (save runs in node).

## Coordinate system

Annotations are stored in **scale-1 pdf.js viewport coordinates** (top-left
origin, y-down), never screen pixels.

- **Render:** multiply by current zoom (SVG `viewBox` at scale-1 size + CSS
  size at zoomed size does this for free).
- **Save:** invert the page's scale-1 viewport transform to get PDF user-space
  coordinates. This goes through the actual pdf.js viewport transform matrix,
  so page `/Rotate` values (90/180/270) are handled correctly.
- Strokes map point-by-point (affine-safe, including Bézier control points).
  Text anchors map per line; glyph direction is compensated with
  `rotate: degrees(-pageRotation)` on rotated pages.

## Tools & interactions

Toolbar: Select / Pen / Text / Eraser modes; color swatches + custom color;
pen width presets; font size; zoom out/in/percent (fit-width default);
undo/redo; Open; Save.

- **Pen:** pointerdown starts a stroke; points append to a live SVG path
  (rAF-batched, distance-thinned, midpoint-quadratic smoothing); pointerup
  commits `{points, color, width}` to the store as one undo entry.
- **Text:** click places a textbox and focuses it immediately. Auto-sizes to
  content. Blur with empty text removes it. Double-click (Select mode)
  re-edits; drag moves (DOM-direct during drag, one undo entry on release).
- **Eraser:** drag deletes any stroke whose polyline passes within a threshold
  of the pointer's path segment (segment-distance math, robust to fast mouse
  movement); clicking a textbox deletes it.
- **Select:** click stroke/textbox to select; drag textboxes; Delete/Backspace
  removes selection.
- **Keyboard:** V/P/T/E switch tools; Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/
  redo; Ctrl+S saves (preventDefault); Ctrl+scroll zooms.

## Undo/redo

Command stack of `{do, undo}` action objects with inverse data; executing a
new command truncates the redo tail. Text edits coalesce per focus session
(snapshot on focus, single command on blur if changed). Drags coalesce to one
command on release.

## Save fidelity

- **Ink:** shared SVG path `d` string (same smoothing as on-screen) drawn via
  `page.drawSvgPath` with round caps/joins; coordinates pre-mapped to user
  space (y negated to cancel drawSvgPath's y-down convention), so rotated
  pages work.
- **Text:** bundled Noto Sans TTF (OFL) embedded via fontkit — covers Latin,
  Greek (μ, Ω), Cyrillic; pdf-lib's built-in Helvetica would throw on those.
  The same font renders on-screen textboxes via `@font-face`, so screen ==
  saved output. Per-line baseline anchors computed with real font metrics
  (ascent/descent/unitsPerEm, CSS half-leading model) at a fixed 1.3
  line-height; each line converts and draws independently.

## Performance

- Lazy page rendering via IntersectionObserver; placeholder boxes sized from
  page metadata until near viewport; render tasks cancelled when superseded.
- `devicePixelRatio`-aware canvas backing store.
- Zoom: CSS resize immediately, debounced canvas re-render for crispness.
- Live drawing and drags bypass the store until commit.

## Error handling

- Corrupt/unsupported/encrypted PDFs → friendly inline error, app stays usable.
- Save failure → error message; in-memory annotations untouched.
- `beforeunload` warning and open-new-file confirm while unsaved annotations
  exist.

## Testing

- vitest: `coords` (transform + inverse, all four rotations), `geometry`
  (thinning, smoothing, hit-testing), `store`, `history` (incl. coalescing),
  `pdf/save` round-trip in node (output parses; content stream grows; text
  extractable).
- `tsc --noEmit` + production build must pass.
- Manual + scripted browser verification: open sample PDF, draw, type, move,
  erase, undo, zoom, save, and validate the downloaded file.
