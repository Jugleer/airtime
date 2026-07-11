// src/export/schedule — the PURE frame-time + turntable schedules for a
// deterministic export (DESIGN.md §2: the sim is an exact function of time, so
// offline rendering is frame-exact and seamless). No DOM/three/react/state here —
// just numbers, so the whole schedule is property-testable.
//
// Seamlessness (the load-bearing property): one export of `loops` pattern loops
// samples `frameCount = round(loops · loopDuration · fps)` frames EVENLY across
// the half-open interval [t0, t0 + loops·loopDuration). The endpoint is EXCLUSIVE
// — the frame that would sit at t0 + total equals the frame at t0 (the sim is
// exactly periodic), so emitting it would duplicate frame 0 and hitch the loop.
// The turntable angle schedule is the same construction on [0, 2π): it ends one
// step short of a full turn, so the orbit also closes seamlessly.

// A 3-vector as an [x, y, z] tuple (frame-agnostic). Defined once in core/math and
// re-exported here so existing importers (capture, index, the tests) keep working.
import type { Vec3Tuple } from '../core/math';
export type { Vec3Tuple };

/** Everything the capture loop needs, derived from the loop parameters. */
export interface ExportSchedule {
  /** The sim time of the first frame (the current playhead, t0). */
  readonly startTime: number;
  /** Duration of ONE pattern loop in seconds (the hand-cycle spatial period). */
  readonly loopDuration: number;
  readonly loops: number;
  readonly fps: number;
  /** Number of frames rendered (≥ 1). */
  readonly frameCount: number;
  /** loops · loopDuration (seconds spanned, endpoint exclusive). */
  readonly totalDuration: number;
  /** Uniform per-frame delay in milliseconds (= totalDuration·1000 / frameCount). */
  readonly frameDelayMs: number;
  /** Sim time of each frame: length frameCount, [0] === startTime, strictly increasing. */
  readonly frameTimes: readonly number[];
  /** Turntable azimuth (radians) of each frame: [0] === 0, ends one step short of 2π. */
  readonly turntableAngles: readonly number[];
}

/**
 * The frame count for `loops` loops of `loopDuration` seconds at `fps` — rounded
 * to the nearest whole frame, floored at 1. Exposed for the dialog's live
 * "≈ N frames" readout (identical to the count {@link buildExportSchedule} uses).
 */
export function estimateFrameCount(loopDuration: number, loops: number, fps: number): number {
  const total = loopDuration * loops * fps;
  if (!Number.isFinite(total) || total <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(total));
}

/**
 * Build the full frame schedule. `startTime` is the current playhead t0;
 * `loopDuration` is one spatial period in seconds; `loops` and `fps` come from the
 * dialog. Frames span [t0, t0 + loops·loopDuration) evenly with the endpoint
 * excluded (see the module note) so GIF/WebM playback loops with no seam.
 */
export function buildExportSchedule(params: {
  readonly startTime: number;
  readonly loopDuration: number;
  readonly loops: number;
  readonly fps: number;
}): ExportSchedule {
  const { startTime, loopDuration, loops, fps } = params;
  const totalDuration = loopDuration * loops;
  const frameCount = estimateFrameCount(loopDuration, loops, fps);
  const frameTimes = new Array<number>(frameCount);
  const turntableAngles = new Array<number>(frameCount);
  for (let k = 0; k < frameCount; k++) {
    const fraction = k / frameCount; // in [0, 1), never reaches 1 (endpoint exclusive)
    frameTimes[k] = startTime + fraction * totalDuration;
    turntableAngles[k] = fraction * 2 * Math.PI;
  }
  const frameDelayMs = frameCount > 0 ? (totalDuration * 1000) / frameCount : 0;
  return {
    startTime,
    loopDuration,
    loops,
    fps,
    frameCount,
    totalDuration,
    frameDelayMs,
    frameTimes,
    turntableAngles,
  };
}

/**
 * Whether a beat grid is UNIFORM — every successive beat-time delta equal within
 * `epsilon` seconds. A seamless export loop assumes the pattern is exactly periodic,
 * i.e. the beat spacing is constant (a settled tempo). While the tempo is still
 * slew-limiting toward a new beat period the spacing changes from beat to beat, so one
 * period's measured duration does NOT actually repeat and the exported loop would hitch
 * visibly at the seam. The exporter samples the grid over one period and refuses to
 * export until this returns true. Fewer than two intervals is trivially uniform.
 */
export function isBeatGridUniform(beatTimes: readonly number[], epsilon = 1e-6): boolean {
  if (beatTimes.length < 3) {
    return true;
  }
  const reference = (beatTimes[1] as number) - (beatTimes[0] as number);
  for (let i = 2; i < beatTimes.length; i++) {
    const delta = (beatTimes[i] as number) - (beatTimes[i - 1] as number);
    if (Math.abs(delta - reference) > epsilon) {
      return false;
    }
  }
  return true;
}

/**
 * Rotate a camera position around a target by `angle` radians about the world
 * vertical (three.js is natively y-up; OrbitControls orbits about +Y). Preserves
 * the distance to the target and the height, so the orbit is a level turntable.
 * Pure — unit-tested for the identity (angle 0 and 2π) and radius preservation.
 */
export function orbitPosition(
  cameraPosition: Vec3Tuple,
  target: Vec3Tuple,
  angle: number,
): [number, number, number] {
  const dx = cameraPosition[0] - target[0];
  const dy = cameraPosition[1] - target[1];
  const dz = cameraPosition[2] - target[2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotate the horizontal (x, z) offset; height (y) is unchanged.
  const rx = dx * cos + dz * sin;
  const rz = -dx * sin + dz * cos;
  return [target[0] + rx, target[1] + dy, target[2] + rz];
}
