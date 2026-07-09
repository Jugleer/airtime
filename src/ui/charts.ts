// src/ui/charts — pure geometry + scaling for the per-hand kinematics charts
// (DESIGN.md §6 charts panel). No React, no DOM: just the arithmetic the canvas
// component (Charts.tsx) draws from, so the sampling times, the y-axis nice-tick
// scaling, the axis-mode scalar extraction, and the NaN guard are unit-testable
// without a canvas (jsdom stubs canvas 2D — we test the math, not the pixels).
//
// The x-axis is the SAME window as the timeline bar / ladder: the shared
// anchored-playhead policy (src/state/simulation `windowSpans`) puts the simTime
// cursor a fixed fraction (CURSOR_FRACTION) of the window from the left, so a
// chart samples [simTime − pastSpan, simTime + futureSpan] and the cursor sits at
// CURSOR_FRACTION. Charts follow simTime directly (no independent scrub).

import { magnitude, type MotionState, type Vec3 } from '../core/kinematics';
import type { ChartAxisMode } from '../state';

/**
 * Samples per trace across the window. Fixed so the component can preallocate its
 * sampling buffers once (~320 points: fine enough that a fast 1-throw carry and
 * the jerk STEP at events read clearly, coarse enough to redraw every frame on a
 * desktop). At this density a discontinuity (quintic jerk step, cubic accel jump)
 * spans one sample gap and draws as a near-vertical segment — honest, unsmoothed.
 */
export const SAMPLE_COUNT = 320;

/** The three charted hand-motion quantities (DESIGN.md §6). */
export const QUANTITIES = ['velocity', 'acceleration', 'jerk'] as const;
export type ChartQuantity = (typeof QUANTITIES)[number];

/** Per-hand line colors (shared with the legend); wraps for n_h up to 8. */
export const HAND_PALETTE: readonly string[] = [
  '#2f6fed',
  '#e8710a',
  '#12a150',
  '#d4306c',
  '#8b5cf6',
  '#0aa5c4',
  '#b58900',
  '#dc2626',
];

/** A consistent color per hand index (wraps by palette length). */
export function handColor(hand: number): string {
  const n = HAND_PALETTE.length;
  const index = ((hand % n) + n) % n;
  return HAND_PALETTE[index] ?? '#666';
}

/** Display title + physical unit for a quantity under an axis mode (full words). */
export function quantityMeta(
  quantity: ChartQuantity,
  mode: ChartAxisMode,
): { readonly title: string; readonly unit: string } {
  const unit = quantity === 'velocity' ? 'm/s' : quantity === 'acceleration' ? 'm/s²' : 'm/s³';
  if (mode === 'magnitude') {
    const symbol = quantity === 'velocity' ? '|v|' : quantity === 'acceleration' ? '|a|' : '|j|';
    const word =
      quantity === 'velocity' ? 'Speed' : quantity === 'acceleration' ? 'Acceleration' : 'Jerk';
    return { title: `${word} ${symbol}`, unit };
  }
  const word =
    quantity === 'velocity' ? 'Velocity' : quantity === 'acceleration' ? 'Acceleration' : 'Jerk';
  return { title: `${word} ${mode}`, unit };
}

/** The vector of `state` for a quantity (velocity / acceleration / jerk). */
export function quantityVector(state: MotionState, quantity: ChartQuantity): Vec3 {
  if (quantity === 'velocity') {
    return state.velocity;
  }
  return quantity === 'acceleration' ? state.acceleration : state.jerk;
}

/** The scalar a chart plots for a vector under an axis mode: |vec| or one axis. */
export function axisScalar(vec: Vec3, mode: ChartAxisMode): number {
  switch (mode) {
    case 'x':
      return vec.x;
    case 'y':
      return vec.y;
    case 'z':
      return vec.z;
    default:
      return magnitude(vec);
  }
}

/** The plotted scalar for a motion state, quantity, and axis mode. */
export function scalarFromState(
  state: MotionState,
  quantity: ChartQuantity,
  mode: ChartAxisMode,
): number {
  return axisScalar(quantityVector(state, quantity), mode);
}

/**
 * Sim time of sample `index` of `count`, uniformly spanning the visible window
 * [windowStart, windowStart + timelineWindow]. Index 0 is exactly the left edge
 * and `count − 1` exactly the right edge (mirrors render3d/tracers `sampleTimeAt`).
 */
export function windowSampleTime(
  index: number,
  count: number,
  windowStart: number,
  timelineWindow: number,
): number {
  if (count <= 1) {
    return windowStart;
  }
  return windowStart + timelineWindow * (index / (count - 1));
}

/** True iff a sampled value is a real, finite number safe to send to a path. */
export function isFiniteSample(value: number): boolean {
  return Number.isFinite(value);
}

/** A nice-number y-axis scale: rounded bounds, a nice step, and the tick values. */
export interface NiceScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: number[];
}

/**
 * The "nice" 1/2/5×10ⁿ number ≥ (or nearest to, when `round`) `range`. The classic
 * Heckbert graph-label heuristic — used for both the axis range and the tick step.
 */
function niceNum(range: number, round: boolean): number {
  if (!(range > 0)) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/**
 * A y-axis scale over [dataMin, dataMax] with at most `maxTicks` labeled ticks:
 * nice rounded bounds enclosing the data and a nice step (units m/s, m/s², m/s³).
 * Degenerate inputs (non-finite, or a zero-width range) fall back to a readable
 * default so the chart never divides by zero or draws NaN.
 */
export function niceScale(dataMin: number, dataMax: number, maxTicks = 5): NiceScale {
  let lo = dataMin;
  let hi = dataMax;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi < lo) {
    [lo, hi] = [hi, lo];
  }
  if (hi - lo <= 0) {
    // Zero-width range (all samples equal): open a symmetric readable band.
    if (lo === 0) {
      hi = 1;
    } else {
      const pad = Math.abs(lo) * 0.5;
      lo -= pad;
      hi += pad;
    }
  }
  const ticksTarget = Math.max(2, maxTicks);
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / (ticksTarget - 1), true);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Round each tick to the step's decimal place to shed floating-point dust.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const factor = Math.pow(10, decimals);
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Math.round(v * factor) / factor);
  }
  return { min: niceMin, max: niceMax, step, ticks };
}

/**
 * Format a tick value for the step's precision (so 0.05-steps show 2 decimals and
 * 5-steps show 0). Keeps y-axis labels tidy without a formatting library.
 */
export function formatTick(value: number, step: number): string {
  const decimals = Number.isFinite(step) && step > 0 ? Math.max(0, -Math.floor(Math.log10(step))) : 2;
  return value.toFixed(Math.min(decimals, 4));
}

/**
 * The min/max of the finite samples in `buffer[base, base+count)` folded into
 * `acc` ({min, max}). Non-finite samples (guarded elsewhere before drawing) are
 * skipped so a stray NaN can never poison the axis range. Pure reducer over a
 * preallocated buffer — no allocation.
 */
export function foldSampleRange(
  buffer: Float32Array,
  base: number,
  count: number,
  acc: { min: number; max: number },
): { min: number; max: number } {
  for (let i = 0; i < count; i++) {
    const value = buffer[base + i] ?? NaN;
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < acc.min) {
      acc.min = value;
    }
    if (value > acc.max) {
      acc.max = value;
    }
  }
  return acc;
}
