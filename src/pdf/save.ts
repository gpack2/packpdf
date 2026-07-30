import fontkit from '@pdf-lib/fontkit';
import { BlendMode, LineCapStyle, PDFDocument, degrees, rgb } from 'pdf-lib';
import { applyTransform, invertTransform, type Matrix, type Rotation } from '../coords';
import { strokePathD } from '../geometry';
import { LINE_HEIGHT_FACTOR, type Annotation, type Stroke, type TextBox } from '../types';

export interface PageGeom {
  /** Scale-1 pdf.js viewport transform for the page. */
  transform: Matrix;
  rotation: Rotation;
}

export interface SaveInput {
  originalBytes: Uint8Array;
  fontBytes: Uint8Array;
  annotations: Annotation[];
  /** Indexed by page number. */
  pageGeoms: PageGeom[];
}

export interface FontMetrics {
  ascent: number;
  descent: number;
  unitsPerEm: number;
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * Baseline positions matching CSS line boxes (half-leading model) for a
 * textbox whose content starts at its top edge with zero padding.
 * `first` is the distance from the box top to the first baseline;
 * subsequent baselines are `first + i * lineHeight`.
 */
export function baselineOffsets(
  metrics: FontMetrics,
  fontSize: number,
): { first: number; lineHeight: number } {
  const lineHeight = LINE_HEIGHT_FACTOR * fontSize;
  const scale = fontSize / metrics.unitsPerEm;
  const content = (metrics.ascent - metrics.descent) * scale;
  const first = (lineHeight - content) / 2 + metrics.ascent * scale;
  return { first, lineHeight };
}

/**
 * Flattens annotations into a copy of the original PDF. All annotation
 * coordinates are scale-1 viewport coordinates; each page's inverse viewport
 * transform maps them into PDF user space, so rotated pages work.
 */
export async function savePdf(input: SaveInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.originalBytes.slice());
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(input.fontBytes, { subset: true });
  const fk = fontkit.create(input.fontBytes);
  const metrics: FontMetrics = {
    ascent: fk.ascent,
    descent: fk.descent,
    unitsPerEm: fk.unitsPerEm,
  };

  const pages = doc.getPages();

  for (const a of input.annotations) {
    const page = pages[a.page];
    const geom = input.pageGeoms[a.page];
    if (!page || !geom) continue;
    const inv = invertTransform(geom.transform);
    if (a.kind === 'stroke') drawStroke(page, a, inv);
    else drawTextBox(page, a, inv, geom.rotation, font, metrics);
  }

  return doc.save();
}

type PdfPage = ReturnType<PDFDocument['getPages']>[number];

function drawStroke(page: PdfPage, stroke: Stroke, inv: Matrix): void {
  if (stroke.points.length === 0) return;
  // drawSvgPath places path point (sx, sy) at (x + sx, y - sy); supplying
  // (u.x, -u.y) with origin (0, 0) lands each point exactly at user-space u.
  const mapped = stroke.points.map((p) => {
    const u = applyTransform(inv, p);
    return { x: u.x, y: -u.y };
  });
  const { r, g, b } = hexToRgb01(stroke.color);
  const highlight = stroke.opacity !== undefined && stroke.opacity < 1;
  page.drawSvgPath(strokePathD(mapped), {
    x: 0,
    y: 0,
    borderColor: rgb(r, g, b),
    borderWidth: stroke.width,
    borderLineCap: LineCapStyle.Round,
    borderOpacity: stroke.opacity ?? 1,
    ...(highlight ? { blendMode: BlendMode.Multiply } : {}),
  });
}

function drawTextBox(
  page: PdfPage,
  t: TextBox,
  inv: Matrix,
  rotation: Rotation,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  metrics: FontMetrics,
): void {
  const { first, lineHeight } = baselineOffsets(metrics, t.fontSize);
  const { r, g, b } = hexToRgb01(t.color);
  const lines = t.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Baseline anchor in viewport space; the inverse transform handles the
    // position, degrees(rotation) keeps glyphs upright on /Rotate'd pages.
    const anchor = applyTransform(inv, { x: t.x, y: t.y + first + i * lineHeight });
    page.drawText(line, {
      x: anchor.x,
      y: anchor.y,
      size: t.fontSize,
      font,
      color: rgb(r, g, b),
      rotate: degrees(rotation),
    });
  }
}
