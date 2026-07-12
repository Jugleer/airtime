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
import { clamp } from '../core/math';
import { DWELL_CAP_FRACTION, effectiveDwell } from '../core/timing';
import {
  formatPattern,
  validateNotation,
  validatePattern,
  type CompiledPattern,
  type NotationResult,
  type ValidationResult,
} from '../core/siteswap';
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
import {
  clampScale,
  clampScaleValue,
  DEFAULT_WORKSPACE,
  type ParsedStl,
  type WorkspaceConfig,
  type WorkspaceScale,
  type WorkspaceShapeKind,
} from '../workspace';

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
/** holdDepth slider range (DESIGN.md §7: 0.05–0.4 m, default 0.20 — owner ruling
 *  round 7, 2026-07-12; min was 0, default was 0.10). */
export const HOLD_DEPTH_MIN = 0.05;
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
/**
 * Hand cups ON by default (owner decision 2026-07-11): the hands are now core to
 * the visual, so a fresh boot shows a simple translucent partial hollow sphere
 * (a cup opening upward) riding each hand's `handState(hand, t)` position. Codec
 * key `sh`; toggled in the View group of the left sidebar.
 */
export const DEFAULT_SHOW_HANDS = true;
/**
 * Persistent hand paths OFF by default: the closed loop each hand traverses over
 * one spatial period (carries + returns) is a subtle guide line drawn only when
 * asked. Codec key `hp`; toggled in the View group of the left sidebar.
 */
export const DEFAULT_SHOW_HAND_PATHS = false;

// --- Timeline-bar settings (DESIGN.md §6) — presentation only ---------------
// The window, trail length, and ghost toggle shape the timeline bar + 3D tracers
// (DESIGN.md §6). They never change simulation *content* (a pure function of
// time, DESIGN.md §2); the only sim touch they make is horizon EXTENSION (growing
// the generated range, same append-only mechanism as the clock), never a rebuild.
// The window range/helpers live in ./simulation; views import them from there
// (as the ladder already does).

/**
 * Trailing tracer length in seconds (DESIGN.md §6). Default 0.15 s (owner override
 * 2026-07-11): a short, unobtrusive trail so a fresh boot reads cleanly; the slider
 * grows it up to {@link TRAIL_LENGTH_MAX}. (Longer trails past the window's past
 * span pin the detach handle to the left edge with a numeric readout.) Old shared
 * links that explicitly encode `tl` still decode to their exact value — only the
 * fresh-boot default changed.
 */
export const DEFAULT_TRAIL_LENGTH = 0.15;
export const TRAIL_LENGTH_MIN = 0;
/**
 * Longest trailing tracer, in seconds (owner override 2026-07-11: was 8 s — too
 * long to read; a 2 s tail already spans several beats at typical tempos). The
 * View-group slider range and the 3D trail buffer capacity
 * ({@link trailBufferCapacity}) both derive from this, so lowering it shrinks the
 * preallocated tracer buffers automatically. An old shared link that encoded a
 * larger `tl` still decodes; the store re-clamps it to this max on apply, so it
 * loads as a 2 s trail rather than crashing or drawing past the buffer.
 */
export const TRAIL_LENGTH_MAX = 2;
/**
 * Future ghost paths OFF by default (owner override 2026-07-11): the forward
 * preview is opt-in via the View group in the left sidebar, so a fresh boot shows
 * only the live pattern. Old shared links that explicitly encode `gh` still decode
 * identically;
 * only the fresh-boot default changed.
 */
export const DEFAULT_GHOSTS_ENABLED = false;

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
/**
 * The work & power table (EnergyPanel) starts VISIBLE inside the charts dock
 * (owner request 2026-07-12). Collapsing it lets the charts split the full dock
 * width between them; the collapsed state persists (store + codec key `wt`,
 * emitted only when true so a default-layout link is unchanged).
 */
export const DEFAULT_WORK_TABLE_COLLAPSED = false;

/**
 * The bottom dock's tri-state (owner round-2 #1, orchestrator ruling 2026-07-11):
 * show nothing, the charts & energy panel, or the siteswap explorer. Replaces the
 * old boolean charts toggle; `chartsVisible` is kept as the derived alias
 * `dockMode === 'charts'` so ui/Charts (which reads it) is unchanged, and the URL
 * codec stays backward compatible (an old `cv` boolean decodes to 'charts'/'none').
 */
export type DockMode = 'none' | 'charts' | 'explorer';
/** The bottom dock starts empty (matches the former DEFAULT_CHARTS_VISIBLE = false). */
export const DEFAULT_DOCK_MODE: DockMode = 'none';

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
/**
 * The always-visible corner minimap of the state graph (redesign 2026-07-11, owner
 * requirement): a compact, non-interactive ring-graph preview sits in the scene's
 * top-left corner (cycle + hopping marker visible, no labels) and expands to the full
 * {@link DEFAULT_GRAPH_VISIBLE} overlay on click. It is ALWAYS shown when the overlay
 * is closed (owner 2026-07-12: the optional toggle was removed) — there is no store
 * flag or codec key for it any more; a legacy `gm=0/1` in an old share link is
 * silently ignored on decode.
 */
/**
 * State-graph throw-number labels ON by default (redesign 2026-07-12, owner
 * requirement — the owner revised this to ON): each edge in the full overlay carries
 * a small halo-chip label with its throw value (cycle throws always; base throws where
 * a collision cell is free; dense graphs > 42 nodes auto-downgrade to cycle-only). The
 * minimap never draws them (too small). Codec key `gt`; toggled in the View group of
 * the left sidebar (with a reset affordance). An old shared link without `gt` decodes
 * to this default (ON) — only present keys override it.
 */
export const DEFAULT_GRAPH_THROW_LABELS = true;

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
  /** Whether translucent hand cups ride each hand's `handState` position (§4.3, §4.4). */
  readonly showHands: boolean;
  /** Whether each hand's closed path over one spatial period is drawn (a subtle line). */
  readonly showHandPaths: boolean;
  /**
   * The hand whose 3D cup is highlighted on chart-legend hover, or null. Transient
   * UI state only (set on legend hover/focus, cleared on leave/blur); it is NOT in
   * ShareConfig and never touches the sim (DESIGN.md §2). See ui/Charts + render3d/Hands.
   */
  readonly hoveredHandIndex: number | null;

  // timeline-bar settings (DESIGN.md §6) — presentation only, no sim rebuild.
  /** Visible window width (s) for the timeline bar + ladder (1–15, DESIGN.md §7). */
  readonly timelineWindow: number;
  /** Trailing tracer length (s); may exceed the window (handle pins, DESIGN.md §6). */
  readonly trailLength: number;
  /** Whether dashed future ghost paths are drawn (DESIGN.md §6, toggleable). */
  readonly ghostsEnabled: boolean;

  // charts & energy panel settings (DESIGN.md §6) — presentation only, no rebuild.
  /** The bottom dock's tri-state: nothing / charts & energy / siteswap explorer. */
  readonly dockMode: DockMode;
  /** Whether the charts + energy panel is shown (= dockMode === 'charts'; gates
   *  per-frame sampling). Kept in sync with {@link dockMode} for ui/Charts. */
  readonly chartsVisible: boolean;
  /** Which scalar the charts plot: magnitude (default) or one axis component. */
  readonly chartAxisMode: ChartAxisMode;
  /**
   * Whether the work & power table (EnergyPanel) is collapsed inside the charts
   * dock (owner request 2026-07-12). Default false = visible; collapsing it lets
   * the charts reflow to split the FULL dock width. Presentation only — never
   * touches the sim. Codec key `wt`, emitted only when true.
   */
  readonly workTableCollapsed: boolean;

  // state-graph settings & navigation (DESIGN.md §5)
  /** N, the graph's maximum throw value (3–11; auto-expands to fit patterns). */
  readonly graphMaxHeight: number;
  /** Whether the FULL state-graph overlay is open (N stepper, hard reset, navigation). */
  readonly graphVisible: boolean;
  /** Whether the full overlay draws per-edge throw-number labels (default ON). */
  readonly graphThrowLabels: boolean;
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

  // hand workspace (owner feature 2026-07-11) — the ONE shared advisory bounding
  // volume (shape kind + per-axis display-frame scale + enabled), instantiated per
  // hand centered on its anchor (workspace ruling 2). Presentation/advisory only: it
  // never rebuilds the sim or alters any path (ruling 1). The primitive spec is
  // codec-encoded; the uploaded STL mesh is SESSION-ONLY (ruling 4) so it lives here
  // out of band, never in the URL or localStorage.
  /** The shared workspace spec (shape kind, per-axis scale, enabled). */
  readonly workspace: WorkspaceConfig;
  /** The parsed STL mesh (session-only; null unless the kind is 'stl' with an upload). */
  readonly workspaceMesh: ParsedStl | null;
  /** A transient note (STL parse warning, or the reload-degraded message), else null. */
  readonly workspaceNote: string | null;

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
  /** Show/hide the FULL state-graph overlay (hidden ⇒ overlay body unmounts). */
  setGraphVisible(graphVisible: boolean): void;
  toggleGraph(): void;
  /** Show/hide the full overlay's per-edge throw-number labels. */
  setGraphThrowLabels(graphThrowLabels: boolean): void;
  toggleGraphThrowLabels(): void;
  setBeatPeriod(beatPeriod: number): void;
  setDwellTime(dwellTime: number): void;
  setPlaybackSpeed(playbackSpeed: number): void;
  /** g slider (0.5–30). Applies to future throws only (kinematics epoch). */
  setGravity(gravity: number): void;
  /** holdDepth slider (0.05–0.4 m). Applies to future carries only (kinematics epoch). */
  setHoldDepth(holdDepth: number): void;
  /** Toggle the carry path (quintic ↔ cubic). Applies to future carries only. */
  setCarryPathKind(kind: CarryPathKind): void;
  /** n_h stepper (1–8). FULL rebuild: geometry resets to the current preset for n. */
  setHandCount(handCount: number): void;
  /** Hand-geometry preset (line/circle). FULL rebuild at the current n_h. */
  setHandPreset(preset: HandPreset): void;
  /**
   * Reset every hand's catch/throw position to the CURRENT preset's defaults for the
   * current hand count (re-samples the preset geometry). A future-only geometry edit
   * like any other hand move — in-flight balls keep their aimed paths; the markers
   * follow. Keeps the preset kind and hand count; only the positions revert.
   */
  resetHandPositions(): void;
  /** Move one hand's catch/throw point (x, z; y fixed). Future throws only (epoch). */
  setHandPoint(hand: number, kind: HandPointKind, x: number, z: number): void;
  /**
   * Move a WHOLE hand: translate its catch AND throw points together so their
   * midpoint anchor lands on (x, z), preserving their relative offset (the grey
   * "global" gizmo node). Future throws only (one geometry epoch), like
   * {@link setHandPoint}.
   */
  setHandAnchor(hand: number, x: number, z: number): void;
  /** Open/close the hand-positions editor (gizmos show only when open, §6). */
  setPositionsEditorOpen(open: boolean): void;
  togglePositionsEditor(): void;
  setBallRadius(ballRadius: number): void;
  setOrbitColoring(orbitColoring: boolean): void;
  toggleOrbitColoring(): void;
  setBallColor(ballColor: string): void;
  /** Show/hide the translucent hand cups (presentation only, no rebuild). */
  setShowHands(showHands: boolean): void;
  toggleShowHands(): void;
  /** Show/hide the persistent per-hand path lines (presentation only, no rebuild). */
  setShowHandPaths(showHandPaths: boolean): void;
  toggleShowHandPaths(): void;
  /** Highlight (or clear, with null) a hand's 3D cup on chart-legend hover/focus. */
  setHoveredHandIndex(hoveredHandIndex: number | null): void;
  setTimelineWindow(timelineWindow: number): void;
  setTrailLength(trailLength: number): void;
  setGhostsEnabled(ghostsEnabled: boolean): void;
  toggleGhosts(): void;
  /** Select the bottom dock's tri-state (nothing / charts / explorer); keeps
   *  {@link chartsVisible} in sync (= mode === 'charts'). */
  setDockMode(mode: DockMode): void;
  /** Show/hide the charts + energy panel (hidden ⇒ no per-frame sampling). Maps
   *  onto {@link dockMode}: true ⇒ 'charts', false ⇒ 'none'. */
  setChartsVisible(chartsVisible: boolean): void;
  toggleCharts(): void;
  /** Choose the charts' plotted scalar: magnitude or an x/y/z component. */
  setChartAxisMode(chartAxisMode: ChartAxisMode): void;
  /** Collapse/expand the work & power table within the charts dock (owner request
   *  2026-07-12); collapsing it lets the charts split the full dock width. */
  setWorkTableCollapsed(workTableCollapsed: boolean): void;
  toggleWorkTableCollapsed(): void;
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

  // --- Hand workspace (owner feature 2026-07-11) — advisory only, no sim touch ---
  /** Choose the workspace shape (sphere/cube/tetra/stl). Picking a non-stl kind
   *  keeps the uploaded mesh so it can be re-selected; clears any note. */
  setWorkspaceKind(kind: WorkspaceShapeKind): void;
  /** Set one display-frame axis half-extent (m), clamped to the slider range. */
  setWorkspaceScaleAxis(axis: keyof WorkspaceScale, value: number): void;
  /** Enable/disable the advisory overlay + violation flagging. */
  setWorkspaceEnabled(enabled: boolean): void;
  toggleWorkspaceEnabled(): void;
  /** Adopt a parsed STL as the workspace mesh (session-only). A usable mesh switches
   *  the kind to 'stl'; a degenerate one leaves the kind and surfaces its warning. */
  setWorkspaceMesh(mesh: ParsedStl | null): void;
  /** Reset the workspace to its default (clears the mesh + any note). */
  resetWorkspace(): void;

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
      state.sim.compiled,
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
      state.sim.compiled,
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
   * Convert a {@link NotationResult} (which may be extended sync/multiplex) into the
   * store's `validation` field. Only `.ok` (and, on failure, the message) is consumed
   * downstream, so extended errors are wrapped in the ValidationError-compatible
   * average shape rather than reproduced structurally.
   */
  function notationValidation(analysis: NotationResult): ValidationResult {
    if (analysis.ok) {
      return { ok: true, values: analysis.values ?? [], ballCount: analysis.ballCount };
    }
    return {
      ok: false,
      errors: analysis.errors.map((error) => ({
        kind: 'average' as const,
        sum: 0,
        length: 1,
        message: error.message,
      })),
    };
  }

  /**
   * Clean restart into an EXTENDED (sync / multiplex) pattern (orchestrator ruling 2):
   * a fresh sim at t = 0 with the compiled pattern, current sliders folded into the
   * base params, epochs/transition cleared. Sync notation forces n_h = 2 (ruling 1) —
   * re-deriving the preset geometry for two hands and noting it. No transition/splice
   * (the graph is vanilla-only, ruling 3), so `schedule` is undefined here.
   */
  function cleanRestartCompiled(compiled: CompiledPattern, text: string, ballCount: number): Partial<AppStore> {
    const state = get();
    let handCount = state.handCount;
    let throwPoints = state.handThrowPoints;
    let catchPoints = state.handCatchPoints;
    const notes: string[] = [];
    if (compiled.sync && handCount !== 2) {
      handCount = 2;
      const sampled = sampleHandPoints(presetGeometry(state.handPreset, 2), 2);
      throwPoints = sampled.throwPoints;
      catchPoints = sampled.catchPoints;
      notes.push('hand count set to 2');
    }
    const dwellTime = clamp(state.dwellTime, DWELL_MIN, dwellCap(handCount, state.beatPeriod));
    const baseParams: TimelineParams = { beatPeriod: state.beatPeriod, dwellTime, handCount };
    const baseKinematics: Omit<KinematicsConfig, 'epochs'> = {
      gravity: state.gravity,
      holdDepth: state.holdDepth,
      carryPath: carryPathOf(state.carryPathKind),
      geometry: makeHandGeometry(throwPoints, catchPoints),
    };
    const sim = buildSimulation(
      [],
      text,
      baseParams,
      [],
      INITIAL_BEATS,
      kinematicsConfigOf(baseKinematics, []),
      undefined,
      compiled,
    );
    const kind = compiled.sync ? (compiled.multiplex ? 'sync + multiplex' : 'sync') : 'multiplex';
    const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : '';
    return {
      pattern: text,
      validation: { ok: true, values: [], ballCount },
      simTime: 0,
      handCount,
      dwellTime,
      handThrowPoints: throwPoints,
      handCatchPoints: catchPoints,
      baseParams,
      epochs: [],
      baseKinematics,
      kinematicsEpochs: [],
      sim,
      transition: null,
      graphNotice: `Entered ${kind} pattern ${text} — clean restart${suffix}.`,
    };
  }

  /**
   * Clean restart into a VANILLA pattern when the CURRENT pattern is extended
   * (leaving sync/multiplex is a clean restart too, ruling 2): a fresh vanilla sim at
   * t = 0, sliders folded in, epochs/transition cleared, N auto-expanded to fit.
   */
  function cleanRestartVanilla(values: number[], text: string, validation: ValidationResult): Partial<AppStore> {
    const state = get();
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
    const sim = buildSimulation(values, text, baseParams, [], INITIAL_BEATS, kinematicsConfigOf(baseKinematics, []));
    const newMax = maxThrowOf(values);
    const graphMaxHeight =
      newMax <= GRAPH_MAX_N ? Math.max(state.graphMaxHeight, newMax) : state.graphMaxHeight;
    return {
      pattern: text,
      validation,
      simTime: 0,
      baseParams,
      epochs: [],
      baseKinematics,
      kinematicsEpochs: [],
      sim,
      transition: null,
      graphNotice: `Left sync/multiplex — clean restart to ${text}.`,
      graphMaxHeight,
    };
  }

  /**
   * Clean rebuild of the CURRENT committed config at t = 0 — shared by the transport
   * ↺ Restart and the state-graph hard reset (DESIGN.md §5). Folds the live slider
   * values AND the dragged hand geometry into fresh base params / base kinematics,
   * clears every timeline + kinematics epoch and any in-progress transition, and
   * rebuilds the sim (vanilla or the current compiled sync/multiplex form). Because
   * the dragged catch/throw points become the t = 0 geometry, the balls now fly from
   * exactly where the markers sit. Resets ONLY the sim / timeline / epochs / clock
   * (and the transient graph notice, which describes the transition being cleared);
   * every view / panel / theme / audio / camera field — and the `playing` flag — is
   * deliberately left untouched (the restart preserves play/pause state).
   */
  function cleanRestartCurrentPatch(): Partial<AppStore> {
    const state = get();
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
      undefined,
      state.sim.compiled,
    );
    return {
      simTime: 0,
      pattern: state.sim.patternText,
      validation: state.sim.compiled
        ? { ok: true, values: [], ballCount: state.sim.ballCount }
        : validatePattern(state.sim.patternText),
      baseParams,
      epochs: [],
      baseKinematics,
      kinematicsEpochs: [],
      sim,
      transition: null,
      graphNotice: null,
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
    showHands: DEFAULT_SHOW_HANDS,
    showHandPaths: DEFAULT_SHOW_HAND_PATHS,
    hoveredHandIndex: null,

    timelineWindow: DEFAULT_TIMELINE_WINDOW,
    trailLength: DEFAULT_TRAIL_LENGTH,
    ghostsEnabled: DEFAULT_GHOSTS_ENABLED,

    dockMode: DEFAULT_DOCK_MODE,
    chartsVisible: DEFAULT_CHARTS_VISIBLE,
    chartAxisMode: DEFAULT_CHART_AXIS_MODE,
    workTableCollapsed: DEFAULT_WORK_TABLE_COLLAPSED,

    graphMaxHeight: DEFAULT_GRAPH_MAX_HEIGHT,
    graphVisible: DEFAULT_GRAPH_VISIBLE,
    graphThrowLabels: DEFAULT_GRAPH_THROW_LABELS,
    transition: null,
    graphNotice: null,

    audioEnabled: DEFAULT_AUDIO_ENABLED,
    catchTickEnabled: DEFAULT_CATCH_TICK_ENABLED,
    audioVolume: DEFAULT_AUDIO_VOLUME,

    cameraView: DEFAULT_CAMERA_POSE,

    theme: DEFAULT_THEME,

    workspace: DEFAULT_WORKSPACE,
    workspaceMesh: null,
    workspaceNote: null,

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
      // Route ANY notation (sync / multiplex / vanilla). Extended patterns — and any
      // move INTO or OUT OF one — do a CLEAN RESTART (orchestrator ruling 2); the
      // graph-planned smooth transition below stays vanilla→vanilla only.
      const analysis = validateNotation(text);
      if (!analysis.ok) {
        // Invalid input: surface the error but keep the last valid sim running.
        set({ pattern: text, validation: notationValidation(analysis) });
        return;
      }
      const leavingExtended = get().sim.compiled !== undefined;
      if (!analysis.vanilla) {
        // Entering a sync / multiplex pattern: clean restart (sync forces n_h = 2).
        set(cleanRestartCompiled(analysis.compiled, analysis.compiled.text, analysis.ballCount));
        return;
      }
      if (leavingExtended) {
        // Leaving a sync / multiplex pattern for a vanilla one: clean restart.
        const values = analysis.values ?? [];
        set(cleanRestartVanilla(values, formatPattern(values), notationValidation(analysis)));
        return;
      }
      // Vanilla → vanilla: the existing graph-planned smooth transition (unchanged).
      const nextValidation = validatePattern(text);
      if (!nextValidation.ok) {
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
      if (state.sim.compiled !== undefined) {
        return; // the state graph is vanilla-only (ruling 3); nothing to navigate
      }
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
      // Every click treats the clicked node as the GOAL (DESIGN.md §5; owner
      // 2026-07-11): bridge to it (lex-min reverse-BFS), then settle into the
      // SHORTEST cycle through it — identically whether or not the node already
      // lies on the running pattern's cycle. (Previously an on-cycle node
      // re-entered the running pattern instead, which read as "nothing happens"
      // when that pattern already flowed through the clicked node.) When the
      // clicked node's shortest cycle IS the running pattern the splice is
      // bit-identical — an idempotent no-op that leaves the timeline intact.
      const holdValues = shortestCycle(graph, target);
      const holdPhase = 0;
      const holdText = formatPattern(holdValues);
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

    // Hard reset (DESIGN.md §5): restart clean at t = 0 with the running pattern on a
    // periodic schedule, epochs cleared, the current slider/geometry values folded in.
    // Shares the transport ↺ Restart's rebuild — one clean-restart path (see above).
    hardReset: () => set(cleanRestartCurrentPatch()),

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
    setGraphThrowLabels: (graphThrowLabels) => set({ graphThrowLabels }),
    toggleGraphThrowLabels: () =>
      set((state) => ({ graphThrowLabels: !state.graphThrowLabels })),

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

    // Whole-hand move (the grey "global" gizmo node, owner item 2026-07-11):
    // translate a hand's catch AND throw points together so their midpoint lands
    // on (x, z), preserving the relative offset. One future-only geometry epoch
    // (same mechanism as setHandPoint) so both markers move as a rigid pair.
    setHandAnchor: (hand, x, z) => {
      const state = get();
      if (hand < 0 || hand >= state.handCount) {
        return;
      }
      const throwPoints = state.handThrowPoints.slice();
      const catchPoints = state.handCatchPoints.slice();
      const previousThrow = throwPoints[hand];
      const previousCatch = catchPoints[hand];
      if (!previousThrow || !previousCatch) {
        return;
      }
      // Delta = target anchor − current midpoint; shift both points by it.
      const anchorX = 0.5 * (previousCatch.x + previousThrow.x);
      const anchorZ = 0.5 * (previousCatch.z + previousThrow.z);
      const dx = x - anchorX;
      const dz = z - anchorZ;
      throwPoints[hand] = vec3(previousThrow.x + dx, previousThrow.y, previousThrow.z + dz);
      catchPoints[hand] = vec3(previousCatch.x + dx, previousCatch.y, previousCatch.z + dz);
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
    // carry over; the current gravity/holdDepth/carryPath fold into the fresh base
    // (kinematics epochs are cleared, since geometry epochs are tied to the old
    // hand indices).
    //
    // Geometry on a count change (owner item, 2026-07-11): for the LINE preset,
    // increasing the count PRESERVES the existing hands (custom-dragged or not) and
    // appends the new hand(s) on the OUTSIDE, alternating +,− (the line preset's
    // alternating-outward layout guarantees the appended positions extend outward);
    // decreasing DROPS the most-recently-added hand(s). For the CIRCLE preset the
    // hand angles depend on the count, so it recomputes the whole ring.
    setHandCount: (raw) => {
      const state = get();
      const handCount = clamp(Math.round(raw), HAND_COUNT_MIN, HAND_COUNT_MAX);
      if (handCount === state.handCount) {
        return;
      }
      // A running SYNC pattern is pinned to n_h = 2 (sync forces 2 on entry): rebuilding
      // the sim at any other count would break the sync geometry. The Controls stepper is
      // disabled under sync, but other paths (applyConfig, shared links) also reach here,
      // so refuse the change outright — belt and braces. Leaving/entering sync is the
      // clean restart that changes the count.
      if (state.sim.compiled?.sync === true) {
        return;
      }
      const preset = presetGeometry(state.handPreset, handCount);
      const sampled = sampleHandPoints(preset, handCount);
      let throwPoints: Vec3[];
      let catchPoints: Vec3[];
      if (state.handPreset === 'line') {
        // Keep the first min(old, new) hands where they are; append/truncate the rest.
        const keep = Math.min(state.handCount, handCount);
        throwPoints = [...state.handThrowPoints.slice(0, keep), ...sampled.throwPoints.slice(keep)];
        catchPoints = [...state.handCatchPoints.slice(0, keep), ...sampled.catchPoints.slice(keep)];
      } else {
        throwPoints = sampled.throwPoints;
        catchPoints = sampled.catchPoints;
      }
      const geometry = makeHandGeometry(throwPoints, catchPoints);
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
        state.sim.schedule,
        state.sim.compiled,
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
        state.sim.schedule,
        state.sim.compiled,
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

    // Reset all hand catch/throw positions to the CURRENT preset's defaults for the
    // current hand count (owner ruling 2026-07-11): re-sample the preset geometry and
    // apply it as ONE future-only geometry epoch (via applyKinematicsChange), exactly
    // like setHandPoint/setHandAnchor — in-flight balls keep their aimed paths, only
    // later throws use the reset geometry, and the markers follow. A reset at beat 0
    // folds into the base kinematics (keeps the epoch list empty at the start). The
    // preset kind and hand count are unchanged; only the positions revert.
    resetHandPositions: () => {
      const state = get();
      const geometry = presetGeometry(state.handPreset, state.handCount);
      const { throwPoints, catchPoints } = sampleHandPoints(geometry, state.handCount);
      set({
        handThrowPoints: throwPoints,
        handCatchPoints: catchPoints,
        ...applyKinematicsChange({ geometry: makeHandGeometry(throwPoints, catchPoints) }),
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
    setShowHands: (showHands) => set({ showHands }),
    toggleShowHands: () => set((state) => ({ showHands: !state.showHands })),
    setShowHandPaths: (showHandPaths) => set({ showHandPaths }),
    toggleShowHandPaths: () => set((state) => ({ showHandPaths: !state.showHandPaths })),
    setHoveredHandIndex: (hoveredHandIndex) => set({ hoveredHandIndex }),

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

    // Dock / charts settings never touch the sim (DESIGN.md §2): plain presentation
    // setters. `dockMode` is the tri-state source of truth; `chartsVisible` is kept
    // in lockstep (= 'charts') so ui/Charts and the URL codec stay unchanged.
    setDockMode: (mode) => set({ dockMode: mode, chartsVisible: mode === 'charts' }),
    setChartsVisible: (chartsVisible) =>
      set({ chartsVisible, dockMode: chartsVisible ? 'charts' : 'none' }),
    // Keyed off `chartsVisible` (not dockMode) so ui/Charts's own Hide/Show button
    // — and tests that set chartsVisible directly — flip predictably.
    toggleCharts: () =>
      set((state) => {
        const chartsVisible = !state.chartsVisible;
        return { chartsVisible, dockMode: chartsVisible ? 'charts' : 'none' };
      }),
    setChartAxisMode: (chartAxisMode) => set({ chartAxisMode }),
    setWorkTableCollapsed: (workTableCollapsed) => set({ workTableCollapsed }),
    toggleWorkTableCollapsed: () =>
      set((state) => ({ workTableCollapsed: !state.workTableCollapsed })),

    setPlaying: (playing) => set({ playing }),
    togglePlaying: () => set((state) => ({ playing: !state.playing })),
    // Transport ↺ Restart: rebuild the sim from the CURRENT committed store config at
    // t = 0 (pattern, dragged hand geometry, tempo/dwell/gravity/holdDepth, compiled
    // sync/multiplex state — everything as configured NOW), so the balls fly from
    // exactly where the markers are (owner ruling 2026-07-11). Previously this only
    // seeked simTime to 0, which predated mid-flight edits and replayed the pre-edit
    // geometry. Shares hardReset's clean-restart path; the playing/paused state is
    // preserved (the flag is untouched) and no view/panel/theme state is reset.
    restart: () => set(cleanRestartCurrentPatch()),

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

    // --- Hand workspace (owner feature 2026-07-11) — advisory, never touches the
    // sim (DESIGN.md §2): plain setters. The overlay + violation sampling react to
    // these in render3d, recomputing once per (sim identity, workspace config). ---
    setWorkspaceKind: (kind) =>
      set((state) => ({ workspace: { ...state.workspace, kind }, workspaceNote: null })),
    setWorkspaceScaleAxis: (axis, value) =>
      set((state) => ({
        workspace: {
          ...state.workspace,
          scale: { ...state.workspace.scale, [axis]: clampScaleValue(value) },
        },
      })),
    setWorkspaceEnabled: (enabled) =>
      set((state) => ({ workspace: { ...state.workspace, enabled } })),
    toggleWorkspaceEnabled: () =>
      set((state) => ({ workspace: { ...state.workspace, enabled: !state.workspace.enabled } })),
    setWorkspaceMesh: (mesh) => {
      // A usable mesh (≥ 1 triangle) becomes the active STL workspace; a degenerate
      // parse keeps the current shape and just surfaces the warning so the user knows.
      if (mesh && mesh.triangleCount > 0) {
        set((state) => ({
          workspace: { ...state.workspace, kind: 'stl' },
          workspaceMesh: mesh,
          workspaceNote: mesh.warning,
        }));
      } else {
        set({ workspaceMesh: mesh, workspaceNote: mesh ? mesh.warning : null });
      }
    },
    resetWorkspace: () => set({ workspace: DEFAULT_WORKSPACE, workspaceMesh: null, workspaceNote: null }),

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
        showHands: s.showHands,
        showHandPaths: s.showHandPaths,
        timelineWindow: s.timelineWindow,
        trailLength: s.trailLength,
        ghostsEnabled: s.ghostsEnabled,
        dockMode: s.dockMode,
        chartsVisible: s.chartsVisible,
        chartAxisMode: s.chartAxisMode,
        // Work & power table collapse state (owner request 2026-07-12): always
        // sampled here; encodeConfig only WRITES the `wt` key when true (the
        // default false keeps a plain link unchanged).
        workTableCollapsed: s.workTableCollapsed,
        graphMaxHeight: s.graphMaxHeight,
        graphVisible: s.graphVisible,
        graphThrowLabels: s.graphThrowLabels,
        audioEnabled: s.audioEnabled,
        catchTickEnabled: s.catchTickEnabled,
        audioVolume: s.audioVolume,
        camera,
        // Time bookmark (owner-approved 2026-07-11): the live playhead travels with
        // the share link / preset / JSON so opening it seeks to the same moment.
        // Optional in the codec — a link without `t` simply loads at t = 0.
        time: s.simTime,
        // Hand-workspace spec (owner feature 2026-07-11): primitives round-trip; an
        // 'stl' kind degrades to disabled on reload (the mesh is session-only).
        workspace: s.workspace,
      };
    },

    applyConfig: (config) => {
      // Pattern: accept ANY notation; fall back to the default if invalid (never crash,
      // DESIGN.md §6, ruling 9). Extended sync/multiplex patterns thread a compiled
      // form through the build and (for sync) force n_h = 2.
      const analysis = validateNotation(config.pattern);
      let values: number[] = [3];
      let patternText = DEFAULT_PATTERN;
      let validation: ValidationResult = validatePattern(DEFAULT_PATTERN);
      let compiled: CompiledPattern | undefined;
      if (analysis.ok && analysis.vanilla) {
        values = analysis.values ?? [3];
        patternText = config.pattern;
        validation = { ok: true, values, ballCount: analysis.ballCount };
      } else if (analysis.ok) {
        compiled = analysis.compiled;
        patternText = analysis.compiled.text;
        values = [];
        validation = { ok: true, values: [], ballCount: analysis.ballCount };
      }

      let handCount = clamp(Math.round(config.handCount), HAND_COUNT_MIN, HAND_COUNT_MAX);
      if (compiled?.sync) {
        handCount = 2; // sync notation needs exactly 2 hands (ruling 1)
      }
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
        undefined,
        compiled,
      );

      const timelineWindow = clamp(config.timelineWindow, TIMELINE_WINDOW_MIN, TIMELINE_WINDOW_MAX);
      // Time bookmark (owner-approved 2026-07-11): seek to the config's playhead
      // time when present (a URL/preset/JSON &t=). Clamp to t ≥ 0, and extend the
      // generated horizon so a bookmark past the initial range is fully realized
      // (the same append-only mechanism the clock uses — the past stays immutable).
      // A t-load arrives PLAYING, matching how the app otherwise starts (§7).
      const seekTime =
        typeof config.time === 'number' && Number.isFinite(config.time)
          ? Math.max(0, config.time)
          : 0;
      const seekedSim =
        seekTime > 0
          ? extendedIfNeeded(
              sim,
              baseParams,
              [],
              seekTime,
              windowSpans(timelineWindow).futureSpan,
              kinematicsConfigOf(baseKinematics, []),
            )
          : sim;

      // N floor = the pattern's max throw (so its cycle stays representable),
      // unless it is off-graph (then the panel just shows "unavailable").
      const targetMax = maxThrowOf(values);
      const floor = targetMax <= GRAPH_N_MAX ? Math.max(GRAPH_N_MIN, targetMax) : GRAPH_N_MIN;
      const graphMaxHeight = clamp(Math.round(config.graphMaxHeight), floor, GRAPH_N_MAX);

      // Hand workspace (owner feature 2026-07-11): apply the shared spec when the
      // config carries one, else the default. An 'stl' kind can't carry its mesh in a
      // link (ruling 4), so it degrades to disabled with a re-upload note; the mesh
      // is always cleared on a config load (it is session-only).
      let workspace: WorkspaceConfig = DEFAULT_WORKSPACE;
      let workspaceNote: string | null = null;
      if (config.workspace) {
        const scale = clampScale(config.workspace.scale);
        if (config.workspace.kind === 'stl') {
          workspace = { kind: 'stl', scale, enabled: false };
          workspaceNote = 'STL workspaces cannot travel in a link — re-upload the mesh to re-enable it.';
        } else {
          workspace = { kind: config.workspace.kind, scale, enabled: config.workspace.enabled };
        }
      }

      // Bottom-dock tri-state: prefer the explicit dockMode; fall back to the legacy
      // boolean `chartsVisible` so an old `cv`-only link decodes to the equivalent
      // tri-state (backward compatible, orchestrator ruling 2026-07-11).
      const dockMode: DockMode = config.dockMode ?? (config.chartsVisible ? 'charts' : 'none');

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
        showHands: config.showHands,
        showHandPaths: config.showHandPaths,
        timelineWindow,
        trailLength: clamp(config.trailLength, TRAIL_LENGTH_MIN, TRAIL_LENGTH_MAX),
        ghostsEnabled: config.ghostsEnabled,
        dockMode,
        chartsVisible: dockMode === 'charts',
        chartAxisMode: config.chartAxisMode,
        // Optional: absent (old links / most links, since it's emitted only when
        // true) falls back to the default (visible).
        workTableCollapsed: config.workTableCollapsed ?? DEFAULT_WORK_TABLE_COLLAPSED,
        graphMaxHeight,
        graphVisible: config.graphVisible,
        graphThrowLabels: config.graphThrowLabels,
        audioEnabled: config.audioEnabled,
        catchTickEnabled: config.catchTickEnabled,
        audioVolume: clamp(config.audioVolume, AUDIO_VOLUME_MIN, AUDIO_VOLUME_MAX),
        cameraView: config.camera,
        workspace,
        workspaceMesh: null,
        workspaceNote,
        baseParams,
        epochs: [],
        baseKinematics,
        kinematicsEpochs: [],
        sim: seekedSim,
        simTime: seekTime,
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
