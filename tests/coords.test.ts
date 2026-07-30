import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  invertTransform,
  viewportSize,
  viewportTransform,
  type Matrix,
} from '../src/coords';

const W = 612;
const H = 792;

describe('viewportTransform', () => {
  it('matches pdf.js scale-1 matrices for all rotations', () => {
    expect(viewportTransform(W, H, 0)).toEqual([1, 0, 0, -1, 0, H]);
    expect(viewportTransform(W, H, 90)).toEqual([0, 1, 1, 0, 0, 0]);
    expect(viewportTransform(W, H, 180)).toEqual([-1, 0, 0, 1, W, 0]);
    expect(viewportTransform(W, H, 270)).toEqual([0, -1, -1, 0, H, W]);
  });

  it('maps PDF corners to expected viewport corners at rotation 0', () => {
    const m = viewportTransform(W, H, 0);
    // PDF origin is bottom-left; viewport origin is top-left.
    expect(applyTransform(m, { x: 0, y: H })).toEqual({ x: 0, y: 0 });
    expect(applyTransform(m, { x: 0, y: 0 })).toEqual({ x: 0, y: H });
    expect(applyTransform(m, { x: W, y: H })).toEqual({ x: W, y: 0 });
  });

  it('maps PDF corners into the rotated viewport box', () => {
    for (const r of [90, 270] as const) {
      const m = viewportTransform(W, H, r);
      const { width, height } = viewportSize(W, H, r);
      expect({ width, height }).toEqual({ width: H, height: W });
      for (const p of [
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: 0, y: H },
        { x: W, y: H },
      ]) {
        const v = applyTransform(m, p);
        expect(v.x === 0 || v.x === width).toBe(true);
        expect(v.y === 0 || v.y === height).toBe(true);
      }
    }
  });
});

describe('invertTransform', () => {
  it('round-trips points through every rotation', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 123.5, y: 456.25 },
      { x: W, y: H },
      { x: 17, y: 700 },
    ];
    for (const r of [0, 90, 180, 270] as const) {
      const m = viewportTransform(W, H, r);
      const inv = invertTransform(m);
      for (const p of pts) {
        const back = applyTransform(inv, applyTransform(m, p));
        expect(back.x).toBeCloseTo(p.x, 8);
        expect(back.y).toBeCloseTo(p.y, 8);
      }
    }
  });

  it('inverts a scaled/translated matrix', () => {
    const m: Matrix = [2, 0, 0, 3, 10, 20];
    const inv = invertTransform(m);
    const back = applyTransform(inv, applyTransform(m, { x: 5, y: 7 }));
    expect(back.x).toBeCloseTo(5, 10);
    expect(back.y).toBeCloseTo(7, 10);
  });
});
