// src/state/simulation — the derived simulation pipeline (DESIGN.md §2).
//
// Turns config (a validated pattern + timeline params + epochs) into the derived
// artifacts every view renders from: the event timeline (Phase 1) and the
// closed-form kinematics (Phase 2). The state layer owns this; core stays pure.
//
// Two responsibilities beyond the plain build:
//   1. Horizon management — core's `beatTime` THROWS past the generated beat
//      range, so as `simTime` advances we must keep the timeline generated far
//      enough ahead of the playhead (extend in chunks, never shrink).
//   2. Runtime parameter epochs — a τ_b / t_d change while running is applied at
//      the first not-yet-started beat so past events stay bit-identical
//      (NOTATION.md "epoch"; DESIGN.md §2 immutability). The heavy lifting
//      (slew, arrival guard) lives in core/timeline.

import { spatialPeriodBeats } from '../core/siteswap';
import {
  buildKinematics,
  DEFAULT_GRAVITY,
  DEFAULT_HOLD_DEPTH,
  defaultHandGeometry,
  type Kinematics,
} from '../core/kinematics';
import { buildTimeline, type Epoch, type Timeline, type TimelineParams } from '../core/timeline';

/** Epoch-changeable params (n_h is a full rebuild, not an epoch — see Timeline). */
export type EpochParams = Partial<Omit<TimelineParams, 'handCount'>>;

/** The derived simulation artifacts for one valid pattern + params (§2). */
export interface Simulation {
  /** The valid pattern's throw values this build used. */
  readonly values: number[];
  /** The valid pattern text (may lag the input box while the input is invalid). */
  readonly patternText: string;
  /** Ball count b = mean(h) (integer for a valid pattern). */
  readonly ballCount: number;
  /** The event timeline (throws/catches/holds/idles, flights, carries). */
  readonly timeline: Timeline;
  /** Closed-form kinematics over the timeline (consumed by the 3D scene, Phase 4). */
  readonly kinematics: Kinematics;
  /** Beats generated: events cover [0, beatCount); `beatTime` is safe to beatCount. */
  readonly beatCount: number;
  /** Spatial period in beats (DESIGN.md §6), for the "repeats every" readout. */
  readonly spatialPeriodBeats: number;
}

// --- Ladder window + horizon geometry (shared by the store and the ladder) ----

/** Visible ladder/timeline window width in seconds (DESIGN.md §6 default 3 s). */
export const WINDOW_SECONDS = 3;
/** Cursor position as a fraction of the window from the left edge. */
export const CURSOR_FRACTION = 0.3;
/** Seconds of history shown left of the simTime cursor. */
export const PAST_SPAN = WINDOW_SECONDS * CURSOR_FRACTION;
/** Seconds of future shown right of the simTime cursor. */
export const FUTURE_SPAN = WINDOW_SECONDS - PAST_SPAN;
/** Extra seconds kept generated beyond the window so scrolling never runs dry. */
export const HORIZON_MARGIN_SECONDS = 6;
/** Beats added per horizon extension (kept coarse so rebuilds are rare). */
export const HORIZON_CHUNK_BEATS = 128;
/** Beats generated at startup (covers ~40 s at the default τ_b). */
export const INITIAL_BEATS = 160;

/** The sim time the current window's right edge (plus margin) needs generated. */
export function neededHorizonTime(simTime: number): number {
  return simTime + FUTURE_SPAN + HORIZON_MARGIN_SECONDS;
}

/** Generated horizon in seconds: the start time of the first ungenerated beat. */
export function horizonTime(sim: Simulation): number {
  return sim.timeline.beatTime(sim.beatCount);
}

// --- Building ----------------------------------------------------------------

function meanOf(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

/**
 * Build the derived simulation for a valid pattern over `beatCount` beats.
 * `baseParams` are the params at beat 0; `epochs` are later runtime changes
 * (past events stay immutable, DESIGN.md §2).
 */
export function buildSimulation(
  values: number[],
  patternText: string,
  baseParams: TimelineParams,
  epochs: readonly Epoch[],
  beatCount: number,
): Simulation {
  const timeline = buildTimeline(values, {
    beatCount,
    params: baseParams,
    epochs,
  });
  const kinematics = buildKinematics(timeline, {
    values,
    handCount: baseParams.handCount,
    geometry: defaultHandGeometry(baseParams.handCount),
    gravity: DEFAULT_GRAVITY,
    holdDepth: DEFAULT_HOLD_DEPTH,
  });
  return {
    values,
    patternText,
    ballCount: meanOf(values),
    timeline,
    kinematics,
    beatCount,
    spatialPeriodBeats: spatialPeriodBeats(values, baseParams.handCount),
  };
}

/**
 * Return a simulation whose generated horizon comfortably covers `simTime`,
 * extending in chunks if needed (never shrinks). Returns the same object when no
 * extension is required so callers can skip a state update. Because the beat grid
 * can slew, the horizon is checked against the actual generated time, not an
 * estimate — the loop is bounded and terminates (horizonTime is monotone in
 * beatCount).
 */
export function extendedIfNeeded(
  sim: Simulation,
  baseParams: TimelineParams,
  epochs: readonly Epoch[],
  simTime: number,
): Simulation {
  const target = neededHorizonTime(simTime);
  if (horizonTime(sim) >= target) {
    return sim;
  }
  let current = sim;
  let guard = 0;
  while (horizonTime(current) < target && guard < 1024) {
    current = buildSimulation(
      current.values,
      current.patternText,
      baseParams,
      epochs,
      current.beatCount + HORIZON_CHUNK_BEATS,
    );
    guard += 1;
  }
  return current;
}

// --- Runtime parameter epochs ------------------------------------------------

/**
 * The first beat index whose start time is at or after `simTime` — the earliest
 * beat a runtime parameter change may touch without altering the past. Returns 0
 * for simTime ≤ 0. Binary search over the (monotone) beat-start times.
 */
export function firstBeatAtOrAfter(timeline: Timeline, simTime: number): number {
  const times = timeline.schedule.beatTimes;
  if (simTime <= 0 || times.length === 0) {
    return 0;
  }
  let lo = 0;
  let hi = times.length - 1;
  let answer = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) >= simTime) {
      answer = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return answer;
}

/**
 * Insert or merge an epoch at `beat`. Successive slider drags within the same
 * beat coalesce (merge) instead of piling up, keeping the epoch list bounded by
 * the number of distinct beats a change was made at. Returns a new sorted list.
 */
export function upsertEpoch(epochs: readonly Epoch[], beat: number, params: EpochParams): Epoch[] {
  const index = epochs.findIndex((epoch) => epoch.beat === beat);
  if (index >= 0) {
    const next = epochs.map((epoch) => ({ beat: epoch.beat, params: { ...epoch.params } }));
    const existing = next[index] as Epoch;
    next[index] = { beat, params: { ...existing.params, ...params } };
    return next;
  }
  const next = epochs.map((epoch) => ({ beat: epoch.beat, params: { ...epoch.params } }));
  next.push({ beat, params: { ...params } });
  next.sort((a, b) => a.beat - b.beat);
  return next;
}
