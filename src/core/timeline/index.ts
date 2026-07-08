// Phase 0 placeholder — src/core/timeline (DESIGN.md §2, §4).
// The real append-only event timeline + lookahead scheduler arrive in Phase 1.

/** A throw event on the append-only timeline (DESIGN.md §2). */
export interface ThrowEvent {
  /** Beat index the throw leaves the hand (beats are indexed from 0). */
  readonly beat: number;
  /** Index of the hand that throws. */
  readonly hand: number;
  /** Siteswap throw value h (beats). */
  readonly throwValue: number;
}

/** Beat at which a throw lands = beat + h. */
export function landingBeat(event: ThrowEvent): number {
  return event.beat + event.throwValue;
}

/** Landing hand for n_h hands: (beat + h) mod n_h (DESIGN.md §3). */
export function landingHand(event: ThrowEvent, handCount: number): number {
  return (event.beat + event.throwValue) % handCount;
}
