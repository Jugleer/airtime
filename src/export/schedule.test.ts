import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildExportSchedule,
  estimateFrameCount,
  isBeatGridUniform,
  orbitPosition,
  type Vec3Tuple,
} from './schedule';

const EPS = 1e-9;

describe('buildExportSchedule (pure frame schedule)', () => {
  it('one loop: N frames span exactly one period, first == t0, endpoint exclusive', () => {
    const s = buildExportSchedule({ startTime: 2, loopDuration: 0.5, loops: 1, fps: 30 });
    expect(s.frameCount).toBe(15); // round(0.5 * 1 * 30)
    expect(s.frameTimes[0]).toBe(2);
    // No duplicate last frame: the last sample is strictly inside the period.
    const last = s.frameTimes[s.frameCount - 1];
    expect(last).toBeLessThan(2 + s.totalDuration);
    // And it sits exactly one step short of the endpoint.
    expect(last).toBeCloseTo(2 + ((s.frameCount - 1) / s.frameCount) * 0.5, 12);
  });

  it('per-frame delay reconstructs the total duration exactly', () => {
    const s = buildExportSchedule({ startTime: 0, loopDuration: 0.5, loops: 2, fps: 24 });
    expect((s.frameDelayMs * s.frameCount) / 1000).toBeCloseTo(s.totalDuration, 12);
  });

  it('turntable: angle[0] == 0, one full turn over the whole export, ends short of 2π', () => {
    const s = buildExportSchedule({ startTime: 0, loopDuration: 1, loops: 3, fps: 15 });
    expect(s.turntableAngles[0]).toBe(0);
    const step = (2 * Math.PI) / s.frameCount;
    const last = s.turntableAngles[s.frameCount - 1] as number;
    expect(last).toBeLessThan(2 * Math.PI);
    // Exactly one step short of a full turn (so frame 0 closes the loop).
    expect(last + step).toBeCloseTo(2 * Math.PI, 10);
  });

  it('estimateFrameCount matches the built schedule length', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 5, noNaN: true }),
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom(15, 24, 30),
        (loopDuration, loops, fps) => {
          const s = buildExportSchedule({ startTime: 0, loopDuration, loops, fps });
          expect(s.frameCount).toBe(estimateFrameCount(loopDuration, loops, fps));
        },
      ),
    );
  });

  it('frame times: strictly increasing, uniformly spaced, all inside the half-open period', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: 0.05, max: 5, noNaN: true }),
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom(15, 24, 30),
        (startTime, loopDuration, loops, fps) => {
          const s = buildExportSchedule({ startTime, loopDuration, loops, fps });
          expect(s.frameTimes).toHaveLength(s.frameCount);
          // Use === (not toBe/Object.is) so a -0 startTime, whose +0·total makes
          // frameTimes[0] a +0, still counts as equal (behaviorally identical).
          expect(s.frameTimes[0] === startTime).toBe(true);
          const spacing = s.totalDuration / s.frameCount;
          for (let k = 1; k < s.frameCount; k++) {
            const dt = (s.frameTimes[k] as number) - (s.frameTimes[k - 1] as number);
            expect(dt).toBeGreaterThan(0);
            expect(dt).toBeCloseTo(spacing, 9);
          }
          // Endpoint exclusive: last sample strictly below t0 + total.
          const last = s.frameTimes[s.frameCount - 1] as number;
          expect(last).toBeLessThan(startTime + s.totalDuration - EPS + spacing);
          expect(last).toBeLessThan(startTime + s.totalDuration);
        },
      ),
    );
  });
});

describe('isBeatGridUniform (tempo-settled detector)', () => {
  it('accepts a settled grid (constant beat spacing)', () => {
    // τ_b = 0.25 s repeated — the pattern is exactly periodic.
    const grid = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25];
    expect(isBeatGridUniform(grid)).toBe(true);
  });

  it('rejects a slewing grid (beat spacing still changing)', () => {
    // Successive periods 0.30, 0.28, 0.26, 0.25, 0.25 — a tempo slew in progress.
    let t = 0;
    const grid = [t];
    for (const dt of [0.3, 0.28, 0.26, 0.25, 0.25]) {
      t += dt;
      grid.push(t);
    }
    expect(isBeatGridUniform(grid)).toBe(false);
  });

  it('tolerates floating-point noise within epsilon but flags a real slew', () => {
    const settledWithNoise = [0, 0.25, 0.5 + 1e-9, 0.75 - 1e-9, 1.0];
    expect(isBeatGridUniform(settledWithNoise)).toBe(true);
    // A 1 ms per-beat drift is well above epsilon → flagged.
    expect(isBeatGridUniform([0, 0.25, 0.501, 0.752])).toBe(false);
  });

  it('treats a degenerate short grid (< 2 intervals) as uniform', () => {
    expect(isBeatGridUniform([])).toBe(true);
    expect(isBeatGridUniform([1])).toBe(true);
    expect(isBeatGridUniform([1, 1.25])).toBe(true);
  });
});

describe('orbitPosition (turntable camera math)', () => {
  it('angle 0 is the identity', () => {
    const p: Vec3Tuple = [1, 2, 3];
    const t: Vec3Tuple = [0, 1, 0];
    const r = orbitPosition(p, t, 0);
    expect(r[0]).toBeCloseTo(1, 12);
    expect(r[1]).toBeCloseTo(2, 12);
    expect(r[2]).toBeCloseTo(3, 12);
  });

  it('a full turn returns to the start; height and radius are preserved', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (px, py, pz, angle) => {
          const p: Vec3Tuple = [px, py, pz];
          const t: Vec3Tuple = [0.2, 1, -0.3];
          const rotated = orbitPosition(p, t, angle);
          // Height unchanged.
          expect(rotated[1]).toBeCloseTo(py, 9);
          // Horizontal distance to target preserved.
          const r0 = Math.hypot(px - t[0], pz - t[2]);
          const r1 = Math.hypot(rotated[0] - t[0], rotated[2] - t[2]);
          expect(r1).toBeCloseTo(r0, 9);
          // A full 2π turn is the identity.
          const full = orbitPosition(p, t, angle + 2 * Math.PI);
          expect(full[0]).toBeCloseTo(rotated[0], 8);
          expect(full[2]).toBeCloseTo(rotated[2], 8);
        },
      ),
    );
  });
});
