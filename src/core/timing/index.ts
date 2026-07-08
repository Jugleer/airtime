// src/core/timing — τ_b, dwell clamping, beat schedule, epochs, slew-limited
// tempo with the in-flight arrival guard (DESIGN.md §4.1, §4.6).
//
// Pure and deterministic (CLAUDE.md hard rule 1): time is always an argument;
// no Date.now / Math.random / performance. NOTATION.md symbols: τ_b = beat
// period, t_d = dwell, t_d_eff = effective dwell, t_air = air time, β = clamp,
// n_h = hand count, τ_slew = slew time constant.

/** Default per-throw dwell clamp factor β (NOTATION.md, DESIGN.md §7). */
export const DEFAULT_BETA_CLAMP = 0.75;
/** Default slew time constant τ_slew in seconds (DESIGN.md §4.6, §7). */
export const DEFAULT_SLEW_TIME_CONSTANT = 0.5;
/** UI dwell-slider cap as a fraction of n_h·τ_b (NOTATION.md identity 4). */
export const DWELL_CAP_FRACTION = 0.9;

/**
 * Effective dwell preceding the rethrow of a ball whose incoming throw value
 * was h — NOTATION.md identity (4): t_d_eff(h) = min(t_d, β·h·τ_b). Guarantees
 * t_air > 0 for every airborne throw (why 51, 531, 423… are physically possible).
 *
 * @param dwellTime   t_d, the global dwell slider (s).
 * @param throwValue  h of the incoming throw (beats).
 * @param beatPeriod  τ_b, the beat period (s).
 * @param betaClamp   β, the per-throw dwell clamp factor (default 0.75).
 */
export function effectiveDwell(
  dwellTime: number,
  throwValue: number,
  beatPeriod: number,
  betaClamp = DEFAULT_BETA_CLAMP,
): number {
  return Math.min(dwellTime, betaClamp * throwValue * beatPeriod);
}

/**
 * Clamp the dwell slider to keep t_d_eff < n_h·τ_b always (NOTATION.md identity
 * 4): the hand must have finished its previous throw before catching the next.
 * The UI caps t_d at 0.9·n_h·τ_b; this enforces the same invariant in core.
 */
export function clampDwell(dwellTime: number, handCount: number, beatPeriod: number): number {
  const cap = DWELL_CAP_FRACTION * handCount * beatPeriod;
  return Math.min(dwellTime, cap);
}

/** Classification of a throw value for timeline/rendering purposes. */
export type ThrowKind = 'idle' | 'hold' | 'flight';

/**
 * Classify a throw value (DESIGN.md §3): `0` → idle (empty hand), `2` → hold
 * (v1 keeps 2s in the hand), everything else (1, 3, 4, …) → an airborne flight.
 */
export function throwKind(throwValue: number): ThrowKind {
  if (throwValue === 0) {
    return 'idle';
  }
  if (throwValue === 2) {
    return 'hold';
  }
  return 'flight';
}

/**
 * Air time of an airborne throw of value h — NOTATION.md identity (1):
 * t_air(h) = h·τ_b − t_d_eff(h). Returns 0 for held (`2`) and idle (`0`) values
 * (no flight). Positive by construction for every airborne throw.
 */
export function airTime(
  throwValue: number,
  beatPeriod: number,
  dwellTime: number,
  betaClamp = DEFAULT_BETA_CLAMP,
): number {
  if (throwKind(throwValue) !== 'flight') {
    return 0;
  }
  return throwValue * beatPeriod - effectiveDwell(dwellTime, throwValue, beatPeriod, betaClamp);
}

// --- Slew-limited tempo (DESIGN.md §4.6) ------------------------------------

/**
 * One exponential step of τ_b toward the slider target over `elapsed` seconds
 * with time constant τ_slew: τ_next = target + (current − target)·e^(−Δt/τ_slew).
 * Monotone toward the target; never overshoots.
 */
export function slewBeatPeriod(
  currentBeatPeriod: number,
  targetBeatPeriod: number,
  elapsed: number,
  slewTimeConstant = DEFAULT_SLEW_TIME_CONSTANT,
): number {
  if (slewTimeConstant <= 0) {
    return targetBeatPeriod;
  }
  const decay = Math.exp(-elapsed / slewTimeConstant);
  return targetBeatPeriod + (currentBeatPeriod - targetBeatPeriod) * decay;
}

/**
 * Engine guard (DESIGN.md §4.6): clamp a proposed next beat period so that no
 * in-flight ball scheduled to be rethrown at the next beat would arrive after
 * that beat. Because the schedule is discretized per beat, guarding each beat
 * against the balls due at the immediately following beat keeps every dwell ≥ 0.
 *
 * @param proposedBeatPeriod  the slew's candidate duration for the current beat.
 * @param currentBeatTime     start time of the current beat (s).
 * @param nextBeatArrivals    arrival times of balls to be rethrown next beat (s).
 * @returns the (possibly lengthened) beat period; never shorter than proposed.
 */
export function guardBeatPeriod(
  proposedBeatPeriod: number,
  currentBeatTime: number,
  nextBeatArrivals: readonly number[],
): number {
  let period = proposedBeatPeriod;
  for (const arrival of nextBeatArrivals) {
    const required = arrival - currentBeatTime;
    if (required > period) {
      period = required;
    }
  }
  return period;
}

/** A beat schedule: the start time and duration (τ_b) of each beat. */
export interface BeatSchedule {
  /** Start time of each beat; length `beatCount + 1` (the last is the end time). */
  readonly beatTimes: number[];
  /** Duration τ_b used for each beat; length `beatCount`. */
  readonly beatPeriods: number[];
}

/** Options for {@link buildBeatSchedule}. */
export interface BeatScheduleOptions {
  /** Number of beats to schedule (beat indices 0..beatCount-1). */
  readonly beatCount: number;
  /** τ_b at beat 0 before any slew. */
  readonly initialBeatPeriod: number;
  /**
   * Slider target τ_b active at a given beat (piecewise-constant across epochs).
   * Defaults to a constant equal to `initialBeatPeriod` (no tempo change).
   */
  readonly targetFor?: (beat: number) => number;
  /** τ_slew (s); default 0.5. */
  readonly slewTimeConstant?: number;
  /** Sim time at the start of beat 0; default 0. */
  readonly startTime?: number;
}

/**
 * Build a beat schedule, slewing τ_b toward the per-beat target (DESIGN.md §4.6).
 * With a constant target equal to `initialBeatPeriod` this is exactly a uniform
 * grid (beatTimes[k] = startTime + k·τ_b), which is the common case in Phase 1.
 *
 * Each beat's duration is the then-current τ_b; the next beat's τ_b is the
 * exponential step over that duration. The engine guard is applied per beat via
 * the timeline (which knows in-flight arrivals); this builder is unguarded and
 * pure in τ_b alone.
 */
export function buildBeatSchedule(options: BeatScheduleOptions): BeatSchedule {
  const {
    beatCount,
    initialBeatPeriod,
    targetFor,
    slewTimeConstant = DEFAULT_SLEW_TIME_CONSTANT,
    startTime = 0,
  } = options;
  const target = targetFor ?? (() => initialBeatPeriod);

  const beatTimes: number[] = new Array<number>(beatCount + 1);
  const beatPeriods: number[] = new Array<number>(beatCount);
  beatTimes[0] = startTime;
  let current = initialBeatPeriod;
  for (let beat = 0; beat < beatCount; beat++) {
    beatPeriods[beat] = current;
    beatTimes[beat + 1] = (beatTimes[beat] as number) + current;
    current = slewBeatPeriod(current, target(beat), current, slewTimeConstant);
  }
  return { beatTimes, beatPeriods };
}
