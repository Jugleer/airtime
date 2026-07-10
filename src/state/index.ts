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
import { formatPattern, validatePattern, type ValidationResult } from '../core/siteswap';
import {
  periodicSchedule,
  spliceSchedule,
  type Epoch,
  type PatternSchedule,
  type TimelineParams,
} from '../core/timeline';
import {
  advanceState,
  buildStateGraph,
  GRAPH_DEFAULT_N,
  GRAPH_MAX_N,
  maxThrowOf,
  patternCycle,
  planTransition,
  shortestCycle,
  stateToBits,
  type StateBits,
  type TransitionPlan,
} from '../core/stategraph';
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
  earliestGlitchFreeSpliceBeat,
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
  type TransitionInfo,
} from './simulation';
import type { CameraPose, ShareConfig } from './codec';
import {
  deletePresetFrom,
  getLocalStorage,
  loadPresetFrom,
  presetNamesOf,
  readPresetMap,
  savePresetTo,
} from './presets';
import { sampleCamera } from './sceneBridge';

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
/** The default carry path (DESIGN.md §7): the physical quintic (hold dip). Single
 *  source of truth for the carry-path reset affordance in the sidebar. */
export const DEFAULT_CARRY_PATH_KIND: CarryPathKind = 'quintic';
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
/** Single ball color used when per-ball coloring is off (DESIGN.md §7). */
export const DEFAULT_BALL_COLOR = '#2f6fed';
/**
 * Per-ball coloring ON by default (owner decision 2026-07-10, superseding the
 * DESIGN.md §7 default): each ball keeps its own palette color (state/ballColors),
 * identical in the ladder and the 3D scene. The field keeps its historical name
 * (`orbitColoring`, codec key `oc`) to avoid store/codec churn.
 */
export const DEFAULT_ORBIT_COLORING = true;

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

// --- Charts & energy panel settings (DESIGN.md §6) — presentation only --------
// The charts panel plots per-hand |v|/|a|/|j| over the same window as the
// timeline bar; the axis mode selects magnitude or a single component. Both are
// presentation-only (like ballRadius): they never touch the sim (a pure function
// of time, DESIGN.md §2). `chartsVisible` also gates the per-frame sampling —
// when the panel is hidden nothing is sampled or drawn.

/** Which scalar the charts plot: the vector magnitude or one axis component. */
export type ChartAxisMode = 'magnitude' | 'x' | 'y' | 'z';
/**
 * Charts + energy panel COLLAPSED by default (redesign 2026-07-10, owner override:
 * the bottom dock starts collapsed so the scene/ladder get full height and no
 * per-frame chart sampling runs until the operator opens the dock). Was `true`.
 * `chartsVisible` still round-trips the URL codec, so a shared link carries the
 * explicit state; only the fresh-boot default changed.
 */
export const DEFAULT_CHARTS_VISIBLE = false;
/** Charts plot magnitude by default; the per-axis toggle switches to x/y/z. */
export const DEFAULT_CHART_AXIS_MODE: ChartAxisMode = 'magnitude';

// --- State-graph settings (DESIGN.md §5, §7) ----------------------------------
// The graph itself is derived in the UI from core/stategraph per (b, N) and
// memoized; the store owns N, the panel visibility, an in-progress transition
// (splice metadata) and the last navigation notice (different-b hard reset, graph
// unavailable). Navigation actions splice the running timeline (bit-identical
// past; in-flight balls unaffected) — see navigateToPattern / navigateToState.

/** N stepper range for the state graph (DESIGN.md §7: 3–11, warn ≥ 9). */
export const GRAPH_N_MIN = 3;
export const GRAPH_N_MAX = GRAPH_MAX_N;
/** Default N (DESIGN.md §7). */
export const DEFAULT_GRAPH_MAX_HEIGHT = GRAPH_DEFAULT_N;
/**
 * State-graph overlay HIDDEN by default (redesign 2026-07-10, owner override: the
 * graph is a translucent overlay over the 3D scene, toggled from the scene's
 * top-left corner, and starts OFF so the scene reads cleanly). Was `true`.
 * `graphVisible` still round-trips the URL codec; only the fresh-boot default changed.
 */
export const DEFAULT_GRAPH_VISIBLE = false;

// --- Theme (redesign 2026-07-10) — a pure VIEW preference, dark by default. It is
// deliberately NOT part of ShareConfig, so the URL codec is unchanged (a shared
// link does not carry the viewer's theme). It lives in the store only so the
// canvas charts + SVG views can read the active palette without prop-drilling.
/** The color theme names (see ui/theme for the palettes). */
export type ThemeName = 'dark' | 'light';
/** Dark is the design default (owner override 2026-07-10). */
export const DEFAULT_THEME: ThemeName = 'dark';

// --- Audio settings (DESIGN.md §6) — the WebAudio ticks live in ui/useAudio; the
// store owns the toggles + volume so they persist through the URL codec and
// presets. Default OFF is the autoplay-policy-safe choice: enabling audio is a
// user gesture, which is exactly when the AudioContext may be created/resumed.
export const DEFAULT_AUDIO_ENABLED = false;
/** A separate catch tick (on top of the throw tick), on by default when audio is. */
export const DEFAULT_CATCH_TICK_ENABLED = true;
/** Master tick volume (0–1). */
export const DEFAULT_AUDIO_VOLUME = 0.5;
export const AUDIO_VOLUME_MIN = 0;
export const AUDIO_VOLUME_MAX = 1;

// --- Camera (DESIGN.md §6) — the store holds the camera pose so it round-trips
// through the URL codec (applying a URL sets the camera). The live OrbitControls
// view (a user free-orbits without touching the store) is sampled on demand via
// the scene bridge when building a share link. Default = the front preset view
// (mirrors render3d's presetView('front'); kept in sync by the preset buttons).
export const DEFAULT_CAMERA_POSE: CameraPose = {
  position: [0, 1.35, 3.2],
  target: [0, 1.35, 0],
};

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
  /**
   * When true, each ball keeps its own palette color (state/ballColors, keyed by
   * the stable ballId — identical in ladder and 3D); otherwise all balls use the
   * single {@link ballColor}. Historical field name kept (was per-orbit coloring).
   */
  readonly orbitColoring: boolean;
  /** The single ball color (CSS string) used when per-ball coloring is off. */
  readonly ballColor: string;

  // timeline-bar settings (DESIGN.md §6) — presentation only, no sim rebuild.
  /** Visible window width (s) for the timeline bar + ladder (1–15, DESIGN.md §7). */
  readonly timelineWindow: number;
  /** Trailing tracer length (s); may exceed the window (handle pins, DESIGN.md §6). */
  readonly trailLength: number;
  /** Whether dashed future ghost paths are drawn (DESIGN.md §6, toggleable). */
  readonly ghostsEnabled: boolean;

  // charts & energy panel settings (DESIGN.md §6) — presentation only, no rebuild.
  /** Whether the charts + energy panel is shown (also gates per-frame sampling). */
  readonly chartsVisible: boolean;
  /** Which scalar the charts plot: magnitude (default) or one axis component. */
  readonly chartAxisMode: ChartAxisMode;

  // state-graph settings & navigation (DESIGN.md §5)
  /** N, the graph's maximum throw value (3–11; auto-expands to fit patterns). */
  readonly graphMaxHeight: number;
  /** Whether the state-graph panel is shown (collapsible, like the charts). */
  readonly graphVisible: boolean;
  /** The in-progress transition's splice metadata (null = on the pattern). */
  readonly transition: TransitionInfo | null;
  /** The last navigation notice (hard reset / graph unavailable), or null. */
  readonly graphNotice: string | null;

  // audio settings (DESIGN.md §6) — WebAudio ticks synthesized in ui/useAudio.
  /** Master audio toggle (default OFF for autoplay policy). */
  readonly audioEnabled: boolean;
  /** Whether a distinct catch tick plays in addition to the throw tick. */
  readonly catchTickEnabled: boolean;
  /** Master tick volume (0–1). */
  readonly audioVolume: number;

  // camera (DESIGN.md §6) — the pose the codec persists / a URL applies.
  /** The camera pose applied on boot / by preset; sampled live for share links. */
  readonly cameraView: CameraPose;

  // theme (redesign 2026-07-10) — a view preference, not shared via the codec.
  /** Active color theme (dark by default). */
  readonly theme: ThemeName;

  // presets (DESIGN.md §6) — names of the localStorage saves (config lives there).
  /** Sorted names of the saved presets (empty when storage is unavailable). */
  readonly presetNames: string[];

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
  /**
   * Pattern entry (DESIGN.md §5): same-b patterns TRANSITION smoothly through the
   * state graph (the running timeline is spliced — past bit-identical, in-flight
   * balls unaffected); different-b or beyond-the-graph patterns hard-rebuild with
   * a visible notice. Invalid text only surfaces the error (sim keeps running).
   * `setPattern` is the same action (typed entry routes through navigation).
   */
  navigateToPattern(text: string): void;
  setPattern(text: string): void;
  /**
   * Click-to-navigate (DESIGN.md §5): BFS from the current state to `stateBits`.
   * A state on the current pattern's cycle re-enters the pattern at that node;
   * a bare state holds the shortest cycle through it (which becomes the running
   * pattern, shown in the input). Ignored for states outside the current graph.
   */
  navigateToState(stateBits: StateBits): void;
  /**
   * Hard reset (DESIGN.md §5): restart clean at t = 0 with the running pattern —
   * periodic schedule (any transition cleared), epochs cleared, current slider
   * values folded into the base params.
   */
  hardReset(): void;
  /** N stepper (3–11); never drops below the running pattern's max throw. */
  setGraphMaxHeight(n: number): void;
  /** Show/hide the state-graph panel (hidden ⇒ nothing derived or drawn). */
  setGraphVisible(graphVisible: boolean): void;
  toggleGraph(): void;
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
  /** Show/hide the charts + energy panel (hidden ⇒ no per-frame sampling). */
  setChartsVisible(chartsVisible: boolean): void;
  toggleCharts(): void;
  /** Choose the charts' plotted scalar: magnitude or an x/y/z component. */
  setChartAxisMode(chartAxisMode: ChartAxisMode): void;
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

  // --- Audio (DESIGN.md §6) --------------------------------------------------
  setAudioEnabled(enabled: boolean): void;
  toggleAudio(): void;
  setCatchTickEnabled(enabled: boolean): void;
  toggleCatchTick(): void;
  setAudioVolume(volume: number): void;

  // --- Camera (DESIGN.md §6) — preset buttons + URL boot set the pose --------
  setCameraView(view: CameraPose): void;

  // --- Theme (redesign 2026-07-10) — view preference, not codec-persisted -----
  setTheme(theme: ThemeName): void;
  toggleTheme(): void;

  // --- Save / share (DESIGN.md §6) ------------------------------------------
  /**
   * Snapshot the full shareable config (the URL codec / preset / JSON payload):
   * the running valid pattern, every slider, the hand geometry, view toggles,
   * audio, and the LIVE camera (sampled from OrbitControls via the scene bridge).
   */
  currentConfig(): ShareConfig;
  /**
   * Apply a full config (URL boot > defaults, or a loaded preset / imported JSON):
   * a clean rebuild at t = 0 — base params + kinematics folded from the config,
   * epochs cleared, every view/audio/camera field set. Out-of-range values are
   * clamped and a bad pattern falls back to the default so a malformed payload
   * never crashes (DESIGN.md §6).
   */
  applyConfig(config: ShareConfig): void;
  /** Save the current config under `name` in localStorage (no-op if unavailable). */
  savePreset(name: string): void;
  /** Load a named preset and apply it (no-op when the name is absent). */
  loadPreset(name: string): void;
  /** Delete a named preset from localStorage. */
  deletePreset(name: string): void;
  /** Re-read the preset name list from localStorage (e.g. after an import). */
  refreshPresetNames(): void;
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
      state.sim.schedule,
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
      state.sim.schedule,
    );
    return { baseKinematics, kinematicsEpochs, sim: nextSim };
  }

  /**
   * Hard rebuild for a new pattern (no transition possible: different b, or a
   * pattern beyond the graph cap): periodic schedule, any transition cleared. The
   * clock and the timing/kinematics history carry over — this is exactly the
   * pre-Phase-8 setPattern behavior, now with a visible notice (DESIGN.md §5).
   */
  function hardRebuildPatch(
    values: number[],
    text: string,
    validation: ValidationResult,
    notice: string | null,
  ): Partial<AppStore> {
    const state = get();
    const nextSim = buildSimulation(
      values,
      text,
      state.baseParams,
      state.epochs,
      state.sim.beatCount,
      kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
    );
    // Auto-expand N so the new pattern's cycle fits the graph (DESIGN.md §5);
    // a beyond-cap pattern leaves N alone (the panel shows "unavailable").
    const newMax = maxThrowOf(values);
    const graphMaxHeight =
      newMax <= GRAPH_MAX_N ? Math.max(state.graphMaxHeight, newMax) : state.graphMaxHeight;
    return {
      pattern: text,
      validation,
      sim: nextSim,
      transition: null,
      graphNotice: notice,
      graphMaxHeight,
    };
  }

  /**
   * Defensive splice validation (the prompt's "validate anyway"): the bridge must
   * be a legal beat-by-beat advance from the state at the splice beat. BFS
   * guarantees this; a violation indicates a bug and throws loudly rather than
   * splicing a colliding schedule into the running sim.
   */
  function assertBridgeLegal(source: StateBits, plan: TransitionPlan, maxHeight: number): void {
    let current = source;
    for (const throwValue of plan.throws) {
      const next = advanceState(current, throwValue, maxHeight);
      if (next === null) {
        throw new Error(
          `state-graph splice bug: throw ${throwValue} is illegal from state ${current} (N=${maxHeight})`,
        );
      }
      current = next;
    }
    if (current !== plan.to) {
      throw new Error(
        `state-graph splice bug: bridge lands on state ${current}, expected ${plan.to}`,
      );
    }
  }

  /** Bits needed to hold a state (index of the highest set bit + 1). */
  function bitsNeeded(bits: StateBits): number {
    return 32 - Math.clz32(bits >>> 0);
  }

  /**
   * The shared navigation core (DESIGN.md §5): splice the running timeline at the
   * next beat boundary with the BFS bridge to `plan.to`, then repeat
   * `holdValues` phased so beat `spliceBeat + bridge` throws `holdValues[phase]`.
   * Everything strictly before the splice beat is bit-identical (property-tested
   * in core/timeline); in-flight balls keep flying — the glitch-free morph.
   */
  function spliceIntoSim(
    state: AppStore,
    spliceBeat: number,
    plan: TransitionPlan,
    holdValues: number[],
    holdPhase: number,
    holdText: string,
  ): { sim: Simulation; transition: TransitionInfo | null } {
    const schedule: PatternSchedule = spliceSchedule(
      state.sim.schedule ?? periodicSchedule(state.sim.values),
      spliceBeat,
      plan.throws,
      holdValues,
      holdPhase,
    );
    const sim = buildSimulation(
      holdValues,
      holdText,
      state.baseParams,
      state.epochs,
      state.sim.beatCount,
      kinematicsConfigOf(state.baseKinematics, state.kinematicsEpochs),
      schedule,
    );
    const transition: TransitionInfo | null =
      plan.throws.length > 0
        ? { targetText: holdText, startBeat: spliceBeat, endBeat: spliceBeat + plan.throws.length }
        : null;
    return { sim, transition };
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
    carryPathKind: DEFAULT_CARRY_PATH_KIND,
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

    chartsVisible: DEFAULT_CHARTS_VISIBLE,
    chartAxisMode: DEFAULT_CHART_AXIS_MODE,

    graphMaxHeight: DEFAULT_GRAPH_MAX_HEIGHT,
    graphVisible: DEFAULT_GRAPH_VISIBLE,
    transition: null,
    graphNotice: null,

    audioEnabled: DEFAULT_AUDIO_ENABLED,
    catchTickEnabled: DEFAULT_CATCH_TICK_ENABLED,
    audioVolume: DEFAULT_AUDIO_VOLUME,

    cameraView: DEFAULT_CAMERA_POSE,

    theme: DEFAULT_THEME,

    presetNames: presetNamesOf(readPresetMap(getLocalStorage())),

    simTime: 0,
    playing: true,

    baseParams: initialBaseParams(),
    epochs: [],

    baseKinematics: startKinematics,
    kinematicsEpochs: [],

    validation,
    sim,

    navigateToPattern: (text) => {
      const nextValidation = validatePattern(text);
      if (!nextValidation.ok) {
        // Invalid input: surface the error but keep the last valid sim running.
        set({ pattern: text, validation: nextValidation });
        return;
      }
      const state = get();
      const values = nextValidation.values;
      const canonicalText = formatPattern(values);
      const targetMax = maxThrowOf(values);
      const currentMax = maxThrowOf(state.sim.values);

      // Patterns whose max throw exceeds the graph cap cannot live in the graph
      // (DESIGN.md §5): the sim still runs via a hard rebuild; the panel shows
      // the unavailable notice. Same when the RUNNING pattern is off-graph (its
      // state needs more than N bits, so no transition can start from it).
      if (targetMax > GRAPH_MAX_N) {
        set(
          hardRebuildPatch(
            values,
            text,
            nextValidation,
            `State graph unavailable for ${canonicalText} (max throw ${targetMax} > ${GRAPH_MAX_N}). Hard reset — no transition.`,
          ),
        );
        return;
      }
      // Different b: unreachable in the graph (DESIGN.md §5) — hard reset + notice.
      if (nextValidation.ballCount !== state.sim.ballCount) {
        set(
          hardRebuildPatch(
            values,
            text,
            nextValidation,
            `Ball count changed (${state.sim.ballCount} → ${nextValidation.ballCount}): patterns of different b are unreachable — hard reset, no transition.`,
          ),
        );
        return;
      }
      if (currentMax > GRAPH_MAX_N) {
        set(
          hardRebuildPatch(
            values,
            text,
            nextValidation,
            `Current pattern is outside the graph (max throw ${currentMax} > ${GRAPH_MAX_N}) — hard reset.`,
          ),
        );
        return;
      }

      // Same b, both patterns fit the graph: smooth transition (DESIGN.md §5).
      // Splice at the next beat boundary; N auto-expands (cap 11) to fit the
      // target, the running pattern, and anything still in flight.
      const spliceBeat = earliestGlitchFreeSpliceBeat(state.sim, state.simTime);
      const sourceFull = stateToBits(state.sim.timeline.landingScheduleAt(spliceBeat, GRAPH_MAX_N));
      const graphMaxHeight = Math.min(
        GRAPH_MAX_N,
        Math.max(state.graphMaxHeight, targetMax, currentMax, bitsNeeded(sourceFull), GRAPH_N_MIN),
      );
      const graph = buildStateGraph(state.sim.ballCount, graphMaxHeight);
      const source = stateToBits(state.sim.timeline.landingScheduleAt(spliceBeat, graphMaxHeight));
      const cycle = patternCycle(values, graphMaxHeight);
      const plan = planTransition(graph, source, cycle.nodeSet);
      assertBridgeLegal(source, plan, graphMaxHeight);
      const { sim, transition } = spliceIntoSim(
        state,
        spliceBeat,
        plan,
        values,
        cycle.phaseOf.get(plan.to) ?? 0,
        canonicalText,
      );
      set({
        pattern: text,
        validation: nextValidation,
        sim,
        transition,
        graphMaxHeight,
        graphNotice: null,
      });
    },

    // Typed pattern entry routes through the identical navigate machinery
    // (DESIGN.md §5) — setPattern IS navigateToPattern.
    setPattern: (text) => get().navigateToPattern(text),

    navigateToState: (stateBits) => {
      const state = get();
      const currentMax = maxThrowOf(state.sim.values);
      if (currentMax > GRAPH_MAX_N) {
        return; // graph unavailable for the running pattern; nothing to click
      }
      const target = stateBits >>> 0;
      const spliceBeat = earliestGlitchFreeSpliceBeat(state.sim, state.simTime);
      const sourceFull = stateToBits(state.sim.timeline.landingScheduleAt(spliceBeat, GRAPH_MAX_N));
      const graphMaxHeight = Math.min(
        GRAPH_MAX_N,
        Math.max(
          state.graphMaxHeight,
          currentMax,
          bitsNeeded(sourceFull),
          bitsNeeded(target),
          GRAPH_N_MIN,
        ),
      );
      const graph = buildStateGraph(state.sim.ballCount, graphMaxHeight);
      const source = stateToBits(state.sim.timeline.landingScheduleAt(spliceBeat, graphMaxHeight));
      if (!graph.has(target) || !graph.has(source)) {
        return; // not a node of this (b, N) graph — ignore the click
      }
      // A state on the current pattern's cycle re-enters the pattern at that
      // node's phase; a bare state holds the SHORTEST cycle through it, which
      // becomes the running pattern (DESIGN.md §5).
      const cycle = patternCycle(state.sim.values, graphMaxHeight);
      let holdValues: number[];
      let holdPhase: number;
      let holdText: string;
      if (cycle.nodeSet.has(target)) {
        holdValues = state.sim.values;
        holdPhase = cycle.phaseOf.get(target) ?? 0;
        holdText = state.sim.patternText;
      } else {
        holdValues = shortestCycle(graph, target);
        holdPhase = 0;
        holdText = formatPattern(holdValues);
      }
      const plan = planTransition(graph, source, [target]);
      assertBridgeLegal(source, plan, graphMaxHeight);
      const { sim, transition } = spliceIntoSim(
        state,
        spliceBeat,
        plan,
        holdValues,
        holdPhase,
        holdText,
      );
      set({
        pattern: holdText,
        validation: validatePattern(holdText),
        sim,
        transition,
        graphMaxHeight,
        graphNotice: null,
      });
    },

    hardReset: () => {
      const state = get();
      // Restart clean at t = 0 (DESIGN.md §5): the running pattern on a periodic
      // schedule, epochs cleared, the CURRENT slider values folded into the base
      // params (so the reset keeps what the user hears/sees on the sliders).
      const baseParams: TimelineParams = {
        beatPeriod: state.beatPeriod,
        dwellTime: state.dwellTime,
        handCount: state.handCount,
      };
      const baseKinematics: Omit<KinematicsConfig, 'epochs'> = {
        gravity: state.gravity,
        holdDepth: state.holdDepth,
        carryPath: carryPathOf(state.carryPathKind),
        geometry: makeHandGeometry(state.handThrowPoints, state.handCatchPoints),
      };
      const sim = buildSimulation(
        state.sim.values,
        state.sim.patternText,
        baseParams,
        [],
        INITIAL_BEATS,
        kinematicsConfigOf(baseKinematics, []),
      );
      set({
        simTime: 0,
        pattern: state.sim.patternText,
        validation: validatePattern(state.sim.patternText),
        baseParams,
        epochs: [],
        baseKinematics,
        kinematicsEpochs: [],
        sim,
        transition: null,
        graphNotice: null,
      });
    },

    setGraphMaxHeight: (raw) => {
      const state = get();
      // Never drop N below the running pattern's max throw (its cycle must stay
      // representable); patterns beyond the cap are off-graph regardless of N.
      const currentMax = maxThrowOf(state.sim.values);
      const floor = currentMax <= GRAPH_N_MAX ? Math.max(GRAPH_N_MIN, currentMax) : GRAPH_N_MIN;
      set({ graphMaxHeight: clamp(Math.round(raw), floor, GRAPH_N_MAX) });
    },

    setGraphVisible: (graphVisible) => set({ graphVisible }),
    toggleGraph: () => set((state) => ({ graphVisible: !state.graphVisible })),

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

    // Charts settings never touch the sim (DESIGN.md §2): plain presentation setters.
    setChartsVisible: (chartsVisible) => set({ chartsVisible }),
    toggleCharts: () => set((state) => ({ chartsVisible: !state.chartsVisible })),
    setChartAxisMode: (chartAxisMode) => set({ chartAxisMode }),

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

    // --- Audio (DESIGN.md §6): plain presentation-only setters (the ticks are
    // synthesized in ui/useAudio; the store never touches WebAudio or the sim). ---
    setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
    toggleAudio: () => set((state) => ({ audioEnabled: !state.audioEnabled })),
    setCatchTickEnabled: (catchTickEnabled) => set({ catchTickEnabled }),
    toggleCatchTick: () => set((state) => ({ catchTickEnabled: !state.catchTickEnabled })),
    setAudioVolume: (raw) => set({ audioVolume: clamp(raw, AUDIO_VOLUME_MIN, AUDIO_VOLUME_MAX) }),

    // --- Camera: preset buttons + URL boot store the pose here; the scene applies
    // it (and free-orbit changes are sampled live for share links). No sim touch. ---
    setCameraView: (cameraView) => set({ cameraView }),

    // --- Theme (redesign 2026-07-10) — a view preference, no sim touch ---------
    setTheme: (theme) => set({ theme }),
    toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

    // --- Save / share (DESIGN.md §6) ------------------------------------------
    currentConfig: () => {
      const s = get();
      const camera = sampleCamera(s.cameraView);
      return {
        // The RUNNING valid pattern (never a half-typed invalid input) so the
        // share link always reproduces a real scene.
        pattern: s.sim.patternText,
        beatPeriod: s.beatPeriod,
        dwellTime: s.dwellTime,
        playbackSpeed: s.playbackSpeed,
        gravity: s.gravity,
        holdDepth: s.holdDepth,
        carryPathKind: s.carryPathKind,
        handCount: s.handCount,
        handPreset: s.handPreset,
        handThrowPoints: s.handThrowPoints.map((point) => ({ x: point.x, z: point.z })),
        handCatchPoints: s.handCatchPoints.map((point) => ({ x: point.x, z: point.z })),
        ballRadius: s.ballRadius,
        ballColor: s.ballColor,
        orbitColoring: s.orbitColoring,
        timelineWindow: s.timelineWindow,
        trailLength: s.trailLength,
        ghostsEnabled: s.ghostsEnabled,
        chartsVisible: s.chartsVisible,
        chartAxisMode: s.chartAxisMode,
        graphMaxHeight: s.graphMaxHeight,
        graphVisible: s.graphVisible,
        audioEnabled: s.audioEnabled,
        catchTickEnabled: s.catchTickEnabled,
        audioVolume: s.audioVolume,
        camera,
      };
    },

    applyConfig: (config) => {
      // Pattern: fall back to the default if the shared text is invalid (never crash).
      const parsed = validatePattern(config.pattern);
      const values = parsed.ok ? parsed.values : [3];
      const patternText = parsed.ok ? config.pattern : DEFAULT_PATTERN;
      const validation = parsed.ok ? parsed : validatePattern(DEFAULT_PATTERN);

      const handCount = clamp(Math.round(config.handCount), HAND_COUNT_MIN, HAND_COUNT_MAX);
      const handPreset: HandPreset = config.handPreset === 'circle' ? 'circle' : 'line';

      // Hand points: use the config's if they match the hand count, else re-derive
      // the preset geometry (a hand-crafted / stale payload degrades gracefully).
      let throwPoints: Vec3[];
      let catchPoints: Vec3[];
      if (
        config.handThrowPoints.length === handCount &&
        config.handCatchPoints.length === handCount
      ) {
        throwPoints = config.handThrowPoints.map((point) => vec3(point.x, HAND_Y, point.z));
        catchPoints = config.handCatchPoints.map((point) => vec3(point.x, HAND_Y, point.z));
      } else {
        const sampled = sampleHandPoints(presetGeometry(handPreset, handCount), handCount);
        throwPoints = sampled.throwPoints;
        catchPoints = sampled.catchPoints;
      }
      const geometry = makeHandGeometry(throwPoints, catchPoints);

      const beatPeriod = clamp(config.beatPeriod, BEAT_PERIOD_MIN, BEAT_PERIOD_MAX);
      const dwellTime = clamp(config.dwellTime, DWELL_MIN, dwellCap(handCount, beatPeriod));
      const gravity = clamp(config.gravity, GRAVITY_MIN, GRAVITY_MAX);
      const holdDepth = clamp(config.holdDepth, HOLD_DEPTH_MIN, HOLD_DEPTH_MAX);
      const carryPathKind: CarryPathKind = config.carryPathKind === 'cubic' ? 'cubic' : 'quintic';

      const baseParams: TimelineParams = { beatPeriod, dwellTime, handCount };
      const baseKinematics: Omit<KinematicsConfig, 'epochs'> = {
        gravity,
        holdDepth,
        carryPath: carryPathOf(carryPathKind),
        geometry,
      };
      const sim = buildSimulation(
        values,
        patternText,
        baseParams,
        [],
        INITIAL_BEATS,
        kinematicsConfigOf(baseKinematics, []),
      );

      // N floor = the pattern's max throw (so its cycle stays representable),
      // unless it is off-graph (then the panel just shows "unavailable").
      const targetMax = maxThrowOf(values);
      const floor = targetMax <= GRAPH_N_MAX ? Math.max(GRAPH_N_MIN, targetMax) : GRAPH_N_MIN;
      const graphMaxHeight = clamp(Math.round(config.graphMaxHeight), floor, GRAPH_N_MAX);

      set({
        pattern: patternText,
        validation,
        beatPeriod,
        dwellTime,
        playbackSpeed: clamp(config.playbackSpeed, PLAYBACK_MIN, PLAYBACK_MAX),
        gravity,
        holdDepth,
        carryPathKind,
        handCount,
        handPreset,
        handThrowPoints: throwPoints,
        handCatchPoints: catchPoints,
        positionsEditorOpen: false,
        ballRadius: clamp(config.ballRadius, BALL_RADIUS_MIN, BALL_RADIUS_MAX),
        orbitColoring: config.orbitColoring,
        ballColor: config.ballColor,
        timelineWindow: clamp(config.timelineWindow, TIMELINE_WINDOW_MIN, TIMELINE_WINDOW_MAX),
        trailLength: clamp(config.trailLength, TRAIL_LENGTH_MIN, TRAIL_LENGTH_MAX),
        ghostsEnabled: config.ghostsEnabled,
        chartsVisible: config.chartsVisible,
        chartAxisMode: config.chartAxisMode,
        graphMaxHeight,
        graphVisible: config.graphVisible,
        audioEnabled: config.audioEnabled,
        catchTickEnabled: config.catchTickEnabled,
        audioVolume: clamp(config.audioVolume, AUDIO_VOLUME_MIN, AUDIO_VOLUME_MAX),
        cameraView: config.camera,
        baseParams,
        epochs: [],
        baseKinematics,
        kinematicsEpochs: [],
        sim,
        simTime: 0,
        playing: true,
        transition: null,
        graphNotice: null,
      });
    },

    savePreset: (name) => {
      const config = get().currentConfig();
      const names = savePresetTo(getLocalStorage(), name, config);
      if (names !== null) {
        set({ presetNames: names });
      }
    },
    loadPreset: (name) => {
      const config = loadPresetFrom(getLocalStorage(), name);
      if (config !== null) {
        get().applyConfig(config);
      }
    },
    deletePreset: (name) => {
      const names = deletePresetFrom(getLocalStorage(), name);
      if (names !== null) {
        set({ presetNames: names });
      }
    },
    refreshPresetNames: () =>
      set({ presetNames: presetNamesOf(readPresetMap(getLocalStorage())) }),
  };
});

/**
 * Smoke value exercising the state -> core dependency direction (DESIGN.md §2)
 * with default timing (DESIGN.md §7): t_d = 0.30 s, h = 3, τ_b = 0.25 s.
 * (Retained from Phase 0; also used by the state-layer test.)
 */
export const defaultEffectiveDwell = effectiveDwell(0.3, 3, 0.25);
