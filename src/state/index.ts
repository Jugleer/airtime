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
  buildSimulation,
  extendedIfNeeded,
  firstBeatAtOrAfter,
  INITIAL_BEATS,
  upsertEpoch,
  type EpochParams,
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
  /** n_h, the hand count (fixed at 2 this phase; stepper is Phase 6). */
  readonly handCount: number;

  // clock (DESIGN.md §2)
  readonly simTime: number;
  readonly playing: boolean;

  // timeline construction inputs (base params at beat 0 + later epochs)
  readonly baseParams: TimelineParams;
  readonly epochs: Epoch[];

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
  setPlaying(playing: boolean): void;
  togglePlaying(): void;
  restart(): void;
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

function initialSimulation(): { validation: ValidationResult; sim: Simulation } {
  const validation = validatePattern(DEFAULT_PATTERN);
  // The default pattern is valid by construction; the fallback keeps types total.
  const values = validation.ok ? validation.values : [3];
  const sim = buildSimulation(values, DEFAULT_PATTERN, initialBaseParams(), [], INITIAL_BEATS);
  return { validation, sim };
}

export const useAppStore = create<AppStore>((set, get) => {
  const { validation, sim } = initialSimulation();

  /**
   * Apply a runtime τ_b / t_d change as an epoch at the current playhead beat so
   * the past stays immutable (DESIGN.md §2). A change at beat 0 folds into the
   * base params (equivalent, and keeps the epoch list empty at startup).
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
    );
    return { baseParams, epochs, sim: nextSim };
  }

  return {
    pattern: DEFAULT_PATTERN,
    beatPeriod: DEFAULT_BEAT_PERIOD,
    dwellTime: DEFAULT_DWELL_TIME,
    playbackSpeed: DEFAULT_PLAYBACK_SPEED,
    handCount: DEFAULT_HAND_COUNT,

    simTime: 0,
    playing: true,

    baseParams: initialBaseParams(),
    epochs: [],

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
      // 8). The parameter history (base + epochs) and the clock carry over.
      const nextSim = buildSimulation(
        nextValidation.values,
        text,
        state.baseParams,
        state.epochs,
        state.sim.beatCount,
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

    setPlaying: (playing) => set({ playing }),
    togglePlaying: () => set((state) => ({ playing: !state.playing })),
    restart: () => set({ simTime: 0 }),

    tick: (wallDeltaSeconds) => {
      const state = get();
      if (!state.playing) {
        return;
      }
      const simTime = state.simTime + wallDeltaSeconds * state.playbackSpeed;
      const nextSim = extendedIfNeeded(state.sim, state.baseParams, state.epochs, simTime);
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
