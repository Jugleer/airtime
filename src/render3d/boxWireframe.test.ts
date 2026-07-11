import { describe, expect, it } from 'vitest';
import { boxEdgePositions } from './boxWireframe';

type Segment = [number, number, number, number, number, number];

/** Split a flat xyz buffer into 12 [ax,ay,az, bx,by,bz] segments. */
function segments(buffer: Float32Array): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < buffer.length; i += 6) {
    out.push([buffer[i]!, buffer[i + 1]!, buffer[i + 2]!, buffer[i + 3]!, buffer[i + 4]!, buffer[i + 5]!]);
  }
  return out;
}

describe('boxEdgePositions', () => {
  it('emits 12 edges (24 vertices, 72 floats)', () => {
    const buffer = boxEdgePositions([-1, -1, -1], [1, 1, 1]);
    expect(buffer).toBeInstanceOf(Float32Array);
    expect(buffer.length).toBe(72);
    expect(segments(buffer)).toHaveLength(12);
  });

  it('every edge is axis-aligned (endpoints differ in exactly one coordinate)', () => {
    for (const [ax, ay, az, bx, by, bz] of segments(boxEdgePositions([-2, -1, -3], [2, 1, 3]))) {
      const differing = [ax !== bx, ay !== by, az !== bz].filter(Boolean).length;
      expect(differing).toBe(1);
    }
  });

  it('has no degenerate (zero-length) edges for a non-degenerate box', () => {
    for (const [ax, ay, az, bx, by, bz] of segments(boxEdgePositions([-1, -1, -1], [1, 1, 1]))) {
      expect(Math.hypot(bx - ax, by - ay, bz - az)).toBeGreaterThan(0);
    }
  });

  it('spans exactly the 8 corners of the box, each used in 3 edges', () => {
    const min: [number, number, number] = [-1, -0.5, -2];
    const max: [number, number, number] = [1, 0.5, 2];
    const counts = new Map<string, number>();
    for (const [ax, ay, az, bx, by, bz] of segments(boxEdgePositions(min, max))) {
      for (const key of [`${ax},${ay},${az}`, `${bx},${by},${bz}`]) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        // Each coordinate must be one of the box bounds on its axis.
      }
    }
    // 8 distinct corners, each meeting 3 edges (a cube's degree-3 vertices).
    expect(counts.size).toBe(8);
    for (const n of counts.values()) {
      expect(n).toBe(3);
    }
    for (const key of counts.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      expect([min[0], max[0]]).toContain(x);
      expect([min[1], max[1]]).toContain(y);
      expect([min[2], max[2]]).toContain(z);
    }
  });

  it('uses the given bounds (not a unit box)', () => {
    const buffer = boxEdgePositions([0, 0, 0], [3, 4, 5]);
    // All coordinates must be within [0, max] on their axis.
    for (const seg of segments(buffer)) {
      expect(seg[0]).toBeGreaterThanOrEqual(0);
      expect(seg[0]).toBeLessThanOrEqual(3);
      expect(seg[1]).toBeLessThanOrEqual(4);
      expect(seg[2]).toBeLessThanOrEqual(5);
    }
  });
});
