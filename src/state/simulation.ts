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

import {
  compiledBallCount,
  compiledSpatialPeriodBeats,
  spatialPeriodBeats,
  type CompiledPattern,
} from '../core/siteswap';
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
  generationPad,
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
  /**
   * The EXTENDED (sync / multiplex) pattern this build used, when the running pattern
   * is not vanilla (orchestrator rulings 1–4). Present ⇒ `values` is empty and the
   * timeline/kinematics are driven by this compiled form; horizon extension re-passes
   * it. Undefined ⇒ a vanilla pattern (the `values`/`schedule` path). No transitions
   * exist for a compiled pattern — entering/leaving one is a clean restart (ruling 2).
   */
  readonly compiled?: CompiledPattern;
  /**
   * The retain floor this build used (memory fix #1): the heavy per-beat artifacts
   * cover only beats ≥ `genFloor`, bounding the resident sim to O(window) as play
   * time grows. 0 = a full build from beat 0 (the exposed output is bit-identical to
   * a full build for beats ≥ `genFloor`). The store advances this with the playhead
   * and rebuilds with a lower floor only on a scrub below it (deterministic).
   */
  readonly genFloor: number;
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
/** Seconds of future shown right of the simTime cursor at the default window. */
export const FUTURE_SPAN = windowSpans(WINDOW_SECONDS).futureSpan;
/** Extra seconds kept generated beyond the window so scrolling never runs dry. */
export const HORIZON_MARGIN_SECONDS = 6;
/** Beats added per horizon extension (kept coarse so rebuilds are rare). */
export const HORIZON_CHUNK_BEATS = 128;
/** Beats generated at startup (covers ~40 s at the default τ_b). */
export const INITIAL_BEATS = 160;
/**
 * Beats of PAST kept generated behind the playhead (memory fix #1). The resident sim
 * spans roughly [playhead − RETAIN_PAST_BEATS, playhead + future + margin], so it is
 * bounded regardless of elapsed play time (the old model generated from beat 0 and
 * grew ~4 beats/s unbounded). Err large: the deepest past any playhead-relative view
 * reads is pastSpan (TIMELINE_WINDOW_MAX·CURSOR_FRACTION ≈ 4.5 s) + TRAIL_LENGTH_MAX
 * (2 s) ≈ 6.5 s, ~81 beats at the min beat period (0.08 s) plus the warmup pad — so
 * 512 gives ~4× headroom (≥ 41 s of retained past even at max tempo, ~128 s at the
 * default τ_b), so ordinary scrub-back feels instant and never rebuilds. Two derived
 * quantities reuse this one knob: the export floor pin and the energy re-anchor land
 * inside the retained past. A single named constant, trivially tunable.
 */
export const RETAIN_PAST_BEATS = 512;

/** The retain floor for a playhead time: `max(0, currentBeat − RETAIN_PAST_BEATS)`. */
function retainFloorBeat(sim: Simulation, simTime: number): number {
  return Math.max(0, currentBeatIndex(sim.timeline, simTime) - RETAIN_PAST_BEATS);
}

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
  compiled?: CompiledPattern,
  genFloor: number = 0,
): Simulation {
  const timeline = buildTimeline(values, {
    beatCount,
    params: baseParams,
    epochs,
    genFloor,
    ...(schedule !== undefined ? { schedule } : null),
    ...(compiled !== undefined ? { compiled } : null),
  });
  const kinematics = buildKinematics(timeline, {
    values,
    ...(compiled !== undefined ? { compiled } : null),
    handCount: baseParams.handCount,
    genFloor,
    ...kinematicsBuildParams(values, kinematicsConfig, schedule, compiled, timeline, genFloor),
  });
  return {
    values,
    patternText,
    ballCount: compiled ? compiledBallCount(compiled) : meanOf(values),
    timeline,
    kinematics,
    beatCount,
    genFloor,
    spatialPeriodBeats: compiled
      ? compiledSpatialPeriodBeats(compiled, baseParams.handCount)
      : spatialPeriodBeats(values, baseParams.handCount),
    ...(schedule !== undefined ? { schedule } : null),
    ...(compiled !== undefined ? { compiled } : null),
  };
}

/**
 * The gravity / hold depth / geometry / carry-path + epochs to pass to
 * {@link buildKinematics} for a windowed build (memory fix #6 split-base). When
 * `genFloor ≤ 0` (or there are no epochs) this is exactly the config's base + full
 * epoch list, so the output is byte-identical to the pre-windowing code. When
 * `genFloor > 0` it folds every epoch resolving strictly BELOW the exposed range
 * into a transient RESOLUTION base and passes the remaining (above-threshold) epochs,
 * plus the IMMUTABLE t = 0 base as `originalParams`. The fold threshold trails the
 * retain floor by `2·pad` — the same pad the builder uses — so every EMITTED segment
 * (earliest a flight thrown at ≥ beatTime(emitFloor − maxValue) ≥ beatTime(genFloor −
 * 2·pad)) would have resolved the folded epoch anyway ⇒ `paramsAt` output is
 * unchanged, and the base-derived outputs stay on the true t = 0 base ⇒ bit-identical.
 * The store's canonical epoch list is LEFT IMMUTABLE (this fold is transient,
 * per-build), so scrub-back below a folded epoch's beat re-derives it correctly.
 */
function kinematicsBuildParams(
  values: number[],
  config: KinematicsConfig,
  schedule: PatternSchedule | undefined,
  compiled: CompiledPattern | undefined,
  timeline: Timeline,
  genFloor: number,
): {
  gravity: number;
  holdDepth: number;
  geometry: KinematicsConfig['geometry'];
  carryPath: KinematicsConfig['carryPath'];
  epochs: KinematicsConfig['epochs'];
  originalParams?: {
    gravity: number;
    holdDepth: number;
    geometry: KinematicsConfig['geometry'];
    carryPath: KinematicsConfig['carryPath'];
  };
} {
  if (genFloor <= 0 || config.epochs.length === 0) {
    return {
      gravity: config.gravity,
      holdDepth: config.holdDepth,
      geometry: config.geometry,
      carryPath: config.carryPath,
      epochs: config.epochs,
    };
  }
  const pad = generationPad(values, schedule, compiled);
  const foldThreshold = timeline.beatTime(Math.max(0, genFloor - 2 * pad));
  let gravity = config.gravity;
  let holdDepth = config.holdDepth;
  let geometry = config.geometry;
  let carryPath = config.carryPath;
  const remainder: KinematicsEpoch[] = [];
  for (const epoch of [...config.epochs].sort((a, b) => a.time - b.time)) {
    if (epoch.time <= foldThreshold) {
      if (epoch.gravity !== undefined) gravity = epoch.gravity;
      if (epoch.holdDepth !== undefined) holdDepth = epoch.holdDepth;
      if (epoch.geometry !== undefined) geometry = epoch.geometry;
      if (epoch.carryPath !== undefined) carryPath = epoch.carryPath;
    } else {
      remainder.push(epoch);
    }
  }
  return {
    gravity,
    holdDepth,
    geometry,
    carryPath,
    epochs: remainder,
    originalParams: {
      gravity: config.gravity,
      holdDepth: config.holdDepth,
      geometry: config.geometry,
      carryPath: config.carryPath,
    },
  };
}

/**
 * Reconcile a simulation's generated WINDOW to `simTime` (memory fix #1): extend the
 * future horizon in chunks when it no longer covers `simTime`, AND advance the retain
 * floor so the resident sim stays bounded to O(window) rather than growing from beat 0
 * as play time elapses. Forward play advances the floor for free (it piggybacks on the
 * ~128-beat horizon extension). Returns the same object when neither the horizon nor
 * the floor needs to move, so callers can skip a state update. A rebuild with a LOWER
 * floor happens only on a scrub below the window (or an export `floorPin`); it is
 * deterministic — the exposed past is bit-identical (DESIGN.md §2). Because the beat
 * grid can slew, the horizon is checked against the actual generated time, not an
 * estimate — the loop is bounded and terminates (horizonTime is monotone in beatCount).
 */
export function extendedIfNeeded(
  sim: Simulation,
  baseParams: TimelineParams,
  epochs: readonly Epoch[],
  simTime: number,
  futureSpan: number = FUTURE_SPAN,
  kinematicsConfig: KinematicsConfig = defaultKinematicsConfig(baseParams.handCount),
  floorPin?: number,
): Simulation {
  // The window this build should carry (memory fix #1). Multiplex sims are carved out
  // (genFloor forced to 0 — their overlapping hand-path tiling is not a straddle
  // problem, risk noted). An export supplies a LOW `floorPin` covering the clip start;
  // otherwise the floor trails the playhead by RETAIN_PAST_BEATS.
  const desiredFloor = sim.compiled?.multiplex ? 0 : (floorPin ?? retainFloorBeat(sim, simTime));
  const target = neededHorizonTime(simTime, futureSpan);
  const needExtend = horizonTime(sim) < target;
  // A lower desired floor than the resident one ⇒ the playhead scrubbed below the
  // window (or an export pinned the floor down); rebuild with the lower floor.
  const needFloorRebuild = sim.genFloor > desiredFloor;
  if (!needExtend && !needFloorRebuild) {
    return sim;
  }
  // Rebuild carrying the desired floor. The schedule + ball ids are floor-invariant,
  // and the exposed past is bit-identical, so this is deterministic (DESIGN.md §2).
  let current = buildSimulation(
    sim.values,
    sim.patternText,
    baseParams,
    epochs,
    Math.max(sim.beatCount, INITIAL_BEATS),
    kinematicsConfig,
    sim.schedule,
    sim.compiled,
    desiredFloor,
  );
  let guard = 0;
  while (horizonTime(current) < target && guard < 1024) {
    current = buildSimulation(
      current.values,
      current.patternText,
      baseParams,
      epochs,
      current.beatCount + HORIZON_CHUNK_BEATS,
      kinematicsConfig,
      current.schedule,
      current.compiled,
      desiredFloor,
    );
    guard += 1;
  }
  return current;
}

/**
 * Return a simulation generated to the MINIMAL horizon that still covers
 * `simTime` — the shrink counterpart of {@link extendedIfNeeded}. Rebuilds from
 * {@link INITIAL_BEATS} and grows in the same chunks only until the horizon
 * reaches `neededHorizonTime`, so a sim whose tail was inflated far past the
 * playhead (e.g. the export loop driving `simTime` forward, then parking it back)
 * is trimmed back to the running-steady size. Because the config is unchanged the
 * generated range is still [0, beatCount) — only a SMALLER beatCount — so the past
 * stays bit-identical (DESIGN.md §2); backward scrub to t = 0 is unaffected.
 *
 * A no-op-equivalent when the current horizon is already minimal: returns the same
 * object (ref preserved) whenever `sim` is not larger than the minimal build, so it
 * never GROWS the horizon (that is {@link extendedIfNeeded}'s job).
 */
export function minimalHorizon(
  sim: Simulation,
  baseParams: TimelineParams,
  epochs: readonly Epoch[],
  simTime: number,
  futureSpan: number = FUTURE_SPAN,
  kinematicsConfig: KinematicsConfig = defaultKinematicsConfig(baseParams.handCount),
): Simulation {
  const desiredFloor = sim.compiled?.multiplex ? 0 : retainFloorBeat(sim, simTime);
  const target = neededHorizonTime(simTime, futureSpan);
  let current = buildSimulation(
    sim.values,
    sim.patternText,
    baseParams,
    epochs,
    INITIAL_BEATS,
    kinematicsConfig,
    sim.schedule,
    sim.compiled,
    desiredFloor,
  );
  let guard = 0;
  while (horizonTime(current) < target && guard < 1024) {
    current = buildSimulation(
      sim.values,
      sim.patternText,
      baseParams,
      epochs,
      current.beatCount + HORIZON_CHUNK_BEATS,
      kinematicsConfig,
      sim.schedule,
      sim.compiled,
      desiredFloor,
    );
    guard += 1;
  }
  // Already minimal in BOTH dimensions (beat count and retain floor) ⇒ keep the
  // existing object so the store can skip the update, and never grow past the current
  // horizon. A resident floor below the desired one still trims (releases the past).
  if (sim.beatCount <= current.beatCount && sim.genFloor >= desiredFloor) {
    return sim;
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
