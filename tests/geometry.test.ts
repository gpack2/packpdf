import { describe, expect, it } from 'vitest';
import {
  eraserHits,
  segmentDist,
  segmentSegmentDist,
  segmentsIntersect,
  strokePathD,
  thinPoints,
} from '../src/geometry';

describe('thinPoints', () => {
  it('keeps endpoints and drops clustered points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 }, // within 1.5 of previous kept point -> dropped
      { x: 10, y: 0 },
      { x: 10.2, y: 0.2 }, // clustered -> dropped, but it is the last point -> kept
    ];
    const out = thinPoints(pts, 1.5);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10.2, y: 0.2 });
    expect(out).toHaveLength(3); // (0,0), (10,0), (10.2,0.2)
  });

  it('passes short inputs through', () => {
    expect(thinPoints([])).toEqual([]);
    expect(thinPoints([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('strokePathD', () => {
  it('renders a dot for a single point', () => {
    expect(strokePathD([{ x: 3, y: 4 }])).toBe('M 3 4 L 3.01 4');
  });

  it('renders a line for two points', () => {
    expect(strokePathD([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M 0 0 L 10 5');
  });

  it('renders midpoint-quadratic smoothing for three points', () => {
    const d = strokePathD([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    // M p0, Q p1 mid(p1,p2), L p2
    expect(d).toBe('M 0 0 Q 10 0 10 5 L 10 10');
  });
});

describe('segmentDist', () => {
  it('measures perpendicular distance to the segment interior', () => {
    expect(segmentDist({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
  });

  it('measures distance to the nearest endpoint beyond the ends', () => {
    expect(segmentDist({ x: 14, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
  });

  it('handles degenerate zero-length segments', () => {
    expect(segmentDist({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });
});

describe('segmentsIntersect / segmentSegmentDist', () => {
  it('detects crossing segments', () => {
    const a1 = { x: 0, y: 0 };
    const a2 = { x: 10, y: 10 };
    const b1 = { x: 0, y: 10 };
    const b2 = { x: 10, y: 0 };
    expect(segmentsIntersect(a1, a2, b1, b2)).toBe(true);
    expect(segmentSegmentDist(a1, a2, b1, b2)).toBe(0);
  });

  it('measures the gap between parallel segments', () => {
    const d = segmentSegmentDist(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 4 },
      { x: 10, y: 4 },
    );
    expect(d).toBeCloseTo(4);
  });

  it('does not report intersection for disjoint collinear segments', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 }, { x: 6, y: 0 }),
    ).toBe(false);
  });

  it('reports intersection for overlapping collinear segments', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 3, y: 0 }, { x: 8, y: 0 }),
    ).toBe(true);
  });
});

describe('eraserHits', () => {
  const stroke = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ];

  it('hits when the eraser segment crosses the stroke', () => {
    expect(eraserHits(stroke, { x: 5, y: -5 }, { x: 5, y: 5 }, 2)).toBe(true);
  });

  it('hits when the eraser passes within the threshold', () => {
    expect(eraserHits(stroke, { x: 5, y: 1.5 }, { x: 15, y: 1.5 }, 2)).toBe(true);
  });

  it('misses when the eraser stays outside the threshold', () => {
    expect(eraserHits(stroke, { x: 5, y: 10 }, { x: 15, y: 10 }, 2)).toBe(false);
  });

  it('hits single-point strokes within the threshold', () => {
    expect(eraserHits([{ x: 3, y: 3 }], { x: 0, y: 0 }, { x: 6, y: 6 }, 1)).toBe(true);
    expect(eraserHits([{ x: 3, y: 3 }], { x: 10, y: 0 }, { x: 10, y: 6 }, 1)).toBe(false);
  });
});
