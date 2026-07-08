// src/core/timeline — the append-only event timeline (DESIGN.md §2, §4).
//
// The simulation is a pure function of time: an event timeline (throws, catches,
// carries, idles) from which motion is later evaluated analytically. This module
// turns a validated siteswap into that timeline over a beat window, threading
// physical ball identities, honoring parameter epochs (future events only), and
// building a slew-limited, arrival-guarded beat schedule (DESIGN.md §4.6).
//
// Pure and deterministic (CLAUDE.md hard rule 1): time is an argument; no
// Date.now / Math.random / performance. NOTATION.md symbols in comments.

import {
  airTime,
  clampDwell,
  DEFAULT_BETA_CLAMP,
  DEFAULT_SLEW_TIME_CONSTANT,
  guardBeatPeriod,
  slewBeatPeriod,
  throwKind,
  type BeatSchedule,
} from '../timing';

/** Runtime parameters that shape the timeline (piecewise-constant per epoch). */
export interface TimelineParams {
  /** τ_b, the beat period (s). Slew-limited across epochs (DESIGN.md §4.6). */
  readonly beatPeriod: number;
  /** t_d, the dwell slider (s). Clamped per-throw via NOTATION identity 4. */
  readonly dwellTime: number;
  /** n_h, the hand count (DESIGN.md §3). */
  readonly handCount: number;
  /** β, the per-throw dwell clamp factor (default 0.75). */
  readonly betaClamp?: number;
  /** τ_slew, the tempo slew time constant (s, default 0.5). */
  readonly slewTimeConstant?: number;
}

/**
 * A runtime parameter change (NOTATION.md "epoch"): from `beat` onward the given
 * params apply. Events strictly before the epoch are immutable (DESIGN.md §2).
 */
export interface Epoch {
  /** First beat index at which these parameters take effect. */
  readonly beat: number;
  /**
   * The parameters changed at this epoch (merged over the running params).
   * `handCount` is intentionally excluded: an n_h change is a full timeline
   * rebuild (wired in Phase 6), not an epoch. Mid-timeline it would make an
   * in-flight ball's frozen landingHand disagree with the carry/rethrow hand
   * computed from the new n_h at its landing beat — physically impossible.
   */
  readonly params: Partial<Omit<TimelineParams, 'handCount'>>;
}

/** A ball leaves a hand into flight (value 1 or ≥ 3). */
export interface ThrowEvent {
  readonly kind: 'throw';
  readonly beat: number;
  readonly hand: number;
  readonly time: number;
  readonly value: number;
  readonly landingBeat: number;
  readonly landingHand: number;
  readonly ballId: number;
}

/** A ball arrives in a hand from flight. */
export interface CatchEvent {
  readonly kind: 'catch';
  readonly beat: number;
  readonly hand: number;
  readonly time: number;
  /** The airborne throw value h that brought the ball in. */
  readonly value: number;
  readonly ballId: number;
}

/** A held-`2` carry: a ball rides the hand across one or more beats. */
export interface HoldEvent {
  readonly kind: 'hold';
  readonly hand: number;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly beatSpan: number;
  readonly ballId: number;
}

/** A hand does nothing this beat (a `0`). */
export interface IdleEvent {
  readonly kind: 'idle';
  readonly beat: number;
  readonly hand: number;
  readonly time: number;
}

export type TimelineEvent = ThrowEvent | CatchEvent | HoldEvent | IdleEvent;

/** An airborne segment: a ball's flight from a throw to its catch. */
export interface Flight {
  readonly ballId: number;
  readonly throwBeat: number;
  readonly landingBeat: number;
  readonly throwHand: number;
  readonly landingHand: number;
  readonly value: number;
  readonly throwTime: number;
  readonly arrivalTime: number;
}

/** An in-hand segment (NOTATION.md "carry"): catch → throw of one ball. */
export interface Carry {
  readonly ballId: number;
  readonly hand: number;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly startTime: number;
  readonly endTime: number;
  /** True when the carry spans held `2`s (a merged multi-beat carry). */
  readonly held: boolean;
}

/** The built timeline over a beat window. */
export interface Timeline {
  /** Ladder-facing events (throw/catch/hold/idle), sorted by time. */
  readonly events: TimelineEvent[];
  /** Airborne segments over the generation range (includes prehistory/future). */
  readonly flights: Flight[];
  /** In-hand segments over the generation range (includes prehistory/future). */
  readonly carries: Carry[];
  /** The beat schedule (times/periods) for beats [0, endBeat). */
  readonly schedule: BeatSchedule;
  /** Start time of beat `beat` (extends uniformly for prehistory beats < 0). */
  beatTime(beat: number): number;
  /**
   * Landing schedule at `beat` (NOTATION.md "state"): a length-`maxHeight`
   * boolean vector, bit i = "a ball lands i beats from now".
   */
  landingScheduleAt(beat: number, maxHeight: number): boolean[];
}

/** Options for {@link buildTimeline}. */
export interface BuildTimelineOptions {
  /** Emit events for beats [0, beatCount). */
  readonly beatCount: number;
  /** Parameters in force from beat 0 (before any epoch). */
  readonly params: TimelineParams;
  /** Future parameter changes; each affects only its own beat onward. */
  readonly epochs?: readonly Epoch[];
}

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

// --- Union-find over handling beats (ball-identity threading) ----------------

class BeatUnionFind {
  private parent = new Map<number, number>();

  add(beat: number): void {
    if (!this.parent.has(beat)) {
      this.parent.set(beat, beat);
    }
  }

  find(beat: number): number {
    let root = beat;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as number;
    }
    // Path compression.
    let current = beat;
    while (current !== root) {
      const next = this.parent.get(current) as number;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      // Keep the smaller beat as the root for deterministic component identity.
      if (rootA < rootB) {
        this.parent.set(rootB, rootA);
      } else {
        this.parent.set(rootA, rootB);
      }
    }
  }
}

/**
 * Build the event timeline for a validated pattern over a beat window.
 * `values` must be a valid siteswap (see core/siteswap `validatePattern`).
 */
export function buildTimeline(
  values: readonly number[],
  options: BuildTimelineOptions,
): Timeline {
  const { beatCount, params, epochs = [] } = options;
  const length = values.length;

  const empty: Timeline = {
    events: [],
    flights: [],
    carries: [],
    schedule: { beatTimes: [0], beatPeriods: [] },
    beatTime: () => 0,
    landingScheduleAt: (_beat, maxHeight) => new Array<boolean>(maxHeight).fill(false),
  };
  if (length === 0 || beatCount <= 0) {
    return empty;
  }

  let maxValue = 0;
  for (const value of values) {
    if (value > maxValue) {
      maxValue = value;
    }
  }

  // Generation range: pad the window generously on both sides so every in-window
  // catch has its throw, every carry (including merged multi-beat held carries)
  // reaches its delivering and departing flights, and landing schedules see all
  // landings. A held run spans at most ~2L beats; the pad comfortably covers it.
  const pad = 2 * (maxValue + length) + 4;
  const genStart = -pad;
  const genEnd = beatCount + pad;

  const initialBeatPeriod = params.beatPeriod;
  const slewTimeConstant = params.slewTimeConstant ?? DEFAULT_SLEW_TIME_CONSTANT;
  const betaClamp = params.betaClamp ?? DEFAULT_BETA_CLAMP;
  // n_h is constant across the whole timeline (epochs cannot change it — an n_h
  // change is a full rebuild, Phase 6), so hand assignment is unambiguous.
  const handCount = params.handCount;

  // Epoch resolution: params in force at a beat (base merged with epochs ≤ beat).
  const sortedEpochs = [...epochs].sort((a, b) => a.beat - b.beat);
  function paramsAt(beat: number): TimelineParams {
    let current: TimelineParams = params;
    for (const epoch of sortedEpochs) {
      if (epoch.beat <= beat) {
        current = { ...current, ...epoch.params };
      } else {
        break;
      }
    }
    return current;
  }

  const valueAt = (beat: number): number => values[floorMod(beat, length)] as number;

  // --- Beat schedule (slew-limited, arrival-guarded) for beats [0, genEnd) ----
  // Prehistory beats (< 0) use the initial period on a uniform backward grid;
  // the initial tempo is the steady state, so no slew occurs before beat 0.
  const scheduleBeats = genEnd; // beats 0..genEnd-1 (beatTimes has genEnd+1 entries)
  const beatTimes: number[] = new Array<number>(scheduleBeats + 1);
  const beatPeriods: number[] = new Array<number>(scheduleBeats);
  beatTimes[0] = 0;

  const periodOfBeat = (beat: number): number =>
    beat < 0 ? initialBeatPeriod : (beatPeriods[beat] as number);
  const beatTimeOf = (beat: number): number => {
    // Prehistory (beat < 0) extends uniformly on the initial-tempo grid.
    if (beat < 0) {
      return beat * initialBeatPeriod;
    }
    // Beyond the generated range there is no schedule entry; surface it loudly
    // instead of returning NaN from an undefined array slot.
    if (beat > genEnd) {
      throw new RangeError(
        `beatTime(${beat}) is outside the generated range [0, ${genEnd}]`,
      );
    }
    return beatTimes[beat] as number;
  };

  // Flight arrival time for a flight thrown at `beat` (needs only past data).
  function flightArrival(beat: number): number {
    const value = valueAt(beat);
    const active = paramsAt(beat);
    const period = periodOfBeat(beat);
    const dwell = clampDwell(active.dwellTime, handCount, period);
    return beatTimeOf(beat) + airTime(value, period, dwell, active.betaClamp ?? betaClamp);
  }

  // Arrivals of flights that land at beat `m` (guard deadline candidates).
  function arrivalsLandingAt(m: number): number[] {
    const arrivals: number[] = [];
    for (let v = 1; v <= maxValue; v++) {
      const source = m - v;
      if (source < genStart) {
        continue;
      }
      // A value-1 flight landing at `m` is thrown from `m-1` — the beat whose
      // period we are still computing when guarding it. Its period is unassigned
      // (would make flightArrival NaN), and such a flight always arrives a dwell
      // before its own rethrow, so it can never constrain this guard: skip it.
      if (source >= 0 && beatPeriods[source] === undefined) {
        continue;
      }
      if (valueAt(source) === v && throwKind(v) === 'flight') {
        arrivals.push(flightArrival(source));
      }
    }
    return arrivals;
  }

  let previousPeriod = initialBeatPeriod;
  for (let beat = 0; beat < scheduleBeats; beat++) {
    // Slew this beat's period toward the target active at this beat.
    const target = paramsAt(beat).beatPeriod;
    const proposed =
      beat === 0
        ? initialBeatPeriod
        : slewBeatPeriod(previousPeriod, target, previousPeriod, slewTimeConstant);
    // Guard so beat `beat+1` starts no earlier than any ball rethrown then.
    const guarded = guardBeatPeriod(proposed, beatTimeOf(beat), arrivalsLandingAt(beat + 1));
    beatPeriods[beat] = guarded;
    beatTimes[beat + 1] = (beatTimes[beat] as number) + guarded;
    previousPeriod = guarded;
  }
  const schedule: BeatSchedule = { beatTimes, beatPeriods };

  // --- Abstract handlings, landing map, ball threading ------------------------
  // For a valid pattern each beat is the landing of at most one throw (the map
  // j → j+value is injective), so landerThrowBeat is single-valued.
  const landerThrowBeat = new Map<number, number>();
  const unionFind = new BeatUnionFind();
  // Handlings (value ≥ 1) keyed by beat, with resolved ball id later.
  const handlingBeats: number[] = [];
  for (let beat = genStart; beat < genEnd; beat++) {
    const value = valueAt(beat);
    if (value >= 1) {
      handlingBeats.push(beat);
      unionFind.add(beat);
      landerThrowBeat.set(beat + value, beat);
      const nextBeat = beat + value;
      if (nextBeat < genEnd) {
        unionFind.add(nextBeat);
        unionFind.union(beat, nextBeat);
      }
    }
  }

  // Assign ball ids: one per union-find component, ordered by the component's
  // smallest beat for determinism.
  const rootToBeats = new Map<number, number[]>();
  for (const beat of handlingBeats) {
    const root = unionFind.find(beat);
    const bucket = rootToBeats.get(root);
    if (bucket === undefined) {
      rootToBeats.set(root, [beat]);
    } else {
      bucket.push(beat);
    }
  }
  const roots = [...rootToBeats.keys()].sort((a, b) => a - b);
  const ballIdOfBeat = new Map<number, number>();
  const ballBeats = new Map<number, number[]>();
  roots.forEach((root, ballId) => {
    const beats = (rootToBeats.get(root) as number[]).slice().sort((a, b) => a - b);
    ballBeats.set(ballId, beats);
    for (const beat of beats) {
      ballIdOfBeat.set(beat, ballId);
    }
  });

  // --- Flights ---------------------------------------------------------------
  const flights: Flight[] = [];
  for (const beat of handlingBeats) {
    const value = valueAt(beat);
    if (throwKind(value) !== 'flight') {
      continue;
    }
    const landing = beat + value;
    // Hand assignment uses the single timeline n_h (epochs cannot change it), so
    // a ball's landingHand is fixed and always agrees with the hand that later
    // catches and rethrows it (§4.6, epoch immutability).
    flights.push({
      ballId: ballIdOfBeat.get(beat) as number,
      throwBeat: beat,
      landingBeat: landing,
      throwHand: floorMod(beat, handCount),
      landingHand: floorMod(landing, handCount),
      value,
      throwTime: beatTimeOf(beat),
      arrivalTime: flightArrival(beat),
    });
  }

  // --- Carries (in-hand segments) --------------------------------------------
  // Walk each ball's handlings; a carry runs from a flight's arrival to the next
  // flight's departure, absorbing any held `2`s between them.
  const carries: Carry[] = [];
  for (const beats of ballBeats.values()) {
    let prevFlightLanding: number | null = null;
    let prevFlightArrival = 0;
    for (const beat of beats) {
      const value = valueAt(beat);
      if (throwKind(value) === 'flight') {
        if (prevFlightLanding !== null) {
          const startBeat = prevFlightLanding;
          const endBeat = beat;
          carries.push({
            ballId: ballIdOfBeat.get(beat) as number,
            hand: floorMod(startBeat, handCount),
            startBeat,
            endBeat,
            startTime: prevFlightArrival,
            endTime: beatTimeOf(endBeat),
            held: endBeat > startBeat,
          });
        }
        prevFlightLanding = beat + value;
        prevFlightArrival = flightArrival(beat);
      }
    }
  }

  // --- Events (windowed) ------------------------------------------------------
  const inWindow = (beat: number): boolean => beat >= 0 && beat < beatCount;
  const events: TimelineEvent[] = [];
  for (const flight of flights) {
    if (inWindow(flight.throwBeat)) {
      events.push({
        kind: 'throw',
        beat: flight.throwBeat,
        hand: flight.throwHand,
        time: flight.throwTime,
        value: flight.value,
        landingBeat: flight.landingBeat,
        landingHand: flight.landingHand,
        ballId: flight.ballId,
      });
    }
    if (inWindow(flight.landingBeat)) {
      events.push({
        kind: 'catch',
        beat: flight.landingBeat,
        hand: flight.landingHand,
        time: flight.arrivalTime,
        value: flight.value,
        ballId: flight.ballId,
      });
    }
  }
  for (const carry of carries) {
    if (carry.held && inWindow(carry.startBeat)) {
      events.push({
        kind: 'hold',
        hand: carry.hand,
        startBeat: carry.startBeat,
        endBeat: carry.endBeat,
        startTime: carry.startTime,
        endTime: carry.endTime,
        beatSpan: carry.endBeat - carry.startBeat,
        ballId: carry.ballId,
      });
    }
  }
  for (let beat = 0; beat < beatCount; beat++) {
    if (valueAt(beat) === 0) {
      events.push({
        kind: 'idle',
        beat,
        hand: floorMod(beat, handCount),
        time: beatTimeOf(beat),
      });
    }
  }
  const kindOrder: Record<TimelineEvent['kind'], number> = {
    catch: 0,
    hold: 1,
    idle: 2,
    throw: 3,
  };
  const eventTime = (event: TimelineEvent): number =>
    event.kind === 'hold' ? event.startTime : event.time;
  events.sort((a, b) => {
    const dt = eventTime(a) - eventTime(b);
    if (dt !== 0) {
      return dt;
    }
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  return {
    events,
    flights,
    carries,
    schedule,
    beatTime: beatTimeOf,
    landingScheduleAt: (beat, maxHeight) => {
      // Canonical state (NOTATION.md): bit i = a ball lands at beat+i from a
      // throw already made (throwBeat < beat). popcount = b.
      const state = new Array<boolean>(maxHeight).fill(false);
      for (let offset = 0; offset < maxHeight; offset++) {
        const thrownAt = landerThrowBeat.get(beat + offset);
        state[offset] = thrownAt !== undefined && thrownAt < beat;
      }
      return state;
    },
  };
}
