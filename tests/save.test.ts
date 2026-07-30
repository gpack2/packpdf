import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { viewportTransform, type Rotation } from '../src/coords';
import { baselineOffsets, hexToRgb01, savePdf, type SaveInput } from '../src/pdf/save';
import type { Annotation } from '../src/types';

const fontBytes = new Uint8Array(readFileSync('src/assets/NotoSans-Regular.ttf'));

async function makeSourcePdf(rotation: Rotation): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Original content', { x: 72, y: 700, size: 18, font: helv });
  if (rotation !== 0) {
    const { degrees } = await import('pdf-lib');
    page.setRotation(degrees(rotation));
  }
  return doc.save();
}

function sampleAnnotations(): Annotation[] {
  return [
    {
      id: 's1',
      kind: 'stroke',
      page: 0,
      points: [
        { x: 100, y: 100 },
        { x: 150, y: 120 },
        { x: 200, y: 100 },
      ],
      color: '#e0322b',
      width: 4,
    },
    {
      id: 'h1',
      kind: 'stroke',
      page: 0,
      points: [
        { x: 70, y: 300 },
        { x: 250, y: 300 },
      ],
      color: '#ffe600',
      width: 12,
      opacity: 0.4,
    },
    {
      id: 't1',
      kind: 'text',
      page: 0,
      x: 72,
      y: 200,
      text: 'μ = 0.5\nΩ line2',
      color: '#2563eb',
      fontSize: 14,
    },
  ];
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  }
  await task.destroy();
  return out;
}

describe('hexToRgb01', () => {
  it('parses 6-digit hex', () => {
    const c = hexToRgb01('#ff0080');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(128 / 255);
  });

  it('parses 3-digit hex', () => {
    const c = hexToRgb01('#f08');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(136 / 255);
  });
});

describe('baselineOffsets', () => {
  it('computes CSS half-leading baselines', () => {
    const { first, lineHeight } = baselineOffsets(
      { ascent: 1069, descent: -293, unitsPerEm: 1000 },
      14,
    );
    expect(lineHeight).toBeCloseTo(18.2, 5);
    expect(first).toBeCloseTo(14.532, 3);
  });
});

describe('savePdf', () => {
  let original: Uint8Array;

  beforeAll(async () => {
    original = await makeSourcePdf(0);
  });

  it('produces a loadable PDF with the annotations flattened in', async () => {
    const input: SaveInput = {
      originalBytes: original,
      fontBytes,
      annotations: sampleAnnotations(),
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
    };
    const out = await savePdf(input);
    expect(out.byteLength).toBeGreaterThan(original.byteLength);

    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);

    const text = await extractText(out);
    expect(text).toContain('Original content');
    expect(text).toContain('μ = 0.5');
    expect(text).toContain('Ω line2');
  }, 30000);

  it('handles rotated pages', async () => {
    const rotated = await makeSourcePdf(90);
    const input: SaveInput = {
      originalBytes: rotated,
      fontBytes,
      annotations: sampleAnnotations(),
      pageGeoms: [{ transform: viewportTransform(612, 792, 90), rotation: 90 }],
    };
    const out = await savePdf(input);
    const text = await extractText(out);
    expect(text).toContain('μ = 0.5');
    expect(text).toContain('Ω line2');
  }, 30000);

  it('leaves the original bytes untouched and skips empty pages/lines', async () => {
    const before = original.slice();
    const input: SaveInput = {
      originalBytes: original,
      fontBytes,
      annotations: [
        { id: 't2', kind: 'text', page: 0, x: 10, y: 10, text: 'a\n\nb', color: '#000000', fontSize: 12 },
      ],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
    };
    const out = await savePdf(input);
    expect(original).toEqual(before);
    const text = await extractText(out);
    expect(text).toContain('a');
    expect(text).toContain('b');
  }, 30000);
});
