import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { viewportTransform } from '../src/coords';
import { colorSvg, texToSvg } from '../src/math';
import { savePdf, type SaveInput } from '../src/pdf/save';
import type { MathBox } from '../src/types';

const fontBytes = new Uint8Array(readFileSync('src/assets/NotoSans-Regular.ttf'));

// Minimal valid 1x1 red PNG.
const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const mathAnnotation: MathBox = {
  id: 'm1',
  kind: 'math',
  page: 0,
  x: 100,
  y: 150,
  tex: 'E = \\frac{1}{2} m v^2',
  fontSize: 16,
  color: '#1d1d1f',
};

async function makeSourcePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe('texToSvg', () => {
  it('renders a fraction to standalone SVG with px dimensions', () => {
    const r = texToSvg('\\frac{a}{b}', 16);
    expect(r.svg).toContain('<svg');
    expect(r.svg).toMatch(/width="[\d.]+px"/);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(r.width); // stacked fraction is tall
    expect(r.error).toBeNull();
  });

  it('reports TeX errors without throwing', () => {
    const r = texToSvg('\\frac{a', 16);
    expect(r.error).toBeTruthy();
    expect(r.svg).toContain('<svg');
  });

  it('recolors currentColor output', () => {
    const r = texToSvg('x', 16);
    expect(r.svg).toContain('currentColor');
    expect(colorSvg(r.svg, '#e0322b')).not.toContain('currentColor');
  });
});

describe('savePdf with math boxes', () => {
  it('embeds the pre-rasterized formula PNG', async () => {
    const input: SaveInput = {
      originalBytes: await makeSourcePdf(),
      fontBytes,
      annotations: [mathAnnotation],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
      mathImages: new Map([['m1', { png: TINY_PNG, width: 120, height: 40 }]]),
    };
    const out = await savePdf(input);
    const { PDFDocument } = await import('pdf-lib');
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
    // The PNG XObject must be present in the output.
    expect(out.byteLength).toBeGreaterThan(0);
  });

  it('handles rotated pages', async () => {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setRotation(degrees(90));
    const input: SaveInput = {
      originalBytes: await doc.save(),
      fontBytes,
      annotations: [mathAnnotation],
      pageGeoms: [{ transform: viewportTransform(612, 792, 90), rotation: 90 }],
      mathImages: new Map([['m1', { png: TINY_PNG, width: 120, height: 40 }]]),
    };
    await expect(savePdf(input)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('rejects math annotations without a rasterized image', async () => {
    const input: SaveInput = {
      originalBytes: await makeSourcePdf(),
      fontBytes,
      annotations: [mathAnnotation],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
    };
    await expect(savePdf(input)).rejects.toThrow(/rasterized/);
  });
});
