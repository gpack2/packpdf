import type { Point } from './types';

/** Affine transform [a, b, c, d, e, f] mapping (x, y) -> (a*x + c*y + e, b*x + d*y + f). */
export type Matrix = [number, number, number, number, number, number];

export type Rotation = 0 | 90 | 180 | 270;

export function applyTransform(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export function invertTransform(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

/**
 * The scale-1 pdf.js PageViewport transform for a page with viewBox
 * [0, 0, w, h]. Maps PDF user space (bottom-left origin, y-up) to viewport
 * space (top-left origin, y-down).
 */
export function viewportTransform(w: number, h: number, rotation: Rotation): Matrix {
  switch (rotation) {
    case 90:
      return [0, 1, 1, 0, 0, 0];
    case 180:
      return [-1, 0, 0, 1, w, 0];
    case 270:
      return [0, -1, -1, 0, h, w];
    default:
      return [1, 0, 0, -1, 0, h];
  }
}

export function viewportSize(
  w: number,
  h: number,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export function normalizeRotation(deg: number): Rotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}
