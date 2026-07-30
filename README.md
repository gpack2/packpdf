# PackPDF

A fast, client-side PDF annotation editor for schoolwork: open a PDF, add
textboxes and freehand ink anywhere, then save an annotated copy. No server,
no storage — everything stays in your browser.

## Usage

```sh
npm install
npm run dev     # open the printed localhost URL
```

Open a PDF (button or drag-drop), annotate, hit **Save** to download
`<name>-annotated.pdf`.

Tools: **V** select · **P** pen · **H** highlighter · **T** text · **E** eraser ·
Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo · Ctrl/Cmd+S save · Ctrl/Cmd+scroll zoom.

## Development

- `npm test` — vitest unit suite (transforms, geometry, store, history, save pipeline)
- `npm run build` — typecheck + production build

## Font attribution

Bundles [Noto Sans](https://notofonts.github.io/) (`src/assets/NotoSans-Regular.ttf`),
© Google, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
It renders textboxes on screen and is embedded (subset) into saved PDFs.
