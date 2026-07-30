import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { normalizeRotation, type Matrix, type Rotation } from '../coords';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageInfo {
  index: number;
  rotation: Rotation;
  /** Scale-1 viewport transform (PDF user space -> viewport space). */
  transform: Matrix;
  /** Scale-1 viewport CSS size. */
  width: number;
  height: number;
  page: PDFPageProxy;
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  pages: PageInfo[];
}

/**
 * Loads a PDF with pdf.js. Always pass a copy of the bytes: pdf.js transfers
 * the buffer to its worker and detaches it, and the caller's original bytes
 * must stay usable for the pdf-lib save path.
 */
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      index: i - 1,
      rotation: normalizeRotation(page.rotate),
      transform: viewport.transform as Matrix,
      width: viewport.width,
      height: viewport.height,
      page,
    });
  }
  return { doc, pages };
}

export interface RenderHandle {
  done: Promise<void>;
  cancel(): void;
}

/**
 * Renders a page into the canvas at the given zoom, devicePixelRatio-aware.
 * Cancelling is safe at any time; cancellation errors are swallowed.
 */
export function renderPage(info: PageInfo, canvas: HTMLCanvasElement, zoom: number): RenderHandle {
  const dpr = window.devicePixelRatio || 1;
  const viewport = info.page.getViewport({ scale: zoom * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${info.width * zoom}px`;
  canvas.style.height = `${info.height * zoom}px`;
  const task = info.page.render({ canvas, viewport });
  const done = task.promise.catch((err: unknown) => {
    if ((err as Error | undefined)?.name !== 'RenderingCancelledException') throw err;
  });
  return {
    done,
    cancel: () => task.cancel(),
  };
}
