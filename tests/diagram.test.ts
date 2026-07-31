import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { viewportTransform } from '../src/coords';
import { savePdf, type SaveInput } from '../src/pdf/save';
import type { DiagramBox } from '../src/types';

const fontBytes = new Uint8Array(readFileSync('src/assets/NotoSans-Regular.ttf'));

const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const diagram: DiagramBox = {
  id: 'd1',
  kind: 'diagram',
  page: 0,
  x: 80,
  y: 400,
  scene: '{"elements":[],"files":{}}',
};

async function makeSourcePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe('savePdf with diagrams', () => {
  it('embeds the pre-rasterized diagram PNG', async () => {
    const input: SaveInput = {
      originalBytes: await makeSourcePdf(),
      fontBytes,
      annotations: [diagram],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
      diagramImages: new Map([['d1', { png: TINY_PNG, width: 320, height: 220 }]]),
    };
    const out = await savePdf(input);
    const { PDFDocument } = await import('pdf-lib');
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('rejects diagram annotations without a rasterized image', async () => {
    const input: SaveInput = {
      originalBytes: await makeSourcePdf(),
      fontBytes,
      annotations: [diagram],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
    };
    await expect(savePdf(input)).rejects.toThrow(/rasterized/);
  });
});
