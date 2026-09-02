# PackPDF - A fast, client-side, 100% vibecoded PDF editor that I use for my schoolwork

Open a PDF, add textboxes, freehand ink, syntax-highlighted code blocks, 
LaTeX math, and Excalidraw diagrams anywhere, then save an annotated copy. 
No server, no storage — everything stays in your browser. Built with React 19.

## Usage

```sh
npm install
npm run dev     # open the printed localhost URL
```

Open a PDF (button or drag-drop), annotate, hit **Save** to download
`<name>-annotated.pdf`.

Tools: **V** select · **P** pen · **H** highlighter · **T** text · **E** eraser ·
**C** code block · **M** math formula · **D** diagram ·
Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo · Ctrl/Cmd+S save · Ctrl/Cmd+scroll zoom.

- **Code blocks** edit in CodeMirror 6 and render via Shiki (github-light);
  they flatten into the saved PDF as real selectable colored text in Noto Sans
  Mono. Language picker appears while a block is selected (C default).
- **Math** edits in a MathLive field (type LaTeX like `\frac{1}{2}`), renders
  via MathJax SVG, and saves as a crisp 4x raster in the chosen pen color.
- **Diagrams** open a full Excalidraw editor in a modal; scenes stay editable
  (double-click) and save as 3x rasters with transparent background.

## Desktop app (Tauri)

The same frontend ships as a native macOS app: `npm run tauri build` produces
`src-tauri/target/release/bundle/macos/packPDF.app` (and a `.dmg` alongside).
The desktop build opens PDFs via Finder / "Open With" file association, saves
through a native Save As dialog instead of a browser download, and confirms
before closing with unsaved annotations. `npm run tauri dev` runs it against
the Vite dev server.

## Development

- `npm test` — vitest unit suite (transforms, geometry, store, history, save pipeline)
- `npm run build` — typecheck + production build

## Font attribution

Bundles [Noto Sans](https://notofonts.github.io/) (`src/assets/NotoSans-Regular.ttf`),
© Google, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
It renders textboxes on screen and is embedded (subset) into saved PDFs.
