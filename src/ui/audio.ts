// src/ui/audio — the PURE scheduling logic behind the WebAudio ticks (DESIGN.md
// §6). Given the event timeline and a sim-time range, it returns the throw (and
// optional catch) ticks that fall in that range, each with a stable identity key
// and a synthesis frequency. The WebAudio side effects (AudioContext, oscillator
// envelopes, lookahead loop) live in ui/useAudio; keeping the "which ticks, when"
// decision pure makes it unit-testable without WebAudio (which jsdom lacks).
//
// This is a ui-layer module (it imports the core timeline event types); it does
// not touch core purity — core still never knows audio exists (CLAUDE.md).

import type { TimelineEvent } from '../core/timeline';

/** A tick to synthesize: a throw or catch at a sim time, with an identity + pitch. */
export interface TickEvent {
  /** Sim time (s) the tick fires at (a throw release or a catch arrival). */
  readonly time: number;
  readonly kind: 'throw' | 'catch';
  /** Stable identity across scheduler runs (dedupe): `${kind}-${ballId}-${beat}`. */
  readonly key: string;
  /** Synthesis frequency (Hz). */
  readonly frequency: number;
}

/** Throw ticks are a bright, short click; catch ticks a lower one (they read apart). */
export const THROW_TICK_FREQUENCY = 660;
export const CATCH_TICK_FREQUENCY = 392;

/** The sort key the core timeline uses (hold sorts on startTime; others on time). */
function eventTime(event: TimelineEvent): number {
  return event.kind === 'hold' ? event.startTime : event.time;
}

/** First index into the (time-sorted) events whose eventTime ≥ `t` (binary search). */
function lowerBound(events: readonly TimelineEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (eventTime(events[mid] as TimelineEvent) < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * The ticks whose time is in `[startSim, endSim)`: every throw event, plus every
 * catch event when `includeCatch`. Events are the core timeline's time-sorted
 * list, so a binary search bounds the scan to the window (no full re-scan per
 * scheduler tick). Order is preserved (ascending time).
 */
export function ticksInRange(
  events: readonly TimelineEvent[],
  startSim: number,
  endSim: number,
  includeCatch: boolean,
): TickEvent[] {
  const ticks: TickEvent[] = [];
  if (endSim <= startSim || events.length === 0) {
    return ticks;
  }
  for (let i = lowerBound(events, startSim); i < events.length; i++) {
    const event = events[i] as TimelineEvent;
    const time = eventTime(event);
    if (time >= endSim) {
      break;
    }
    if (time < startSim) {
      continue; // guard against equal-time neighbors before the bound
    }
    if (event.kind === 'throw') {
      ticks.push({
        time: event.time,
        kind: 'throw',
        key: `throw-${event.ballId}-${event.beat}`,
        frequency: THROW_TICK_FREQUENCY,
      });
    } else if (event.kind === 'catch' && includeCatch) {
      ticks.push({
        time: event.time,
        kind: 'catch',
        key: `catch-${event.ballId}-${event.beat}`,
        frequency: CATCH_TICK_FREQUENCY,
      });
    }
  }
  return ticks;
}

/**
 * Prune de-dupe bookkeeping the scheduler can never consult again.
 *
 * The scheduler only ever queries ticks in `[fromSim, endSim)` where
 * `fromSim ≥ state.simTime` (the sim cursor is monotone), so any retained key
 * whose tick time is already strictly before `minSim` is dead weight — it can
 * never reappear in a future window, so dropping it cannot drop or double-fire a
 * tick. Pass a slightly-past `minSim` (e.g. simTime − a resync tolerance) so a
 * tick sitting on the current boundary is always kept. Mutates `scheduled` in
 * place; deleting during Map iteration is well-defined in JS.
 */
export function pruneScheduledKeys(scheduled: Map<string, number>, minSim: number): void {
  for (const [key, time] of scheduled) {
    if (time < minSim) {
      scheduled.delete(key);
    }
  }
}
