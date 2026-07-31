import fontkit from '@pdf-lib/fontkit';
import { BlendMode, LineCapStyle, PDFDocument, degrees, rgb } from 'pdf-lib';
import { applyTransform, invertTransform, type Matrix, type Rotation } from '../coords';
import { strokePathD } from '../geometry';
import {
  CODE_BG,
  CODE_BORDER,
  CODE_FG,
  CODE_LINE_HEIGHT,
  CODE_PAD,
  CODE_RADIUS,
  LINE_HEIGHT_FACTOR,
  type Annotation,
  type CodeBlock,
  type MathBox,
  type Stroke,
  type TextBox,
  type TokenLine,
} from '../types';

/** Pre-rasterized image for an annotation, sized in scale-1 viewport units. */
export interface RasterAsset {
  png: Uint8Array;
  width: number;
  height: number;
}

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
  /** Required when any code annotation is present. */
  monoFontBytes?: Uint8Array;
  /** Colored token runs per code annotation id; plain-text fallback if absent. */
  codeTokens?: Map<string, TokenLine[]>;
  /** Pre-rasterized formula PNGs keyed by math annotation id (required per math annotation). */
  mathImages?: Map<string, RasterAsset>;
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
  lineHeightFactor: number = LINE_HEIGHT_FACTOR,
): { first: number; lineHeight: number } {
  const lineHeight = lineHeightFactor * fontSize;
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

  let mono: Awaited<ReturnType<PDFDocument['embedFont']>> | null = null;
  let monoMetrics: FontMetrics | null = null;
  if (input.annotations.some((a) => a.kind === 'code')) {
    if (!input.monoFontBytes) throw new Error('code annotations present without monoFontBytes');
    mono = await doc.embedFont(input.monoFontBytes, { subset: true });
    const mfk = fontkit.create(input.monoFontBytes);
    monoMetrics = { ascent: mfk.ascent, descent: mfk.descent, unitsPerEm: mfk.unitsPerEm };
  }

  const pages = doc.getPages();

  for (const a of input.annotations) {
    const page = pages[a.page];
    const geom = input.pageGeoms[a.page];
    if (!page || !geom) continue;
    const inv = invertTransform(geom.transform);
    switch (a.kind) {
      case 'stroke':
        drawStroke(page, a, inv);
        break;
      case 'text':
        drawTextBox(page, a, inv, geom.rotation, font, metrics);
        break;
      case 'code': {
        const lines =
          input.codeTokens?.get(a.id) ??
          a.code.split('\n').map((l) => [{ text: l, color: CODE_FG }]);
        drawCode(page, a, inv, geom.rotation, mono!, monoMetrics!, lines);
        break;
      }
      case 'math': {
        const asset = input.mathImages?.get(a.id);
        if (!asset) throw new Error(`math annotation ${a.id} without rasterized image`);
        await drawMath(doc, page, a, inv, geom.rotation, asset);
        break;
      }
    }
  }

  return doc.save();
}

/**
 * Places the pre-rasterized formula PNG. The anchor is the box's viewport
 * bottom-left corner mapped into user space; the rotate option then matches
 * drawText's behavior on /Rotate'd pages.
 */
async function drawMath(
  doc: PDFDocument,
  page: PdfPage,
  m: MathBox,
  inv: Matrix,
  rotation: Rotation,
  asset: RasterAsset,
): Promise<void> {
  const image = await doc.embedPng(asset.png.slice());
  const anchor = applyTransform(inv, { x: m.x, y: m.y + asset.height });
  page.drawImage(image, {
    x: anchor.x,
    y: anchor.y,
    width: asset.width,
    height: asset.height,
    rotate: degrees(rotation),
  });
}

type PdfPage = ReturnType<PDFDocument['getPages']>[number];
type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

/**
 * Rounded-rect outline in viewport coordinates, mapped point-by-point through
 * the page's inverse transform (affine maps preserve the quadratic corner
 * control points), emitted in drawSvgPath's (x, -y) convention. Rotated pages
 * come out correctly because every coordinate is mapped, not just the origin.
 */
function roundedRectD(
  inv: Matrix,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const m = (px: number, py: number): string => {
    const u = applyTransform(inv, { x: px, y: py });
    return `${u.x} ${-u.y}`;
  };
  return [
    `M ${m(x + r, y)}`,
    `L ${m(x + w - r, y)}`,
    `Q ${m(x + w, y)} ${m(x + w, y + r)}`,
    `L ${m(x + w, y + h - r)}`,
    `Q ${m(x + w, y + h)} ${m(x + w - r, y + h)}`,
    `L ${m(x + r, y + h)}`,
    `Q ${m(x, y + h)} ${m(x, y + h - r)}`,
    `L ${m(x, y + r)}`,
    `Q ${m(x, y)} ${m(x + r, y)}`,
    'Z',
  ].join(' ');
}

/** Card rectangle plus per-token colored runs in the embedded mono font. */
function drawCode(
  page: PdfPage,
  cb: CodeBlock,
  inv: Matrix,
  rotation: Rotation,
  font: PdfFont,
  metrics: FontMetrics,
  lines: TokenLine[],
): void {
  const size = cb.fontSize;
  const lineHeight = CODE_LINE_HEIGHT * size;
  const contentW = Math.max(
    1,
    ...lines.map((l) => l.reduce((sum, t) => sum + font.widthOfTextAtSize(t.text, size), 0)),
  );
  const w = contentW + 2 * CODE_PAD;
  const h = Math.max(1, lines.length) * lineHeight + 2 * CODE_PAD;

  const bg = hexToRgb01(CODE_BG);
  const bd = hexToRgb01(CODE_BORDER);
  page.drawSvgPath(roundedRectD(inv, cb.x, cb.y, w, h, CODE_RADIUS), {
    x: 0,
    y: 0,
    color: rgb(bg.r, bg.g, bg.b),
    borderColor: rgb(bd.r, bd.g, bd.b),
    borderWidth: 1,
  });

  const { first } = baselineOffsets(metrics, size, CODE_LINE_HEIGHT);
  for (let i = 0; i < lines.length; i++) {
    let xOff = CODE_PAD;
    for (const run of lines[i] ?? []) {
      if (run.text.trim() !== '') {
        const anchor = applyTransform(inv, {
          x: cb.x + xOff,
          y: cb.y + CODE_PAD + first + i * lineHeight,
        });
        const { r, g, b } = hexToRgb01(run.color);
        page.drawText(run.text, {
          x: anchor.x,
          y: anchor.y,
          size,
          font,
          color: rgb(r, g, b),
          rotate: degrees(rotation),
        });
      }
      xOff += font.widthOfTextAtSize(run.text, size);
    }
  }
}

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
