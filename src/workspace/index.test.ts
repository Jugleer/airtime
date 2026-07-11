import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { simToDisplay } from '../render3d/displayFrame';
import {
  DEFAULT_WORKSPACE_SCALE,
  outsideSpans,
  parseStl,
  pointInsideWorkspace,
  simOffsetToLocal,
  TETRA_VERTICES,
  violationBadge,
  violationOverSamples,
  type Point3,
  type Triangle,
  type WorkspaceConfig,
  type WorkspaceScale,
} from './index';

const ORIGIN: Point3 = { x: 0, y: 0, z: 0 };

function primitive(
  kind: 'sphere' | 'cube' | 'tetra',
  scale: WorkspaceScale = DEFAULT_WORKSPACE_SCALE,
): WorkspaceConfig {
  return { kind, scale, enabled: true };
}

const finite = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const scaleArb: fc.Arbitrary<WorkspaceScale> = fc.record({
  x: finite(0.1, 2),
  y: finite(0.1, 2),
  z: finite(0.1, 2),
});
const pointArb: fc.Arbitrary<Point3> = fc.record({
  x: finite(-3, 3),
  y: finite(-3, 3),
  z: finite(-3, 3),
});

describe('frame conversion (display-aligned local, ruling 3)', () => {
  it('matches render3d/displayFrame.simToDisplay for every offset (drift guard)', () => {
    fc.assert(
      fc.property(pointArb, (p) => {
        const local = simOffsetToLocal(p.x, p.y, p.z);
        const display = simToDisplay([p.x, p.y, p.z]);
        expect(local[0]).toBeCloseTo(display[0], 12);
        expect(local[1]).toBeCloseTo(display[1], 12);
        expect(local[2]).toBeCloseTo(display[2], 12);
      }),
    );
  });

  it('maps sim +y (up) onto display Z (up) and sim −z (front) onto display Y', () => {
    // Normalize any signed zero for the structural compare.
    const norm = (t: [number, number, number]): [number, number, number] => [t[0] + 0, t[1] + 0, t[2] + 0];
    // Vertical sim-up offset → display Z.
    expect(norm(simOffsetToLocal(0, 1, 0))).toEqual([0, 0, 1]);
    // Sim −z (front) → display +Y.
    expect(norm(simOffsetToLocal(0, 0, -1))).toEqual([0, 1, 0]);
    // Along the hand line is shared.
    expect(norm(simOffsetToLocal(1, 0, 0))).toEqual([1, 0, 0]);
  });
});

describe('primitive containment — the anchor and centered symmetry', () => {
  it('the anchor (center) is inside every primitive', () => {
    for (const kind of ['sphere', 'cube', 'tetra'] as const) {
      fc.assert(
        fc.property(scaleArb, pointArb, (scale, center) => {
          expect(pointInsideWorkspace(primitive(kind, scale), null, center, center)).toBe(true);
        }),
      );
    }
  });

  it('a point far outside is never inside', () => {
    for (const kind of ['sphere', 'cube', 'tetra'] as const) {
      const far: Point3 = { x: 100, y: 100, z: 100 };
      expect(pointInsideWorkspace(primitive(kind), null, ORIGIN, far)).toBe(false);
    }
  });
});

describe('boundary points (ruling 7)', () => {
  it('sphere: the +Z (up) semi-axis endpoint is on the boundary (inside)', () => {
    const scale = { x: 0.5, y: 0.7, z: 0.9 };
    // Display Z = sim y, so the up endpoint sits at sim y = scale.z.
    const onZ: Point3 = { x: 0, y: scale.z, z: 0 };
    expect(pointInsideWorkspace(primitive('sphere', scale), null, ORIGIN, onZ)).toBe(true);
    const justOut: Point3 = { x: 0, y: scale.z + 0.01, z: 0 };
    expect(pointInsideWorkspace(primitive('sphere', scale), null, ORIGIN, justOut)).toBe(false);
  });

  it('cube: a face-center along the hand line (display X = sim x) is on the boundary', () => {
    const scale = { x: 0.6, y: 0.6, z: 0.6 };
    expect(pointInsideWorkspace(primitive('cube', scale), null, ORIGIN, { x: 0.6, y: 0, z: 0 })).toBe(true);
    expect(pointInsideWorkspace(primitive('cube', scale), null, ORIGIN, { x: 0.61, y: 0, z: 0 })).toBe(false);
  });

  it('cube: corner is inside, just past a corner is outside', () => {
    const s = { x: 0.5, y: 0.5, z: 0.5 };
    // Corner at display (±1,±1,±1)·scale → sim (x=0.5, y=0.5 [Z], z=-0.5 [Y=+0.5]).
    expect(pointInsideWorkspace(primitive('cube', s), null, ORIGIN, { x: 0.5, y: 0.5, z: -0.5 })).toBe(true);
    expect(pointInsideWorkspace(primitive('cube', s), null, ORIGIN, { x: 0.51, y: 0.5, z: -0.5 })).toBe(false);
  });
});

describe('tetra — apex up (ruling 3)', () => {
  const tetra = primitive('tetra', { x: 1, y: 1, z: 1 });
  it('the apex (display +Z = sim +y) is a boundary vertex, just above is outside', () => {
    // Canonical apex at display Z=1 → sim y=1.
    expect(pointInsideWorkspace(tetra, null, ORIGIN, { x: 0, y: 1, z: 0 })).toBe(true);
    expect(pointInsideWorkspace(tetra, null, ORIGIN, { x: 0, y: 1.01, z: 0 })).toBe(false);
  });

  it('the base sits below the anchor (a point just under the base is outside)', () => {
    // Base plane at display Z = −1/3 → sim y = −1/3.
    expect(pointInsideWorkspace(tetra, null, ORIGIN, { x: 0, y: -0.32, z: 0 })).toBe(true);
    expect(pointInsideWorkspace(tetra, null, ORIGIN, { x: 0, y: -0.4, z: 0 })).toBe(false);
  });

  it('every canonical vertex is contained (boundary)', () => {
    for (const v of TETRA_VERTICES) {
      // Map display-local vertex back to a sim point: sim = displayToSim([X,Y,Z]) = [X, Z, -Y].
      const sim: Point3 = { x: v[0], y: v[2], z: -v[1] };
      expect(pointInsideWorkspace(tetra, null, ORIGIN, sim)).toBe(true);
    }
  });
});

describe('scale asymmetry (ruling 7)', () => {
  it('sphere: a point outside a narrow-X ellipsoid is inside once X is widened', () => {
    const p: Point3 = { x: 0.8, y: 0, z: 0 }; // 0.8 m along the hand line
    expect(pointInsideWorkspace(primitive('sphere', { x: 0.5, y: 0.5, z: 0.5 }), null, ORIGIN, p)).toBe(false);
    expect(pointInsideWorkspace(primitive('sphere', { x: 1.0, y: 0.5, z: 0.5 }), null, ORIGIN, p)).toBe(true);
  });

  it('cube: widening only the front–back (display Y = sim −z) axis admits a front point', () => {
    const p: Point3 = { x: 0, y: 0, z: -0.8 }; // 0.8 m toward the front
    expect(pointInsideWorkspace(primitive('cube', { x: 0.5, y: 0.5, z: 0.5 }), null, ORIGIN, p)).toBe(false);
    expect(pointInsideWorkspace(primitive('cube', { x: 0.5, y: 1.0, z: 0.5 }), null, ORIGIN, p)).toBe(true);
  });
});

describe('containment monotonicity under uniform scale growth (ruling 7)', () => {
  it('a contained point stays contained when every axis grows (all primitives)', () => {
    for (const kind of ['sphere', 'cube', 'tetra'] as const) {
      fc.assert(
        fc.property(scaleArb, pointArb, fc.double({ min: 1, max: 4, noNaN: true }), (scale, point, k) => {
          const inside = pointInsideWorkspace(primitive(kind, scale), null, ORIGIN, point);
          if (!inside) {
            return; // only inside points must be preserved
          }
          const grown = { x: scale.x * k, y: scale.y * k, z: scale.z * k };
          expect(pointInsideWorkspace(primitive(kind, grown), null, ORIGIN, point)).toBe(true);
        }),
        { numRuns: 500 },
      );
    }
  });
});

// --- STL synthesis helpers (self-contained; no fixture files) ------------------

function box(hx: number, hy: number, hz: number): Triangle[] {
  const c: Record<string, [number, number, number]> = {
    o: [-hx, -hy, -hz],
    x: [hx, -hy, -hz],
    xy: [hx, hy, -hz],
    y: [-hx, hy, -hz],
    z: [-hx, -hy, hz],
    xz: [hx, -hy, hz],
    xyz: [hx, hy, hz],
    yz: [-hx, hy, hz],
  };
  const tri = (a: string, b: string, d: string): Triangle => ({ a: c[a]!, b: c[b]!, c: c[d]! });
  return [
    tri('o', 'x', 'xy'), tri('o', 'xy', 'y'), // z-
    tri('z', 'xz', 'xyz'), tri('z', 'xyz', 'yz'), // z+
    tri('o', 'y', 'yz'), tri('o', 'yz', 'z'), // x-
    tri('x', 'xy', 'xyz'), tri('x', 'xyz', 'xz'), // x+
    tri('o', 'x', 'xz'), tri('o', 'xz', 'z'), // y-
    tri('y', 'xy', 'xyz'), tri('y', 'xyz', 'yz'), // y+
  ];
}

function toBinaryStl(tris: readonly Triangle[]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, tris.length, true);
  let offset = 84;
  for (const t of tris) {
    offset += 12; // leave the normal as zeros
    for (const v of [t.a, t.b, t.c]) {
      view.setFloat32(offset, v[0], true);
      view.setFloat32(offset + 4, v[1], true);
      view.setFloat32(offset + 8, v[2], true);
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  return buffer;
}

function toAsciiStl(tris: readonly Triangle[]): ArrayBuffer {
  let text = 'solid test\n';
  for (const t of tris) {
    text += 'facet normal 0 0 0\nouter loop\n';
    for (const v of [t.a, t.b, t.c]) {
      text += `vertex ${v[0]} ${v[1]} ${v[2]}\n`;
    }
    text += 'endloop\nendfacet\n';
  }
  text += 'endsolid test\n';
  return new TextEncoder().encode(text).buffer;
}

describe('STL parsing + containment (ruling 4)', () => {
  it('parses a binary cube: watertight, normalized to the unit frame', () => {
    const mesh = parseStl(toBinaryStl(box(2, 2, 2)));
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.watertight).toBe(true);
    expect(mesh.warning).toBeNull();
    // Largest half-extent normalizes to 1.
    expect(mesh.bounds.max[0]).toBeCloseTo(1, 6);
  });

  it('parses an ascii cube identically (binary/ascii agree)', () => {
    const mesh = parseStl(toAsciiStl(box(1, 1, 1)));
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.watertight).toBe(true);
  });

  it('a watertight mesh does ray-parity containment (inside vs outside)', () => {
    const mesh = parseStl(toBinaryStl(box(1, 1, 1))); // canonical unit cube
    const cfg: WorkspaceConfig = { kind: 'stl', scale: { x: 1, y: 1, z: 1 }, enabled: true };
    expect(pointInsideWorkspace(cfg, mesh, ORIGIN, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(pointInsideWorkspace(cfg, mesh, ORIGIN, { x: 0.5, y: 0.5, z: 0.5 })).toBe(true);
    expect(pointInsideWorkspace(cfg, mesh, ORIGIN, { x: 2, y: 0, z: 0 })).toBe(false);
    expect(pointInsideWorkspace(cfg, mesh, ORIGIN, { x: 0, y: 2, z: 0 })).toBe(false);
  });

  it('a non-watertight mesh warns and falls back to its bounding box', () => {
    const open = box(1, 1, 1).slice(0, 10); // drop the +y face → a hole
    const mesh = parseStl(toBinaryStl(open));
    expect(mesh.watertight).toBe(false);
    expect(mesh.warning).toMatch(/bounding box/i);
    const cfg: WorkspaceConfig = { kind: 'stl', scale: { x: 1, y: 1, z: 1 }, enabled: true };
    // Inside the bbox ⇒ inside; well outside ⇒ outside.
    expect(pointInsideWorkspace(cfg, mesh, ORIGIN, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(pointInsideWorkspace(cfg, mesh, ORIGIN, { x: 5, y: 0, z: 0 })).toBe(false);
  });

  it('an empty / degenerate STL parses to zero triangles with a warning', () => {
    expect(parseStl(toBinaryStl([])).triangleCount).toBe(0);
    expect(parseStl(toBinaryStl([])).warning).toBeTruthy();
  });
});

describe('violation computation (ruling 7)', () => {
  it('outsideSpans finds contiguous runs and merges the closed-loop seam', () => {
    // inside=true, outside=false
    expect(outsideSpans([true, false, false, true, false], false)).toEqual([
      [1, 2],
      [4, 4],
    ]);
    // Wrap-around: last and first both outside merge into one seam-crossing span.
    expect(outsideSpans([false, true, true, false], true)).toEqual([[3, 0]]);
    // All inside → no spans; all outside → one full span (no spurious merge).
    expect(outsideSpans([true, true, true])).toEqual([]);
    expect(outsideSpans([false, false, false])).toEqual([[0, 2]]);
  });

  it('a known geometry: half a ring of points sits outside a tight sphere', () => {
    // 8 points on a horizontal ring of radius 0.5 m (in the sim x–z plane) about the
    // anchor; a sphere with X half-extent 0.3 and front–back (Y) half-extent 1.0.
    const samples: Point3[] = [];
    for (let i = 0; i < 8; i++) {
      const theta = (2 * Math.PI * i) / 8;
      samples.push({ x: 0.5 * Math.cos(theta), y: 0, z: 0.5 * Math.sin(theta) });
    }
    const cfg = primitive('sphere', { x: 0.3, y: 1.0, z: 1.0 });
    const result = violationOverSamples(cfg, null, ORIGIN, samples);
    // The points near ±X (along the hand line) exceed the 0.3 half-extent; the
    // points near the front/back (±Y, i.e. sim ∓z) are well inside the 1.0 extent.
    expect(result.insideFlags).toHaveLength(8);
    expect(result.outsideFraction).toBeGreaterThan(0);
    expect(result.outsideFraction).toBeLessThan(1);
    // Cross-check the fraction equals the outside-flag count.
    const counted = result.insideFlags.filter((f) => !f).length / 8;
    expect(result.outsideFraction).toBeCloseTo(counted, 12);
  });

  it('a fully-contained path reports zero violation and no spans', () => {
    const samples: Point3[] = [
      { x: 0.05, y: 0.05, z: 0 },
      { x: -0.05, y: 0, z: 0.05 },
      { x: 0, y: -0.05, z: -0.05 },
    ];
    const result = violationOverSamples(primitive('sphere', { x: 1, y: 1, z: 1 }), null, ORIGIN, samples);
    expect(result.outsideFraction).toBe(0);
    expect(result.outsideSpans).toEqual([]);
  });

  it('violationBadge renders a rounded percent with the 0-based hand index', () => {
    expect(violationBadge(0, 0.1234)).toBe('H0 · 12%');
    expect(violationBadge(1, 0)).toBe('H1 · 0%');
  });
});
