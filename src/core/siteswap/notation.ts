// src/core/siteswap/notation — extended siteswap notation: SYNC pairs and MULTIPLEX
// groups, parsed/validated into a beat-indexed CompiledPattern the timeline consumes.
//
// Pure and deterministic (CLAUDE.md hard rule 1): no cross-layer imports, no
// Date.now / Math.random / performance. Time is not involved here — this is pure
// combinatorics over the notation.
//
// SCOPE (orchestrator, 2026-07-11):
//   • Sync `(l,r)`: both hands throw at once; a pair spans 2 beats; values are EVEN;
//     `x` suffix = crossing override; `*` suffix repeats the whole run MIRRORED.
//   • Multiplex `[...]`: one hand throws several balls at one instant.
//   • Combined sync+multiplex parses, e.g. `([44],2x)`.
//   • Vanilla async (no `(`/`[`) is NOT handled here — it stays on the untouched
//     `validatePattern` path so its behavior and error messages are bit-identical.
//
// DISAMBIGUATION of `x`: the letter `x` is siteswap value 33. In VANILLA input we keep
// that meaning (validatePattern). Inside EXTENDED input (any `(` or `[`), `x` is always
// the crossing suffix — value 33 is simply unreachable there (it never occurs in these
// patterns). {@link isExtendedNotation} is the single routing test.
//
// NOTATION.md symbols in comments: b = ball count, h = throw value, L = period (beats),
// n_h = hand count.

import { digitToValue, validatePattern, valueToDigit } from './index';

/** One thrown ball within a beat. */
export interface CompiledThrow {
  /** Throw value h (beats until rethrow). */
  readonly value: number;
  /**
   * Crossing flag (sync only): a non-crossing sync throw lands in the SAME hand,
   * a crossing (`x`) throw in the OTHER hand. Ignored for async (hand assignment is
   * positional there — `beat mod n_h`).
   */
  readonly cross: boolean;
  /**
   * Throwing hand, meaningful only for SYNC (0 = left, 1 = right). For async it is a
   * placeholder (0); the timeline resolves the async hand positionally as `beat mod n_h`.
   */
  readonly hand: number;
}

/** A parsed, validated pattern flattened to one throw-list per beat (DESIGN.md §2, §3). */
export interface CompiledPattern {
  /** Canonical text (whitespace stripped); the star form is kept unexpanded for display. */
  readonly text: string;
  /** True when the notation uses `(l,r)` pairs — hands are explicit, n_h is forced to 2. */
  readonly sync: boolean;
  /** True when any hand throws more than one ball at a single beat (a `[...]` group of ≥ 2). */
  readonly multiplex: boolean;
  /** Period L in beats (one full repetition; a star-expanded sync run counts both halves). */
  readonly period: number;
  /** The throws leaving each beat index in [0, period). Empty entries = idle beats. */
  readonly beats: readonly (readonly CompiledThrow[])[];
}

/** A user-readable notation error (carries `.message`; the first line is shown verbatim). */
export interface NotationError {
  readonly kind: 'character' | 'syntax' | 'collision' | 'balance' | 'average' | 'sync' | 'multiplex';
  readonly message: string;
  /** 0-based index into the (whitespace-stripped) text, when a single character is at fault. */
  readonly index?: number;
}

/** The outcome of {@link validateNotation}. */
export type NotationResult =
  | {
      readonly ok: true;
      readonly compiled: CompiledPattern;
      /** Ball count b (integer for a valid pattern). */
      readonly ballCount: number;
      readonly sync: boolean;
      readonly multiplex: boolean;
      /** True when the input was pure vanilla async (routed through {@link validatePattern}). */
      readonly vanilla: boolean;
      /** The vanilla throw-value array, present only when `vanilla` is true. */
      readonly values?: number[];
    }
  | { readonly ok: false; readonly errors: readonly NotationError[]; readonly vanilla: boolean };

/**
 * Whether `text` uses EXTENDED notation (sync pairs or multiplex groups) and must
 * therefore route through this module rather than the vanilla {@link validatePattern}.
 * The presence of any `(` or `[` is the single routing signal (see the `x`
 * disambiguation note at the top of the file).
 */
export function isExtendedNotation(text: string): boolean {
  return /[([]/.test(text);
}

/** Strip all ASCII whitespace from the pattern text. */
function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

// --- Tokenizing a single "hand throw" (a value+x, or a `[...]` multiplex group) -----

interface TossReader {
  readonly tosses: CompiledThrow[];
  /** Index just past the consumed run. */
  readonly next: number;
}

/**
 * Read one throw value (a single digit/letter) and an optional `x` crossing suffix
 * starting at `pos`. In EXTENDED input, `x` is always the crossing suffix (never the
 * value 33), so a bare `x` at a value position is a syntax error.
 *
 * `allowCross` gates the `x` suffix: it is meaningful only in SYNC notation (where a
 * throw explicitly names its hand, so a flip to the other hand is well defined). On an
 * ASYNC throw the landing hand follows from `(beat + value) mod n_h`, and `x` crossing
 * is only well defined for 2 hands — v1 keeps it sync-only (orchestrator ruling), so an
 * `x` on an async throw is REJECTED rather than silently honored or ignored.
 */
function readSingleThrow(
  text: string,
  pos: number,
  hand: number,
  allowCross: boolean,
  errors: NotationError[],
): { toss: CompiledThrow | null; next: number } {
  const ch = text[pos] as string;
  if (ch === 'x' || ch === 'X') {
    errors.push({
      kind: 'syntax',
      index: pos,
      message: `stray 'x' at position ${pos}: the crossing 'x' must follow a throw value`,
    });
    return { toss: null, next: pos + 1 };
  }
  const value = digitToValue(ch);
  if (value === null) {
    errors.push({
      kind: 'character',
      index: pos,
      message: `unrecognized character '${ch}' at position ${pos}; use digits 0-9, letters a-z (10-35), or the notation ( ) [ ] , x *`,
    });
    return { toss: null, next: pos + 1 };
  }
  let cursor = pos + 1;
  let cross = false;
  if (text[cursor] === 'x' || text[cursor] === 'X') {
    if (!allowCross) {
      errors.push({
        kind: 'sync',
        index: cursor,
        message: `crossing 'x' is supported in sync patterns only — in async notation the landing hand follows from the throw value (position ${cursor})`,
      });
      return { toss: null, next: cursor + 1 };
    }
    cross = true;
    cursor += 1;
  }
  return { toss: { value, cross, hand }, next: cursor };
}

/**
 * Read one hand's throw(s) at `pos`: either a `[...]` multiplex group (≥ 1 throw) or a
 * single `value[x]`. Returns the throws (empty on error) and the next index. `allowCross`
 * is threaded to {@link readSingleThrow} (true only in sync notation).
 */
function readHandThrows(
  text: string,
  pos: number,
  hand: number,
  allowCross: boolean,
  errors: NotationError[],
): TossReader {
  const ch = text[pos];
  if (ch === '[') {
    const tosses: CompiledThrow[] = [];
    let cursor = pos + 1;
    while (cursor < text.length && text[cursor] !== ']') {
      const { toss, next } = readSingleThrow(text, cursor, hand, allowCross, errors);
      if (toss !== null) {
        if (toss.value === 0) {
          errors.push({
            kind: 'multiplex',
            index: cursor,
            message: `a 0 inside a multiplex '[...]' at position ${cursor} throws nothing — drop it`,
          });
        } else {
          tosses.push(toss);
        }
      }
      cursor = next;
    }
    if (text[cursor] !== ']') {
      errors.push({
        kind: 'syntax',
        index: pos,
        message: `unclosed multiplex '[' opened at position ${pos}`,
      });
      return { tosses, next: text.length };
    }
    if (tosses.length === 0) {
      errors.push({
        kind: 'multiplex',
        index: pos,
        message: `empty multiplex '[]' at position ${pos}: a multiplex group needs at least one throw`,
      });
    }
    return { tosses, next: cursor + 1 };
  }
  const { toss, next } = readSingleThrow(text, pos, hand, allowCross, errors);
  return { tosses: toss !== null ? [toss] : [], next };
}

// --- Async (multiplex-only) parsing ------------------------------------------------

/** Parse an async pattern (no `(`), one beat per hand-throw token. */
function parseAsync(text: string, errors: NotationError[]): CompiledThrow[][] {
  const beats: CompiledThrow[][] = [];
  let pos = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === ']' || ch === ')' || ch === ',') {
      errors.push({
        kind: 'syntax',
        index: pos,
        message: `unexpected '${ch}' at position ${pos}`,
      });
      pos += 1;
      continue;
    }
    if (ch === '*') {
      errors.push({
        kind: 'syntax',
        index: pos,
        message: `'*' (mirror repeat) at position ${pos} applies to synchronous '(l,r)' patterns only`,
      });
      pos += 1;
      continue;
    }
    // Async: `x` crossing is NOT allowed (sync-only, orchestrator ruling).
    const { tosses, next } = readHandThrows(text, pos, 0, false, errors);
    beats.push(tosses);
    pos = next;
  }
  return beats;
}

// --- Sync parsing ------------------------------------------------------------------

/** One parsed sync pair: the left hand's and right hand's throws. */
interface SyncPair {
  readonly left: CompiledThrow[];
  readonly right: CompiledThrow[];
}

/** Parse a sync pattern: a run of `(left,right)` pairs with an optional trailing `*`. */
function parseSync(
  text: string,
  errors: NotationError[],
): { pairs: SyncPair[]; star: boolean } {
  const pairs: SyncPair[] = [];
  let pos = 0;
  let star = false;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '*') {
      star = true;
      pos += 1;
      if (pos < text.length) {
        errors.push({
          kind: 'syntax',
          index: pos,
          message: `'*' (mirror repeat) must be the last character`,
        });
      }
      break;
    }
    if (ch !== '(') {
      errors.push({
        kind: 'sync',
        index: pos,
        message: `expected a '(l,r)' pair at position ${pos} in a synchronous pattern`,
      });
      pos += 1;
      continue;
    }
    // Left hand (hand 0). Sync throws may carry an `x` crossing suffix.
    let cursor = pos + 1;
    const left = readHandThrows(text, cursor, 0, true, errors);
    cursor = left.next;
    if (text[cursor] !== ',') {
      errors.push({
        kind: 'sync',
        index: cursor,
        message: `expected ',' between the two hands of the sync pair opened at position ${pos}`,
      });
      // Best-effort recovery: skip to the next ')' or end.
      while (cursor < text.length && text[cursor] !== ')') cursor += 1;
      pairs.push({ left: left.tosses, right: [] });
      pos = text[cursor] === ')' ? cursor + 1 : text.length;
      continue;
    }
    cursor += 1; // consume ','
    const right = readHandThrows(text, cursor, 1, true, errors);
    cursor = right.next;
    if (text[cursor] !== ')') {
      errors.push({
        kind: 'sync',
        index: pos,
        message: `unclosed sync pair '(' opened at position ${pos}`,
      });
      pairs.push({ left: left.tosses, right: right.tosses });
      pos = text.length;
      continue;
    }
    pairs.push({ left: left.tosses, right: right.tosses });
    pos = cursor + 1;
  }
  return { pairs, star };
}

/** Mirror a sync pair: swap the two hands (crossing flags travel with the throw). */
function mirrorPair(pair: SyncPair): SyncPair {
  const swapHand = (t: CompiledThrow, hand: number): CompiledThrow => ({ ...t, hand });
  return {
    left: pair.right.map((t) => swapHand(t, 0)),
    right: pair.left.map((t) => swapHand(t, 1)),
  };
}

/** Expand a sync run into a beat list: pair p throws at beat 2p; odd beats are idle. */
function syncBeats(pairs: readonly SyncPair[], star: boolean): CompiledThrow[][] {
  const full = star ? [...pairs, ...pairs.map(mirrorPair)] : [...pairs];
  const beats: CompiledThrow[][] = [];
  for (const pair of full) {
    beats.push([...pair.left, ...pair.right]); // even beat: both hands throw
    beats.push([]); // odd beat: idle
  }
  return beats;
}

// --- Validity ----------------------------------------------------------------------

/** Resolve the landing hand of a toss thrown at (beat, fromHand). */
function landingHandOf(
  toss: CompiledThrow,
  beat: number,
  sync: boolean,
  handCount: number,
): number {
  if (sync) {
    return toss.cross ? 1 - toss.hand : toss.hand;
  }
  return ((beat + toss.value) % handCount + handCount) % handCount;
}

/**
 * Validate a compiled pattern's landing schedule (orchestrator ruling 5): every hand
 * throws exactly the number of balls that land in it. Async is checked per BEAT (n_h
 * independent, matching vanilla's permutation test); sync per (beat, hand) since the
 * two hands are distinct. Also enforces the integer average (ball-count theorem).
 */
function validateCompiled(compiled: CompiledPattern, errors: NotationError[]): void {
  const period = compiled.period;
  if (period === 0) {
    return;
  }
  const sync = compiled.sync;
  // For sync the two hands are tracked separately; async collapses to one bucket per beat.
  const laneCount = sync ? 2 : 1;
  const laneOf = (hand: number): number => (sync ? hand : 0);
  const outCount = new Array<number>(period * laneCount).fill(0);
  const inCount = new Array<number>(period * laneCount).fill(0);
  const key = (beat: number, lane: number): number => beat * laneCount + lane;

  let sum = 0;
  for (let beat = 0; beat < period; beat++) {
    for (const toss of compiled.beats[beat] as readonly CompiledThrow[]) {
      sum += toss.value;
      const fromLane = laneOf(sync ? toss.hand : 0);
      outCount[key(beat, fromLane)] = (outCount[key(beat, fromLane)] as number) + 1;
      const landBeat = ((beat + toss.value) % period + period) % period;
      const landHand = landingHandOf(toss, beat, sync, 2);
      const landLane = laneOf(landHand);
      inCount[key(landBeat, landLane)] = (inCount[key(landBeat, landLane)] as number) + 1;
    }
  }

  for (let beat = 0; beat < period; beat++) {
    for (let lane = 0; lane < laneCount; lane++) {
      const out = outCount[key(beat, lane)] as number;
      const land = inCount[key(beat, lane)] as number;
      if (out !== land) {
        const where = sync ? `beat ${beat}, hand ${lane}` : `beat ${beat}`;
        if (land > out) {
          errors.push({
            kind: 'collision',
            message: `collision at ${where}: ${land} ball${land === 1 ? '' : 's'} land there but ${out} ${out === 1 ? 'is' : 'are'} thrown — a hand can only throw what it holds.`,
          });
        } else {
          errors.push({
            kind: 'balance',
            message: `imbalance at ${where}: ${out} ball${out === 1 ? ' is' : 's are'} thrown but only ${land} arrive${land === 1 ? 's' : ''} to be thrown.`,
          });
        }
      }
    }
  }

  if (errors.length === 0 && sum % period !== 0) {
    errors.push({
      kind: 'average',
      message: `pattern average is ${sum}/${period}, not a whole number, so it cannot be a valid siteswap (b must be an integer)`,
    });
  }
}

// --- Public API --------------------------------------------------------------------

/** Ball count b of a compiled pattern = (sum of all throw values) / period. */
export function compiledBallCount(compiled: CompiledPattern): number {
  if (compiled.period === 0) {
    return 0;
  }
  let sum = 0;
  for (const beat of compiled.beats) {
    for (const toss of beat) {
      sum += toss.value;
    }
  }
  return sum / compiled.period;
}

/** Greatest common divisor. */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Least common multiple. */
function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return Math.abs((a / gcd(a, b)) * b);
}

/** Whether two beats' throw lists are identical (for minimal-period reduction). */
function sameBeat(a: readonly CompiledThrow[], b: readonly CompiledThrow[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as CompiledThrow;
    const y = b[i] as CompiledThrow;
    if (x.value !== y.value || x.cross !== y.cross || x.hand !== y.hand) {
      return false;
    }
  }
  return true;
}

/** Minimal repeating period of the beat list (smallest divisor d of L with beats[i]==beats[i-d]). */
function minimalBeatPeriod(beats: readonly (readonly CompiledThrow[])[]): number {
  const length = beats.length;
  for (let d = 1; d <= length; d++) {
    if (length % d !== 0) {
      continue;
    }
    let periodic = true;
    for (let i = d; i < length; i++) {
      if (!sameBeat(beats[i] as readonly CompiledThrow[], beats[i - d] as readonly CompiledThrow[])) {
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
 * Spatial period in beats of a compiled pattern (DESIGN.md §6): the physical scene
 * repeats after lcm(minimal beat period, n_h) beats. For sync n_h is 2.
 */
export function compiledSpatialPeriodBeats(compiled: CompiledPattern, handCount: number): number {
  if (compiled.period === 0 || handCount <= 0) {
    return 0;
  }
  const nh = compiled.sync ? 2 : handCount;
  return lcm(minimalBeatPeriod(compiled.beats), nh);
}

/**
 * Parse extended notation into a {@link CompiledPattern} (no validity check). Returns
 * the compiled beats or a syntax/character error list. Assumes {@link isExtendedNotation}
 * (vanilla text is handled by {@link validateNotation} via {@link validatePattern}).
 */
export function parseNotation(
  text: string,
): { ok: true; compiled: CompiledPattern } | { ok: false; errors: NotationError[] } {
  const clean = stripWhitespace(text);
  const errors: NotationError[] = [];
  if (clean.length === 0) {
    return { ok: false, errors: [{ kind: 'syntax', message: 'empty pattern: a siteswap needs at least one throw' }] };
  }
  const sync = clean.includes('(') || clean.includes(')');
  let beats: CompiledThrow[][];
  if (sync) {
    const { pairs, star } = parseSync(clean, errors);
    beats = syncBeats(pairs, star);
  } else {
    beats = parseAsync(clean, errors);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (beats.length === 0 || beats.every((beat) => beat.length === 0)) {
    return { ok: false, errors: [{ kind: 'syntax', message: 'empty pattern: a siteswap needs at least one throw' }] };
  }
  const multiplex = countsMultiplex(beats, sync);
  const compiled: CompiledPattern = {
    text: clean,
    sync,
    multiplex,
    period: beats.length,
    beats,
  };
  return { ok: true, compiled };
}

/** True when any single hand throws ≥ 2 balls at one beat. */
function countsMultiplex(beats: readonly (readonly CompiledThrow[])[], sync: boolean): boolean {
  for (const beat of beats) {
    if (!sync) {
      if (beat.length >= 2) {
        return true;
      }
      continue;
    }
    let left = 0;
    let right = 0;
    for (const toss of beat) {
      if (toss.hand === 0) left += 1;
      else right += 1;
    }
    if (left >= 2 || right >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a pattern of ANY notation. Vanilla async (no `(`/`[`) delegates to
 * {@link validatePattern} so its result and error messages are bit-identical to today
 * (the routing keeps the current first-line-verbatim error contract for vanilla).
 * Extended notation is parsed and checked here (orchestrator ruling 5).
 */
export function validateNotation(text: string): NotationResult {
  if (!isExtendedNotation(text)) {
    const vanilla = validatePattern(text);
    if (!vanilla.ok) {
      return { ok: false, errors: vanilla.errors, vanilla: true };
    }
    const beats = vanilla.values.map<CompiledThrow[]>((value) =>
      value === 0 ? [] : [{ value, cross: false, hand: 0 }],
    );
    const compiled: CompiledPattern = {
      text: formatVanilla(vanilla.values),
      sync: false,
      multiplex: false,
      period: beats.length,
      beats,
    };
    return {
      ok: true,
      compiled,
      ballCount: vanilla.ballCount,
      sync: false,
      multiplex: false,
      vanilla: true,
      values: vanilla.values,
    };
  }

  const parsed = parseNotation(text);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors, vanilla: false };
  }
  const errors: NotationError[] = [];
  validateCompiled(parsed.compiled, errors);
  if (errors.length > 0) {
    return { ok: false, errors, vanilla: false };
  }
  return {
    ok: true,
    compiled: parsed.compiled,
    ballCount: compiledBallCount(parsed.compiled),
    sync: parsed.compiled.sync,
    multiplex: parsed.compiled.multiplex,
    vanilla: false,
  };
}

/** Format a vanilla value array back to canonical text (mirrors index.formatPattern). */
function formatVanilla(values: readonly number[]): string {
  return values.map((v) => valueToDigit(v)).join('');
}
