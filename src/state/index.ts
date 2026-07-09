// src/state — the zustand store: config, the single global clock, and the derived
// simulation (DESIGN.md §2). The dependency direction is ui/render3d -> state ->
// core; this layer may use the wall clock (the rAF loop lives in src/ui), but
// core stays a pure function of time.
//
// The clock (DESIGN.md §2, read twice): ONE `simTime`. While `playing` it
// advances at wallTime · playbackSpeed (driven by the single rAF loop in
// src/ui/useClock); pausing freezes it. Every view renders from this one value.
// Playback speed rescales the wall->sim mapping ONLY — no physical effect
// (NOTATION.md conventions), so changing it never rebuilds the timeline.

import { create } from 'zustand';
import { DWELL_CAP_FRACTION, effectiveDwell } from '../core/timing';
import { validatePattern, type ValidationResult } from '../core/siteswap';
import type { Epoch, TimelineParams } from '../core/timeline';
import {
  circleHandGeometry,
  cubicBezierCarryPath,
  DEFAULT_GRAVITY,
  DEFAULT_HOLD_DEPTH,
  lineHandGeometry,
  makeHandGeometry,
  quinticViaCarryPath,
  vec3,
  type CarryPath,
  type HandGeometry,
  type Vec3,
} from '../core/kinematics';
import {
  buildSimulation,
  defaultKinematicsConfig,
  DEFAULT_TIMELINE_WINDOW,
  extendedIfNeeded,
  firstBeatAtOrAfter,
  INITIAL_BEATS,
  TIMELINE_WINDOW_MAX,
  TIMELINE_WINDOW_MIN,
  upsertEpoch,
  upsertKinematicsEpoch,
  windowSpans,
  type EpochParams,
  type KinematicsConfig,
  type KinematicsEpochChange,
  type Simulation,
} from './simulation';

// --- Defaults & slider ranges (DESIGN.md §7) --------------------------------

export const DEFAULT_PATTERN = '3';
export const DEFAULT_BEAT_PERIOD = 0.25;
export const DEFAULT_DWELL_TIME = 0.3;
export const DEFAULT_PLAYBACK_SPEED = 1;
export const DEFAULT_HAND_COUNT = 2;

/** τ_b slider range (log-scaled in the UI). */
export const BEAT_PERIOD_MIN = 0.08;
export const BEAT_PERIOD_MAX = 1.0;
/** t_d slider minimum; the maximum is dynamic (0.9·n_h·τ_b, see {@link dwellCap}). */
export const DWELL_MIN = 0.02;
/** Playback-speed slider range (0.05×–2×). */
export const PLAYBACK_MIN = 0.05;
export const PLAYBACK_MAX = 2;
/** β, the per-throw dwell clamp factor (NOTATION.md; used for the amber readout). */
export const DWELL_CLAMP_BETA = 0.75;

// --- Runtime physics params (DESIGN.md §4.6, §6, §7) — applied via kinematics ---
// These affect FUTURE events only (an in-flight ball keeps its parabola), so a
// change creates a kinematics epoch at the current playhead rather than a silent
// rebuild. n_h and the geometry preset are the exception: an n_h change cannot be
// an epoch (BUILD_LOG Phase 1 decision), so it is a full rebuild through the store.

/** g slider range (DESIGN.md §7: 0.5–30, default 9.81). */
export const GRAVITY_MIN = 0.5;
export const GRAVITY_MAX = 30;
export const DEFAULT_GRAVITY_VALUE = DEFAULT_GRAVITY;
/** holdDepth slider range (DESIGN.md §7: 0–0.4 m, default 0.10). */
export const HOLD_DEPTH_MIN = 0;
export const HOLD_DEPTH_MAX = 0.4;
export const DEFAULT_HOLD_DEPTH_VALUE = DEFAULT_HOLD_DEPTH;
/** n_h stepper range (DESIGN.md §7: 1–8). */
export const HAND_COUNT_MIN = 1;
export const HAND_COUNT_MAX = 8;
/** Hand y-height (DESIGN.md §7: hands live at y ≈ 1.00 m); the editor keeps y fixed. */
export const HAND_Y = 1.0;

/** Which carry path is active: the default quintic (hold dip) or the cubic comparison. */
export type CarryPathKind = 'quintic' | 'cubic';
/** Hand-geometry preset kind (DESIGN.md §6, §7). */
export type HandPreset = 'line' | 'circle';
/** Which of a hand's two editable points a UI edit targets. */
export type HandPointKind = 'catch' | 'throw';

/** The {@link CarryPath} object for a kind (quintic default; cubic comparison). */
export function carryPathOf(kind: CarryPathKind): CarryPath {
  return kind === 'cubic' ? cubicBezierCarryPath : quinticViaCarryPath;
}

/** The preset {@link HandGeometry} for a preset kind and hand count (DESIGN.md §7). */
export function presetGeometry(preset: HandPreset, handCount: number): HandGeometry {
  return preset === 'circle' ? circleHandGeometry(handCount) : lineHandGeometry(handCount);
}

/** Sample a geometry's per-hand throw/catch points for hands [0, handCount). */
export function sampleHandPoints(
  geometry: HandGeometry,
  handCount: number,
): { throwPoints: Vec3[]; catchPoints: Vec3[] } {
  const throwPoints: Vec3[] = [];
  const catchPoints: Vec3[] = [];
  for (let hand = 0; hand < handCount; hand++) {
    throwPoints.push(geometry.throwPoint(hand));
    catchPoints.push(geometry.catchPoint(hand));
  }
  return { throwPoints, catchPoints };
}

// --- 3D scene view settings (DESIGN.md §6, §7) ------------------------------
// These are presentation-only: they never rebuild the simulation (a pure
// function of time, DESIGN.md §2). The 3D scene reads them; nothing else does.

/** Sphere radius in meters (DESIGN.md §7). */
export const DEFAULT_BALL_RADIUS = 0.035;
export const BALL_RADIUS_MIN = 0.01;
export const BALL_RADIUS_MAX = 0.1;
/** Single ball color used when orbit coloring is off (DESIGN.md §7). */
export const DEFAULT_BALL_COLOR = '#2f6fed';
/** Orbit coloring off by default (single configurable color, DESIGN.md §6, §7). */
export const DEFAULT_ORBIT_COLORING = false;

// --- Timeline-bar settings (DESIGN.md §6) — presentation only ---------------
// The window, trail length, and ghost toggle shape the timeline bar + 3D tracers
// (DESIGN.md §6). They never change simulation *content* (a pure function of
// time, DESIGN.md §2); the only sim touch they make is horizon EXTENSION (growing
// the generated range, same append-only mechanism as the clock), never a rebuild.
// The window range/helpers live in ./simulation; views import them from there
// (as the ladder already does).

/**
 * Trailing tracer length in seconds (DESIGN.md §6). Default 0.8 s: a "tasteful
 * ~1 s" trail that at the default 3 s window (past span 0.9 s) leaves the detach
 * handle just inside the left edge — draggable, not yet pinned. The handle drags
 * to at most the past span; longer trails (up to {@link TRAIL_LENGTH_MAX}) are set
 * via the slider and pin the handle to the left edge with a numeric readout.
 */
export const DEFAULT_TRAIL_LENGTH = 0.8;
export const TRAIL_LENGTH_MIN = 0;
export const TRAIL_LENGTH_MAX = 8;
/** Future ghost paths on by default so the forward preview is visible (DESIGN.md §6). */
export const DEFAULT_GHOSTS_ENABLED = true;

/** The t_d slider cap = 0.9·n_h·τ_b (NOTATION.md identity 4; DESIGN.md §7). */
export function dwellCap(handCount: number, beatPeriod: number): number {
  return DWELL_CAP_FRACTION * handCount * beatPeriod;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

// --- Store shape ------------------------------------------------------------

export interface AppStore {
  // config (DESIGN.md §7)
  /** Pattern input text; may be invalid (the last valid sim keeps running). */
  readonly pattern: string;
  /** τ_b target (s) — the slider value; the grid slews toward it across epochs. */
  readonly beatPeriod: number;
  /** t_d target (s), clamped to {@link dwellCap}. */
  readonly dwellTime: number;
  /** Playback speed (wall->sim rescale only; no physical effect). */
  readonly playbackSpeed: number;
  /** n_h, the hand count (1–8). A change is a full rebuild, not an epoch. */
  readonly handCount: number;

  // runtime physics (DESIGN.md §4.6, §6, §7) — applied via kinematics epochs
  // (future events only), except n_h/preset which are full rebuilds.
  /** g target (m/s²); a change applies to future throws only. */
  readonly gravity: number;
  /** holdDepth target (m); a change applies to future carries only. */
  readonly holdDepth: number;
  /** Active carry path: quintic (hold dip, default) or cubic (comparison). */
  readonly carryPathKind: CarryPathKind;
  /** Current per-hand throw points (x/z editable; y stays {@link HAND_Y}). */
  readonly handThrowPoints: Vec3[];
  /** Current per-hand catch points (x/z editable; y stays {@link HAND_Y}). */
  readonly handCatchPoints: Vec3[];
  /** The last hand-geometry preset chosen (line/circle); an n_h change re-applies it. */
  readonly handPreset: HandPreset;
  /** Whether the hand-positions editor is open (gizmos show only when open, §6). */
  readonly positionsEditorOpen: boolean;

  // 3D scene view settings (DESIGN.md §6, §7) — presentation only, no rebuild.
  /** Ball sphere radius in meters. */
  readonly ballRadius: number;
  /** When true, color balls by orbit; otherwise use the single {@link ballColor}. */
  readonly orbitColoring: boolean;
  /** The single ball color (CSS string) used when orbit coloring is off. */
  readonly ballColor: string;

  // timeline-bar settings (DESIGN.md §6) — presentation only, no sim rebuild.
  /** Visible window width (s) for the timeline bar + ladder (1–15, DESIGN.md §7). */
  readonly timelineWindow: number;
  /** Trailing tracer length (s); may exceed the window (handle pins, DESIGN.md §6). */
  readonly trailLength: number;
  /** Whether dashed future ghost paths are drawn (DESIGN.md §6, toggleable). */
  readonly ghostsEnabled: boolean;

  // clock (DESIGN.md §2)
  readonly simTime: number;
  readonly playing: boolean;

  // timeline construction inputs (base params at beat 0 + later epochs)
  readonly baseParams: TimelineParams;
  readonly epochs: Epoch[];

  // kinematics construction inputs: base gravity/holdDepth/carryPath/geometry at
  // t = 0 (`baseKinematics`) + later runtime epochs (`kinematicsEpochs`).
  readonly baseKinematics: Omit<KinematicsConfig, 'epochs'>;
  readonly kinematicsEpochs: KinematicsConfig['epochs'];

  // derived
  /** Validation of the current `pattern` text (drives the error line). */
  readonly validation: ValidationResult;
  /** The last valid simulation (never reflects an invalid input). */
  readonly sim: Simulation;

  // actions
  setPattern(text: string): void;
  setBeatPeriod(beatPeriod: number): void;
  setDwellTime(dwellTime: number): void;
  setPlaybackSpeed(playbackSpeed: number): void;
  /** g slider (0.5–30). Applies to future throws only (kinematics epoch). */
  setGravity(gravity: number): void;
  /** holdDepth slider (0–0.4 m). Applies to future carries only (kinematics epoch). */
  setHoldDepth(holdDepth: number): void;
  /** Toggle the carry path (quintic ↔ cubic). Applies to future carries only. */
  setCarryPathKind(kind: CarryPathKind): void;
  /** n_h stepper (1–8). FULL rebuild: geometry resets to the current preset for n. */
  setHandCount(handCount: number): void;
  /** Hand-geometry preset (line/circle). FULL rebuild at the current n_h. */
  setHandPreset(preset: HandPreset): void;
  /** Move one hand's catch/throw point (x, z; y fixed). Future throws only (epoch). */
  setHandPoint(hand: number, kind: HandPointKind, x: number, z: number): void;
  /** Open/close the hand-positions editor (gizmos show only when open, §6). */
  setPositionsEditorOpen(open: boolean): void;
  togglePositionsEditor(): void;
  setBallRadius(ballRadius: number): void;
  setOrbitColoring(orbitColoring: boolean): void;
  toggleOrbitColoring(): void;
  setBallColor(ballColor: string): void;
  setTimelineWindow(timelineWindow: number): void;
  setTrailLength(trailLength: number): void;
  setGhostsEnabled(ghostsEnabled: boolean): void;
  toggleGhosts(): void;
  setPlaying(playing: boolean): void;
  togglePlaying(): void;
  restart(): void;
  /**
   * Scrub the clock: set `simTime` directly (DESIGN.md §2). Clamps to t ≥ 0 and
   * triggers horizon extension when dragged forward (same append-only mechanism
   * as {@link tick}). Works paused or playing; the timeline bar drives it.
   */
  setSimTime(simTime: number): void;
  /** Advance the clock by `wallDeltaSeconds` of wall time (rAF loop only). */
  tick(wallDeltaSeconds: number): void;
}

function initialBaseParams(): TimelineParams {
  return {
    beatPeriod: DEFAULT_BEAT_PERIOD,
    dwellTime: DEFAULT_DWELL_TIME,
    handCount: DEFAULT_HAND_COUNT,
  };
}

/** Base kinematics (t = 0) at startup: DESIGN §7 defaults, line preset for n_h. */
function initialBaseKinematics(): Omit<KinematicsConfig, 'epochs'> {
  const { gravity, holdDepth, carryPath, geometry } = defaultKinematicsConfig(DEFAULT_HAND_COUNT);
  return { gravity, holdDepth, carryPath, geometry };
}

/** The full kinematics config from base params + the current epoch list. */
function kinematicsConfigOf(
  base: Omit<KinematicsConfig, 'epochs'>,
  epochs: KinematicsConfig['epochs'],
): KinematicsConfig {
  return { ...base, epochs };
}

function initialSimulation(): { validation: ValidationResult; sim: Simulation } {
  const validation = validatePattern(DEFAULT_PATTERN);
  // The default pattern is valid by construction; the fallback keeps types total.
  const values = validation.ok ? validation.values : [3];
  const sim = buildSimulation(
    values,
    DEFAULT_PATTERN,
    initialBaseParams(),
    [],
    INITIAL_BEATS,
    kinematicsConfigOf(initialBaseKinematics(), []),
  );
  return { validation, sim };
}

export const useAppStore = create<AppStore>((set, get) => {
  const { validation, sim } = initialSimulation();

  /**
   * Apply a runtime τ_b / t_d change as an epoch at the current playhead beat so
   * the past stays immutable (DESIGN.md §2). A change at beat 0 folds into the
   * base params (equivalent, and keeps the epoch list empty at startup). The
   * current kinematics config carries over unchanged.
   */
  function applyParamChange(partial: EpochParams): Partial<AppStore> {
    const state = get();
    const beat = firstBeatAtOrAfter(state.sim.timeline, state.simTime);
    let baseParams = state.baseParams;
    let epochs = state.epochs;
    if (beat <= 0) {
      baseParams = { ...baseParams, ...partial };
    } else {
      epochs = upsertEpoch(state.epochs, beat, partial);
    }
    const nextSim = buildSimulation(
      state.sim.values,
      state.sim.patternText,
      baseParams,
      epochs,
      state.sim.beatCount,
      kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
    );
    return { baseParams, epochs, sim: nextSim };
  }

  /**
   * Apply a runtime gravity / holdDepth / geometry / carry-path change as a
   * KINEMATICS epoch at the current playhead beat boundary (DESIGN.md §4.6):
   * future events only — an in-flight ball keeps its parabola, a carry in progress
   * keeps its path. The epoch time is snapped to the next beat's start time so
   * successive drags within a beat coalesce (mirrors the timeline side). A change
   * at beat 0 folds into the base kinematics (keeps the epoch list empty at start).
   */
  function applyKinematicsChange(change: KinematicsEpochChange): Partial<AppStore> {
    const state = get();
    const beat = firstBeatAtOrAfter(state.sim.timeline, state.simTime);
    let baseKinematics = state.baseKinematics;
    let kinematicsEpochs = state.kinematicsEpochs;
    if (beat <= 0) {
      baseKinematics = { ...baseKinematics, ...change };
    } else {
      const time = state.sim.timeline.beatTime(beat);
      kinematicsEpochs = upsertKinematicsEpoch(state.kinematicsEpochs, time, change);
    }
    const nextSim = buildSimulation(
      state.sim.values,
      state.sim.patternText,
      state.baseParams,
      state.epochs,
      state.sim.beatCount,
      kinematicsConfigOf(baseKinematics, kinematicsEpochs),
    );
    return { baseKinematics, kinematicsEpochs, sim: nextSim };
  }

  const startKinematics = initialBaseKinematics();
  const startPoints = sampleHandPoints(startKinematics.geometry, DEFAULT_HAND_COUNT);

  return {
    pattern: DEFAULT_PATTERN,
    beatPeriod: DEFAULT_BEAT_PERIOD,
    dwellTime: DEFAULT_DWELL_TIME,
    playbackSpeed: DEFAULT_PLAYBACK_SPEED,
    handCount: DEFAULT_HAND_COUNT,

    gravity: DEFAULT_GRAVITY_VALUE,
    holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
    carryPathKind: 'quintic',
    handThrowPoints: startPoints.throwPoints,
    handCatchPoints: startPoints.catchPoints,
    handPreset: 'line',
    positionsEditorOpen: false,

    ballRadius: DEFAULT_BALL_RADIUS,
    orbitColoring: DEFAULT_ORBIT_COLORING,
    ballColor: DEFAULT_BALL_COLOR,

    timelineWindow: DEFAULT_TIMELINE_WINDOW,
    trailLength: DEFAULT_TRAIL_LENGTH,
    ghostsEnabled: DEFAULT_GHOSTS_ENABLED,

    simTime: 0,
    playing: true,

    baseParams: initialBaseParams(),
    epochs: [],

    baseKinematics: startKinematics,
    kinematicsEpochs: [],

    validation,
    sim,

    setPattern: (text) => {
      const nextValidation = validatePattern(text);
      if (!nextValidation.ok) {
        // Invalid input: surface the error but keep the last valid sim running.
        set({ pattern: text, validation: nextValidation });
        return;
      }
      const state = get();
      // Pattern change is a hard rebuild (soft state-graph transitions are Phase
      // 8). The timing + kinematics history (base + epochs) and the clock carry
      // over.
      const nextSim = buildSimulation(
        nextValidation.values,
        text,
        state.baseParams,
        state.epochs,
        state.sim.beatCount,
        kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
      );
      set({ pattern: text, validation: nextValidation, sim: nextSim });
    },

    setBeatPeriod: (raw) => {
      const state = get();
      const beatPeriod = clamp(raw, BEAT_PERIOD_MIN, BEAT_PERIOD_MAX);
      // A smaller τ_b shrinks the dwell cap; keep t_d within it so the readout is
      // honest (core also clamps per-beat, but the slider should agree).
      const dwellTime = clamp(state.dwellTime, DWELL_MIN, dwellCap(state.handCount, beatPeriod));
      set({ beatPeriod, dwellTime, ...applyParamChange({ beatPeriod, dwellTime }) });
    },

    setDwellTime: (raw) => {
      const state = get();
      const dwellTime = clamp(raw, DWELL_MIN, dwellCap(state.handCount, state.beatPeriod));
      set({ dwellTime, ...applyParamChange({ dwellTime }) });
    },

    setPlaybackSpeed: (raw) => {
      set({ playbackSpeed: clamp(raw, PLAYBACK_MIN, PLAYBACK_MAX) });
    },

    // Runtime physics: gravity / holdDepth / carry path apply to FUTURE events
    // only (kinematics epoch), never a silent rebuild of the past (DESIGN.md §4.6).
    setGravity: (raw) => {
      const gravity = clamp(raw, GRAVITY_MIN, GRAVITY_MAX);
      set({ gravity, ...applyKinematicsChange({ gravity }) });
    },
    setHoldDepth: (raw) => {
      const holdDepth = clamp(raw, HOLD_DEPTH_MIN, HOLD_DEPTH_MAX);
      set({ holdDepth, ...applyKinematicsChange({ holdDepth }) });
    },
    setCarryPathKind: (kind) => {
      set({ carryPathKind: kind, ...applyKinematicsChange({ carryPath: carryPathOf(kind) }) });
    },

    // Hand geometry edit: move one hand's catch/throw point (x, z; y fixed at
    // HAND_Y). A future-only geometry epoch — the acceptance scenario "moving a
    // catch point mid-flight affects only later throws" (DESIGN.md §4.6).
    setHandPoint: (hand, kind, x, z) => {
      const state = get();
      if (hand < 0 || hand >= state.handCount) {
        return;
      }
      const throwPoints = state.handThrowPoints.slice();
      const catchPoints = state.handCatchPoints.slice();
      const target = kind === 'throw' ? throwPoints : catchPoints;
      const previous = target[hand];
      target[hand] = vec3(x, previous ? previous.y : HAND_Y, z);
      const geometry = makeHandGeometry(throwPoints, catchPoints);
      set({
        handThrowPoints: throwPoints,
        handCatchPoints: catchPoints,
        ...applyKinematicsChange({ geometry }),
      });
    },

    // n_h and the preset are the exception: they cannot be epochs (an in-flight
    // ball's frozen landing hand and the new beat→hand map cannot both hold —
    // BUILD_LOG Phase 1). A FULL rebuild through the store: the clock and pattern
    // carry over; geometry resets to the current preset for the new n_h; the
    // current gravity/holdDepth/carryPath fold into the fresh base (kinematics
    // epochs are cleared, since geometry epochs are tied to the old hand indices).
    setHandCount: (raw) => {
      const state = get();
      const handCount = clamp(Math.round(raw), HAND_COUNT_MIN, HAND_COUNT_MAX);
      if (handCount === state.handCount) {
        return;
      }
      const geometry = presetGeometry(state.handPreset, handCount);
      const { throwPoints, catchPoints } = sampleHandPoints(geometry, handCount);
      const baseParams: TimelineParams = { ...state.baseParams, handCount };
      const baseKinematics: Omit<KinematicsConfig, 'epochs'> = {
        gravity: state.gravity,
        holdDepth: state.holdDepth,
        carryPath: carryPathOf(state.carryPathKind),
        geometry,
      };
      // Re-clamp the dwell readout to the new cap (0.9·n_h·τ_b); core also clamps.
      const dwellTime = clamp(state.dwellTime, DWELL_MIN, dwellCap(handCount, state.beatPeriod));
      const nextSim = buildSimulation(
        state.sim.values,
        state.sim.patternText,
        baseParams,
        state.epochs,
        state.sim.beatCount,
        kinematicsConfigOf(baseKinematics, []),
      );
      set({
        handCount,
        dwellTime,
        baseParams,
        baseKinematics,
        kinematicsEpochs: [],
        handThrowPoints: throwPoints,
        handCatchPoints: catchPoints,
        sim: nextSim,
      });
    },
    setHandPreset: (preset) => {
      const state = get();
      const geometry = presetGeometry(preset, state.handCount);
      const { throwPoints, catchPoints } = sampleHandPoints(geometry, state.handCount);
      const baseKinematics: Omit<KinematicsConfig, 'epochs'> = {
        gravity: state.gravity,
        holdDepth: state.holdDepth,
        carryPath: carryPathOf(state.carryPathKind),
        geometry,
      };
      const nextSim = buildSimulation(
        state.sim.values,
        state.sim.patternText,
        state.baseParams,
        state.epochs,
        state.sim.beatCount,
        kinematicsConfigOf(baseKinematics, []),
      );
      set({
        handPreset: preset,
        baseKinematics,
        kinematicsEpochs: [],
        handThrowPoints: throwPoints,
        handCatchPoints: catchPoints,
        sim: nextSim,
      });
    },

    setPositionsEditorOpen: (open) => set({ positionsEditorOpen: open }),
    togglePositionsEditor: () =>
      set((state) => ({ positionsEditorOpen: !state.positionsEditorOpen })),

    // View settings never touch the sim (DESIGN.md §2): plain, clamped setters.
    setBallRadius: (raw) => {
      set({ ballRadius: clamp(raw, BALL_RADIUS_MIN, BALL_RADIUS_MAX) });
    },
    setOrbitColoring: (orbitColoring) => set({ orbitColoring }),
    toggleOrbitColoring: () => set((state) => ({ orbitColoring: !state.orbitColoring })),
    setBallColor: (ballColor) => set({ ballColor }),

    // Timeline-bar settings. Trail length + ghost toggle are pure presentation
    // (never touch the sim). A wider window may need more future generated, so it
    // runs the SAME horizon extension as the clock (never a rebuild — past events
    // stay bit-identical, DESIGN.md §2). At startup the horizon (~40 s) already
    // covers the widest window, so the common case is a no-op (sim ref preserved).
    setTimelineWindow: (raw) => {
      const timelineWindow = clamp(raw, TIMELINE_WINDOW_MIN, TIMELINE_WINDOW_MAX);
      const state = get();
      const { futureSpan } = windowSpans(timelineWindow);
      const nextSim = extendedIfNeeded(
        state.sim,
        state.baseParams,
        state.epochs,
        state.simTime,
        futureSpan,
        kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
      );
      set(nextSim === state.sim ? { timelineWindow } : { timelineWindow, sim: nextSim });
    },
    setTrailLength: (raw) => set({ trailLength: clamp(raw, TRAIL_LENGTH_MIN, TRAIL_LENGTH_MAX) }),
    setGhostsEnabled: (ghostsEnabled) => set({ ghostsEnabled }),
    toggleGhosts: () => set((state) => ({ ghostsEnabled: !state.ghostsEnabled })),

    setPlaying: (playing) => set({ playing }),
    togglePlaying: () => set((state) => ({ playing: !state.playing })),
    restart: () => set({ simTime: 0 }),

    setSimTime: (raw) => {
      const simTime = Math.max(0, raw);
      const state = get();
      const { futureSpan } = windowSpans(state.timelineWindow);
      const nextSim = extendedIfNeeded(
        state.sim,
        state.baseParams,
        state.epochs,
        simTime,
        futureSpan,
        kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
      );
      set(nextSim === state.sim ? { simTime } : { simTime, sim: nextSim });
    },

    tick: (wallDeltaSeconds) => {
      const state = get();
      if (!state.playing) {
        return;
      }
      const simTime = state.simTime + wallDeltaSeconds * state.playbackSpeed;
      const { futureSpan } = windowSpans(state.timelineWindow);
      const nextSim = extendedIfNeeded(
        state.sim,
        state.baseParams,
        state.epochs,
        simTime,
        futureSpan,
        kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
      );
      set(nextSim === state.sim ? { simTime } : { simTime, sim: nextSim });
    },
  };
});

/**
 * Smoke value exercising the state -> core dependency direction (DESIGN.md §2)
 * with default timing (DESIGN.md §7): t_d = 0.30 s, h = 3, τ_b = 0.25 s.
 * (Retained from Phase 0; also used by the state-layer test.)
 */
export const defaultEffectiveDwell = effectiveDwell(0.3, 3, 0.25);
