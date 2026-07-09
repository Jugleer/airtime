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
  quinticViaCarryPath,
  type CarryPath,
  type HandGeometry,
  type Kinematics,
  type KinematicsEpoch,
} from '../core/kinematics';
import {
  buildTimeline,
  type Epoch,
  type PatternSchedule,
  type Timeline,
  type TimelineParams,
} from '../core/timeline';

/** Epoch-changeable params (n_h is a full rebuild, not an epoch — see Timeline). */
export type EpochParams = Partial<Omit<TimelineParams, 'handCount'>>;

/**
 * The kinematics-side build config (DESIGN.md §4.6, §6): base gravity / hold depth
 * / carry path / hand geometry (in force at t = 0) plus an ordered list of runtime
 * {@link KinematicsEpoch}s (future-only edits). Unlike timing params (beat period /
 * dwell / hand count) these do NOT affect the beat schedule — gravity is
 * g-independent of air time (NOTATION identity 1) — so they thread into
 * `buildKinematics` only, never the timeline.
 */
export interface KinematicsConfig {
  readonly gravity: number;
  readonly holdDepth: number;
  readonly carryPath: CarryPath;
  readonly geometry: HandGeometry;
  readonly epochs: readonly KinematicsEpoch[];
}

/** The DESIGN.md §7 default kinematics config for a hand count (line preset, no epochs). */
export function defaultKinematicsConfig(handCount: number): KinematicsConfig {
  return {
    gravity: DEFAULT_GRAVITY,
    holdDepth: DEFAULT_HOLD_DEPTH,
    carryPath: quinticViaCarryPath,
    geometry: defaultHandGeometry(handCount),
    epochs: [],
  };
}

/** A runtime kinematics change (the epoch fields without the `time`). */
export type KinematicsEpochChange = Omit<KinematicsEpoch, 'time'>;

/**
 * Insert or merge a kinematics epoch at sim time `time`. Successive edits snapped
 * to the same time (a beat boundary) coalesce (merge fields) instead of piling up,
 * mirroring the timeline's {@link upsertEpoch}. Returns a new list sorted by time.
 */
export function upsertKinematicsEpoch(
  epochs: readonly KinematicsEpoch[],
  time: number,
  change: KinematicsEpochChange,
): KinematicsEpoch[] {
  const index = epochs.findIndex((epoch) => epoch.time === time);
  const next = epochs.map((epoch) => ({ ...epoch }));
  if (index >= 0) {
    next[index] = { ...(next[index] as KinematicsEpoch), ...change, time };
    return next;
  }
  next.push({ ...change, time });
  next.sort((a, b) => a.time - b.time);
  return next;
}

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
  /**
   * The piecewise throw-value schedule this build used (a state-graph transition,
   * DESIGN.md §5) — part of the build inputs so horizon extension re-derives the
   * SAME splice deterministically. Undefined = plain periodic `values`.
   */
  readonly schedule?: PatternSchedule;
}

// --- Ladder / timeline window + horizon geometry (shared by store + views) ----
//
// The visible window is a fixed, CONFIGURABLE width (DESIGN.md §6, §7: default
// 3 s, range 1–15 s). It is owned by the store (`timelineWindow`); the ladder and
// the timeline bar both derive their spans from it via {@link windowSpans}, so a
// single control drives both views (they "rhyme", DESIGN.md §6). The scroll policy
// is the same anchored-playhead one the ladder already used: the simTime cursor
// sits at a fixed fraction ({@link CURSOR_FRACTION}) of the window from the left,
// so past = window·fraction and future = window·(1−fraction). This holds whether
// playing, paused, or scrubbing (the timeline bar freezes the window only during
// an active scrub gesture — see src/ui/TimelineBar).

/** Default visible window width in seconds (DESIGN.md §7 timeline window). */
export const DEFAULT_TIMELINE_WINDOW = 3;
/** Timeline-window slider range (DESIGN.md §7: 1–15 s). */
export const TIMELINE_WINDOW_MIN = 1;
export const TIMELINE_WINDOW_MAX = 15;
/** Cursor position as a fraction of the window from the left edge. */
export const CURSOR_FRACTION = 0.3;

/** Past/future split of a window: `past = window·fraction`, `future = rest`. */
export function windowSpans(timelineWindow: number): {
  readonly pastSpan: number;
  readonly futureSpan: number;
} {
  const pastSpan = timelineWindow * CURSOR_FRACTION;
  return { pastSpan, futureSpan: timelineWindow - pastSpan };
}

/** Default window width (kept for back-compat; equals {@link DEFAULT_TIMELINE_WINDOW}). */
export const WINDOW_SECONDS = DEFAULT_TIMELINE_WINDOW;
/** Seconds of history shown left of the simTime cursor at the default window. */
export const PAST_SPAN = windowSpans(WINDOW_SECONDS).pastSpan;
/** Seconds of future shown right of the simTime cursor at the default window. */
export const FUTURE_SPAN = windowSpans(WINDOW_SECONDS).futureSpan;
/** Extra seconds kept generated beyond the window so scrolling never runs dry. */
export const HORIZON_MARGIN_SECONDS = 6;
/** Beats added per horizon extension (kept coarse so rebuilds are rare). */
export const HORIZON_CHUNK_BEATS = 128;
/** Beats generated at startup (covers ~40 s at the default τ_b). */
export const INITIAL_BEATS = 160;

/**
 * The sim time the current window's right edge (plus margin) needs generated.
 * `futureSpan` is the window's forward span (default = the 3 s window's future);
 * the margin (≥ any ghost span, {@link HORIZON_MARGIN_SECONDS} = 6 s) keeps future
 * ghosts inside the generated range for free.
 */
export function neededHorizonTime(simTime: number, futureSpan: number = FUTURE_SPAN): number {
  return simTime + futureSpan + HORIZON_MARGIN_SECONDS;
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
 * `baseParams` are the timing params at beat 0; `epochs` are later runtime timing
 * changes (past events stay immutable, DESIGN.md §2). `kinematicsConfig` is the
 * gravity / hold depth / geometry / carry-path config plus its own runtime epochs
 * (DESIGN.md §4.6); it defaults to the DESIGN §7 defaults so existing callers
 * (and tests) that omit it get exactly today's behavior.
 */
export function buildSimulation(
  values: number[],
  patternText: string,
  baseParams: TimelineParams,
  epochs: readonly Epoch[],
  beatCount: number,
  kinematicsConfig: KinematicsConfig = defaultKinematicsConfig(baseParams.handCount),
  schedule?: PatternSchedule,
): Simulation {
  const timeline = buildTimeline(values, {
    beatCount,
    params: baseParams,
    epochs,
    ...(schedule !== undefined ? { schedule } : null),
  });
  const kinematics = buildKinematics(timeline, {
    values,
    handCount: baseParams.handCount,
    geometry: kinematicsConfig.geometry,
    gravity: kinematicsConfig.gravity,
    holdDepth: kinematicsConfig.holdDepth,
    carryPath: kinematicsConfig.carryPath,
    epochs: kinematicsConfig.epochs,
  });
  return {
    values,
    patternText,
    ballCount: meanOf(values),
    timeline,
    kinematics,
    beatCount,
    spatialPeriodBeats: spatialPeriodBeats(values, baseParams.handCount),
    ...(schedule !== undefined ? { schedule } : null),
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
  futureSpan: number = FUTURE_SPAN,
  kinematicsConfig: KinematicsConfig = defaultKinematicsConfig(baseParams.handCount),
): Simulation {
  const target = neededHorizonTime(simTime, futureSpan);
  if (horizonTime(sim) >= target) {
    return sim;
  }
  let current = sim;
  let guard = 0;
  while (horizonTime(current) < target && guard < 1024) {
    // The schedule is part of the build inputs (Simulation.schedule), so an
    // extension re-derives exactly the same splice — bit-identical past.
    current = buildSimulation(
      current.values,
      current.patternText,
      baseParams,
      epochs,
      current.beatCount + HORIZON_CHUNK_BEATS,
      kinematicsConfig,
      current.schedule,
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
 * The beat index the playhead is currently inside: the largest beat whose start
 * time is at or before `simTime` (0 for simTime ≤ 0). This is the beat the
 * state-graph marker sits on (DESIGN.md §5: the marker hops each beat).
 */
export function currentBeatIndex(timeline: Timeline, simTime: number): number {
  const next = firstBeatAtOrAfter(timeline, simTime);
  if (next === 0) {
    return 0;
  }
  const times = timeline.schedule.beatTimes;
  return (times[next] as number) <= simTime ? next : next - 1;
}

// --- State-graph transitions (DESIGN.md §5) -----------------------------------

/**
 * The earliest splice beat that guarantees a GLITCH-FREE morph (Phase 8
 * acceptance): the first beat at/after `simTime` such that no ball's motion
 * segment containing `simTime` is affected by the splice.
 *
 * - Balls in FLIGHT at `simTime` keep their parabola for any splice beat ≥ the
 *   next beat (their landing beat/value froze at throw time) — no constraint.
 * - Balls in a CARRY at `simTime` are being carried toward their rethrow at the
 *   carry's end beat; changing THAT throw would re-aim the carry mid-dwell (a
 *   small position pop at the store swap). The splice must land strictly after
 *   every such carry's end beat, so the throw it feeds is unchanged.
 *
 * With this beat, every segment active at the swap instant is bit-identical
 * between the old and the spliced build — balls do not move at the transition
 * moment; the change is entirely in the future.
 */
export function earliestGlitchFreeSpliceBeat(sim: Simulation, simTime: number): number {
  let beat = firstBeatAtOrAfter(sim.timeline, simTime);
  for (const carry of sim.timeline.carries) {
    if (carry.startTime < simTime && simTime < carry.endTime && carry.endBeat >= beat) {
      beat = carry.endBeat + 1;
    }
  }
  return beat;
}

/** An in-progress state-graph transition (stored alongside the sim). */
export interface TransitionInfo {
  /** Canonical text of the pattern being transitioned to. */
  readonly targetText: string;
  /** The splice beat (first bridge beat). */
  readonly startBeat: number;
  /** First beat of the target pattern (= startBeat + bridge length). */
  readonly endBeat: number;
}

/** What the transition-status line shows (null = no transition in progress). */
export interface TransitionStatus {
  readonly targetText: string;
  /** Whole bridge beats still ahead of the playhead (≥ 1 while transitioning). */
  readonly beatsRemaining: number;
}

/**
 * The live transition status for the UI ("transitioning to 531 (2 beats)"):
 * beats remaining = the transition's end beat minus the playhead's current beat.
 * Null once the playhead has entered the target pattern (or with no transition).
 */
export function transitionStatusOf(
  sim: Simulation,
  transition: TransitionInfo | null,
  simTime: number,
): TransitionStatus | null {
  if (transition === null) {
    return null;
  }
  const beat = currentBeatIndex(sim.timeline, simTime);
  const beatsRemaining = transition.endBeat - beat;
  if (beatsRemaining <= 0) {
    return null;
  }
  return { targetText: transition.targetText, beatsRemaining };
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
