export interface RasterImage {
  png: Uint8Array;
  /** Intrinsic size in scale-1 viewport units (CSS px). */
  width: number;
  height: number;
}

/**
 * Rasterizes standalone SVG markup to PNG bytes at `scale`x the given
 * intrinsic size. Pure-SVG input (MathJax, Excalidraw exports) rasterizes
 * reliably in every engine including WKWebView — no foreignObject involved.
 */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<RasterImage> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed to load'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
    });
    return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
