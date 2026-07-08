// src/core/siteswap — parse, validate, orbits, spatial period, average theorem.
//
// Pure and deterministic (CLAUDE.md hard rule 1): no cross-layer imports, no
// Date.now / Math.random / performance. Vanilla async siteswap only (DESIGN.md
// §1, §3): one throw per beat, hands in cyclic order.
//
// NOTATION.md symbols in comments: b = ball count, h = throw value, L = pattern
// length, n_h = hand count. Identifiers use descriptive names.

/** Smallest throw value a digit can encode. */
export const MIN_THROW = 0;
/** Largest throw value a single character can encode (`z` = 35). */
export const MAX_THROW = 35;

/**
 * Map one siteswap character to its throw value h.
 * Digits `0–9` → 0–9, letters `a–z` (case-insensitive) → 10–35.
 * Returns `null` for any other character.
 */
export function digitToValue(character: string): number | null {
  if (character.length !== 1) {
    return null;
  }
  const code = character.charCodeAt(0);
  // '0'..'9'
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  // 'a'..'z'
  if (code >= 97 && code <= 122) {
    return code - 97 + 10;
  }
  // 'A'..'Z' (accepted, normalized to lowercase semantics)
  if (code >= 65 && code <= 90) {
    return code - 65 + 10;
  }
  return null;
}

/**
 * Inverse of {@link digitToValue}: map a throw value h (0–35) to its canonical
 * lowercase character. Throws for out-of-range values (a programming error).
 */
export function valueToDigit(value: number): string {
  if (!Number.isInteger(value) || value < MIN_THROW || value > MAX_THROW) {
    throw new RangeError(
      `throw value ${value} is out of the encodable range ${MIN_THROW}..${MAX_THROW}`,
    );
  }
  if (value <= 9) {
    return String.fromCharCode(48 + value);
  }
  return String.fromCharCode(97 + (value - 10));
}

/** A character that could not be parsed, with the position it occurred. */
export interface CharacterError {
  readonly kind: 'character';
  /** 0-based index of the offending character in the input text. */
  readonly index: number;
  /** The offending character. */
  readonly character: string;
  readonly message: string;
}

/** Result of parsing pattern text into throw values (character level only). */
export type ParseResult =
  | { readonly ok: true; readonly values: number[] }
  | { readonly ok: false; readonly errors: CharacterError[] };

/**
 * Parse pattern text into an array of throw values, one per character.
 * Whitespace is ignored. Character-level validation only — collisions and the
 * average theorem are checked by {@link validatePattern}.
 */
export function parsePattern(text: string): ParseResult {
  const values: number[] = [];
  const errors: CharacterError[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      continue;
    }
    const value = digitToValue(character);
    if (value === null) {
      errors.push({
        kind: 'character',
        index,
        character,
        message: `unrecognized character '${character}' at position ${index}; use digits 0-9 or letters a-z (10-35)`,
      });
    } else {
      values.push(value);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, values };
}

/** Format an array of throw values back into canonical lowercase pattern text. */
export function formatPattern(values: readonly number[]): string {
  return values.map(valueToDigit).join('');
}

/** Period length L of a pattern = number of beats before the digits repeat. */
export function periodLength(values: readonly number[]): number {
  return values.length;
}

/**
 * Mean of the throw values. For a valid pattern this equals the ball count b
 * (the average theorem, NOTATION.md). Returns 0 for the empty pattern.
 */
export function meanThrow(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

/**
 * Ball count b = mean(h). For a valid pattern the sum is divisible by L so this
 * is exact; on an invalid pattern it may be fractional (see {@link meanThrow}).
 * Returns 0 for the empty pattern.
 */
export function ballCount(values: readonly number[]): number {
  return meanThrow(values);
}

/** Landing site of the throw at `index` = (index + value) mod L. */
export function landingSite(index: number, value: number, length: number): number {
  return (index + value) % length;
}

// --- Validation -------------------------------------------------------------

/** Two or more throws that land on the same beat (mod L). */
export interface CollisionError {
  readonly kind: 'collision';
  /** The landing site (beat mod L) where the throws collide. */
  readonly beat: number;
  /** The colliding throws, each `{ beat: throwIndex, value }`, sorted by beat. */
  readonly throws: readonly { readonly beat: number; readonly value: number }[];
  readonly message: string;
}

/** The pattern sum is not divisible by L, so b would not be a whole number. */
export interface AverageError {
  readonly kind: 'average';
  readonly sum: number;
  readonly length: number;
  readonly message: string;
}

export type ValidationError = CharacterError | CollisionError | AverageError;

/** Result of full pattern validation (DESIGN.md §3). */
export type ValidationResult =
  | {
      readonly ok: true;
      readonly values: number[];
      /** Ball count b (guaranteed an integer for a valid pattern). */
      readonly ballCount: number;
    }
  | { readonly ok: false; readonly errors: ValidationError[] };

function describeThrow(value: number, beat: number): string {
  return `the ${valueToDigit(value)} thrown at beat ${beat}`;
}

/** Join a list of descriptions as "a", "a and b", or "a, b, and c". */
function joinThrows(descriptions: readonly string[]): string {
  if (descriptions.length <= 1) {
    return descriptions[0] ?? '';
  }
  if (descriptions.length === 2) {
    return `${descriptions[0]} and ${descriptions[1]}`;
  }
  return (
    descriptions.slice(0, -1).join(', ') +
    ', and ' +
    descriptions[descriptions.length - 1]
  );
}

/**
 * Human-readable collision message. A value-0 slot throws nothing — it means the
 * hand sits idle and unoccupied at its own beat — so a colliding 0 is described
 * as leaving the beat idle, not as landing a ball there. The distinctness
 * semantics are unchanged (0s still participate in the collision check); this
 * only rewords the message.
 */
function describeCollision(
  site: number,
  bucket: readonly { readonly beat: number; readonly value: number }[],
): string {
  const idles = bucket.filter((t) => t.value === 0);
  const landers = bucket.filter((t) => t.value !== 0);
  const landerText = joinThrows(landers.map((t) => describeThrow(t.value, t.beat)));
  if (idles.length === 0) {
    // Every colliding party actually threw a ball onto this beat.
    const verb = landers.length > 2 ? 'all land there' : 'both land there';
    return `collision at beat ${site}: ${landerText} ${verb}.`;
  }
  // A ball lands on `site` (from the landers) at a beat a 0 leaves idle: the
  // hand is simultaneously idle and receiving a catch — a double-booking.
  const lands = landers.length === 1 ? 'lands' : 'land';
  const idleText = joinThrows(idles.map((t) => `the 0 at beat ${t.beat}`));
  return `collision at beat ${site}: ${landerText} ${lands} on beat ${site}, which ${idleText} leaves idle.`;
}

/**
 * Validate a siteswap pattern (DESIGN.md §3): every `(i + p[i]) mod L` distinct
 * and mean(p) an integer. Errors name the beats, e.g. "collision at beat 1: the
 * 3 thrown at beat 0 and the 1 thrown at beat 1 both land there."
 *
 * Accepts either raw pattern text or an already-parsed value array.
 */
export function validatePattern(input: string | readonly number[]): ValidationResult {
  let values: number[];
  if (typeof input === 'string') {
    const parsed = parsePattern(input);
    if (!parsed.ok) {
      return { ok: false, errors: parsed.errors };
    }
    values = parsed.values;
  } else {
    values = [...input];
  }

  const errors: ValidationError[] = [];
  const length = values.length;

  if (length === 0) {
    errors.push({
      kind: 'average',
      sum: 0,
      length: 0,
      message: 'empty pattern: a siteswap needs at least one throw',
    });
    return { ok: false, errors };
  }

  // Collision check: group throw indices by landing site (i + p[i]) mod L.
  const siteToThrows = new Map<number, { beat: number; value: number }[]>();
  let sum = 0;
  for (let index = 0; index < length; index++) {
    const value = values[index] as number;
    sum += value;
    const site = landingSite(index, value, length);
    const bucket = siteToThrows.get(site);
    if (bucket === undefined) {
      siteToThrows.set(site, [{ beat: index, value }]);
    } else {
      bucket.push({ beat: index, value });
    }
  }

  // Emit collisions in ascending beat order for deterministic messages.
  const collidedSites = [...siteToThrows.keys()].filter(
    (site) => (siteToThrows.get(site) as { beat: number; value: number }[]).length > 1,
  );
  collidedSites.sort((a, b) => a - b);
  for (const site of collidedSites) {
    const bucket = (siteToThrows.get(site) as { beat: number; value: number }[])
      .slice()
      .sort((a, b) => a.beat - b.beat);
    errors.push({
      kind: 'collision',
      beat: site,
      throws: bucket,
      message: describeCollision(site, bucket),
    });
  }

  // Average theorem: sum must be divisible by L (both are integers).
  if (sum % length !== 0) {
    errors.push({
      kind: 'average',
      sum,
      length,
      message: `pattern average is ${sum}/${length}, not a whole number, so it cannot be a valid siteswap (b must be an integer)`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, values, ballCount: sum / length };
}

// --- Orbits -----------------------------------------------------------------

/**
 * Partition the throws into ball-identity cycles (NOTATION.md "orbit"): the
 * cycles of the permutation σ(i) = (i + p[i]) mod L on throw indices {0..L-1}.
 * Each cycle is returned in traversal order starting from its smallest index;
 * cycles are ordered by that smallest index. Requires a collision-free pattern
 * (so σ is a bijection); use {@link validatePattern} first.
 *
 * A `0` is a σ-fixed point that carries no physical ball, so cycles whose throws
 * sum to zero (the singleton `[i]` where p[i] === 0) are excluded — an orbit is
 * "the cycle a physical ball traverses" (NOTATION.md). Any nonzero-value cycle,
 * including a genuine self-loop (a `1` at L=1), is kept.
 *
 * Note: a kept cycle is a slot-cycle, not a ball — a stream like `40` has one
 * cycle threaded by two physical balls. Balls in a cycle = (sum of its values) / L.
 */
export function orbits(values: readonly number[]): number[][] {
  const length = values.length;
  const visited = new Array<boolean>(length).fill(false);
  const result: number[][] = [];
  for (let start = 0; start < length; start++) {
    if (visited[start]) {
      continue;
    }
    const cycle: number[] = [];
    let current = start;
    let cycleValueSum = 0;
    while (!visited[current]) {
      visited[current] = true;
      cycle.push(current);
      cycleValueSum += values[current] as number;
      current = landingSite(current, values[current] as number, length);
    }
    // Exclude zero-ball cycles (a value-0 fixed point carries no ball).
    if (cycleValueSum > 0) {
      result.push(cycle);
    }
  }
  return result;
}

// --- Spatial period ---------------------------------------------------------

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

function leastCommonMultiple(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return Math.abs(a / greatestCommonDivisor(a, b)) * Math.abs(b);
}

/**
 * Minimal string period of the digit sequence: the smallest divisor `d` of L
 * such that the values repeat with period `d` (so `[3,3,3]` reduces to 1 and
 * `[5,3,1,5,3,1]` to 3). Returns L when the sequence is already minimal.
 */
function minimalDigitPeriod(values: readonly number[]): number {
  const length = values.length;
  for (let d = 1; d <= length; d++) {
    if (length % d !== 0) {
      continue;
    }
    let periodic = true;
    for (let i = d; i < length; i++) {
      if (values[i] !== values[i - d]) {
        periodic = false;
        break;
      }
    }
    if (periodic) {
      return d;
    }
  }
  return length;
}

/**
 * Spatial period in **beats**: the number of beats after which the physical
 * pattern repeats (DESIGN.md §6). The digits repeat every minimal digit period
 * `d` beats (`d ≤ L`; e.g. `333` repeats every 1 beat, not 3), but the hand
 * assignment (hand `i` throws beats ≡ i mod n_h) only realigns every n_h beats,
 * so the scene repeats after lcm(d, n_h) beats. Multiply by τ_b for seconds.
 *
 * Example: `3` (d=1) at n_h=2 repeats every 2 beats; `531` (d=3) at n_h=2 every
 * 6 beats; `333` (d=1) at n_h=2 every 2 beats.
 */
export function spatialPeriodBeats(values: readonly number[], handCount: number): number {
  if (values.length === 0 || handCount <= 0) {
    return 0;
  }
  return leastCommonMultiple(minimalDigitPeriod(values), handCount);
}

// --- State-vector semantics -------------------------------------------------

function maxOf(values: readonly number[]): number {
  let maxValue = 0;
  for (const value of values) {
    if (value > maxValue) {
      maxValue = value;
    }
  }
  return maxValue;
}

/**
 * Whether a ball lands at absolute beat `beat` in the infinite repetition of
 * the pattern: true iff some throw of value d (1 ≤ d ≤ max) was made d beats
 * earlier, i.e. p[(beat − d) mod L] === d. (Value-0 self-maps are holes, not
 * landings, so d starts at 1.) This counts *every* landing over all time, so it
 * is not the state vector — use {@link stateAt} for that.
 */
export function landsAtBeat(values: readonly number[], beat: number): boolean {
  const length = values.length;
  if (length === 0) {
    return false;
  }
  const maxValue = maxOf(values);
  for (let d = 1; d <= maxValue; d++) {
    const sourceIndex = (((beat - d) % length) + length) % length;
    if ((values[sourceIndex] as number) === d) {
      return true;
    }
  }
  return false;
}

/**
 * The canonical siteswap state at `beat` (NOTATION.md "state"): a length-
 * `maxHeight` boolean vector, bit i = "a ball lands i beats from now, from a
 * throw already made". Each of the b balls is counted once (at its next
 * landing), so popcount = b. A ball lands at beat+i from a throw of value d made
 * at beat+i−d; that throw is in the past (before `beat`) exactly when d > i, so
 * bit i is set iff some past throw of value d > i lands there.
 */
export function stateAt(
  values: readonly number[],
  beat: number,
  maxHeight: number,
): boolean[] {
  const length = values.length;
  const state = new Array<boolean>(maxHeight).fill(false);
  if (length === 0) {
    return state;
  }
  const maxValue = maxOf(values);
  for (let offset = 0; offset < maxHeight; offset++) {
    for (let d = offset + 1; d <= maxValue; d++) {
      const sourceIndex = (((beat + offset - d) % length) + length) % length;
      if ((values[sourceIndex] as number) === d) {
        state[offset] = true;
        break;
      }
    }
  }
  return state;
}

/**
 * The canonical siteswap state sequence: one {@link stateAt} per beat over a
 * full period (periodic with period L). Used as the ground truth the timeline's
 * landing schedule is cross-checked against.
 */
export function stateSequence(values: readonly number[], maxHeight: number): boolean[][] {
  const length = values.length;
  const sequence: boolean[][] = [];
  for (let beat = 0; beat < length; beat++) {
    sequence.push(stateAt(values, beat, maxHeight));
  }
  return sequence;
}
