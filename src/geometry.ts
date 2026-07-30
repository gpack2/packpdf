import type { Point } from './types';

/**
 * Drops points closer than minDist to the last kept point. Always keeps the
 * first and last points so stroke endpoints stay exact.
 */
export function thinPoints(points: Point[], minDist = 1.5): Point[] {
  if (points.length <= 2) return points.slice();
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * SVG path for a stroke: midpoint-quadratic smoothing. Affine-safe, so the
 * same construction can be applied to transformed points on save.
 */
export function strokePathD(points: Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0]!;
  if (points.length === 1) {
    // Zero-ish-length segment renders as a dot with round line caps.
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x + 0.01)} ${fmt(p0.y)}`;
  }
  if (points.length === 2) {
    const p1 = points[1]!;
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i]!;
    const n = points[i + 1]!;
    d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt((c.x + n.x) / 2)} ${fmt((c.y + n.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

/** Distance from point p to segment ab. */
export function segmentDist(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

type Orientation = -1 | 0 | 1;

function orient(a: Point, b: Point, c: Point): Orientation {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

/** Minimum distance between two segments; 0 when they intersect. */
export function segmentSegmentDist(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    segmentDist(b1, a1, a2),
    segmentDist(b2, a1, a2),
    segmentDist(a1, b1, b2),
    segmentDist(a2, b1, b2),
  );
}

/**
 * True when the eraser swipe (from -> to) passes within threshold of any part
 * of the stroke polyline.
 */
export function eraserHits(stroke: Point[], from: Point, to: Point, threshold: number): boolean {
  if (stroke.length === 0) return false;
  if (stroke.length === 1) return segmentDist(stroke[0]!, from, to) <= threshold;
  for (let i = 0; i < stroke.length - 1; i++) {
    if (segmentSegmentDist(stroke[i]!, stroke[i + 1]!, from, to) <= threshold) return true;
  }
  return false;
}
