import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { plainTokens, tokenizeCode } from '../src/code';
import { viewportTransform } from '../src/coords';
import { savePdf, type SaveInput } from '../src/pdf/save';
import { CODE_FG, type CodeBlock, type TokenLine } from '../src/types';

const fontBytes = new Uint8Array(readFileSync('src/assets/NotoSans-Regular.ttf'));
const monoFontBytes = new Uint8Array(readFileSync('src/assets/NotoSansMono-Regular.ttf'));

const C_SAMPLE = `#include <stdio.h>

int main(void) {
    // count to ten
    for (int i = 0; i < 10; i++)
        printf("i = %d\\n", i);
    return 0;
}`;

async function makeSourcePdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
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

const codeAnnotation: CodeBlock = {
  id: 'c1',
  kind: 'code',
  page: 0,
  x: 60,
  y: 80,
  code: C_SAMPLE,
  fontSize: 11,
  lang: 'c',
};

describe('tokenizeCode', () => {
  it('preserves the source text exactly and colors distinct token kinds', async () => {
    const lines = await tokenizeCode(C_SAMPLE, 'c');
    const rejoined = lines.map((l) => l.map((r) => r.text).join('')).join('\n');
    expect(rejoined).toBe(C_SAMPLE);
    const colors = new Set(lines.flat().map((r) => r.color));
    expect(colors.size).toBeGreaterThan(2); // keywords, strings, comments differ
  }, 30000);

  it('plainTokens falls back to single-color lines', () => {
    const lines = plainTokens('a\nb');
    expect(lines).toEqual([
      [{ text: 'a', color: CODE_FG }],
      [{ text: 'b', color: CODE_FG }],
    ]);
  });
});

describe('savePdf with code blocks', () => {
  it('flattens code as selectable mono text', async () => {
    const tokens = new Map<string, TokenLine[]>([['c1', await tokenizeCode(C_SAMPLE, 'c')]]);
    const input: SaveInput = {
      originalBytes: await makeSourcePdf(),
      fontBytes,
      annotations: [codeAnnotation],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
      monoFontBytes,
      codeTokens: tokens,
    };
    const text = await extractText(await savePdf(input));
    expect(text).toContain('#include');
    expect(text).toContain('printf');
    // Each token draws as its own positioned run; extraction pads run joins.
    expect(text.replace(/\s+/g, ' ')).toContain('return 0;');
  }, 30000);

  it('flattens code on rotated pages', async () => {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setRotation(degrees(90));
    const input: SaveInput = {
      originalBytes: await doc.save(),
      fontBytes,
      annotations: [codeAnnotation],
      pageGeoms: [{ transform: viewportTransform(612, 792, 90), rotation: 90 }],
      monoFontBytes,
      codeTokens: new Map([['c1', plainTokens(C_SAMPLE)]]),
    };
    const text = await extractText(await savePdf(input));
    expect(text).toContain('printf');
  }, 30000);

  it('rejects code annotations without mono font bytes', async () => {
    const input: SaveInput = {
      originalBytes: await makeSourcePdf(),
      fontBytes,
      annotations: [codeAnnotation],
      pageGeoms: [{ transform: viewportTransform(612, 792, 0), rotation: 0 }],
    };
    await expect(savePdf(input)).rejects.toThrow(/monoFontBytes/);
  });
});
