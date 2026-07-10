// src/ui/library — the curated pattern library (DESIGN.md §6; PLAN.md Phase 9).
//
// An honestly-named list of siteswaps spanning 2–7 balls and a range of flavors
// (cascades, fountains, showers, the box family, holds, columns, ladders). Each
// entry's ball count is derived from the parser (not hand-typed), so the label
// can never drift from the pattern; a unit test validates every entry and drops
// none silently (buildLibrary throws on an invalid pattern). The sidebar groups
// the dropdown by these derived ball counts (see Controls).

import { validatePattern } from '../core/siteswap';

/** One library entry: the pattern text, a display name, and its ball count b. */
export interface LibraryEntry {
  readonly pattern: string;
  readonly name: string;
  readonly ballCount: number;
}

/** Raw curated list (pattern + name); ball counts are attached from the parser. */
const CURATED: readonly { readonly pattern: string; readonly name: string }[] = [
  // 2 balls
  { pattern: '31', name: 'two-ball shower' },
  { pattern: '312', name: 'two-ball weave' },
  { pattern: '330', name: 'two balls, one hand' },
  // 3 balls
  { pattern: '3', name: 'cascade' },
  { pattern: '51', name: 'three-ball shower' },
  { pattern: '441', name: 'half-box' },
  { pattern: '531', name: 'box-ish tower' },
  { pattern: '423', name: 'tennis-ish (with a hold)' },
  { pattern: '522', name: 'three balls, one held' },
  { pattern: '7131', name: 'high–low weave' },
  { pattern: '45141', name: 'three-ball weave' },
  { pattern: '52512', name: 'tower weave' },
  { pattern: '50505', name: 'columns (gap beats)' },
  { pattern: '4413', name: 'half-box variant' },
  { pattern: '53133', name: 'tower run' },
  // 4 balls
  { pattern: '4', name: 'fountain' },
  { pattern: '53', name: 'four-ball half-shower' },
  { pattern: '71', name: 'four-ball shower' },
  { pattern: '552', name: 'four balls, one held' },
  { pattern: '534', name: 'four-ball weave' },
  { pattern: '633', name: 'four-ball tower' },
  { pattern: '5551', name: 'near-fountain run' },
  { pattern: '7531', name: 'descending ladder' },
  { pattern: '7333', name: 'four balls, one high' },
  // 5 balls
  { pattern: '5', name: 'cascade' },
  { pattern: '645', name: 'five-ball weave' },
  { pattern: '753', name: 'five-ball half-shower' },
  { pattern: '744', name: 'five-ball with a hold' },
  { pattern: '66661', name: 'five-ball fountain run' },
  { pattern: '97531', name: 'cascade of towers' },
  // 6 balls
  { pattern: '6', name: 'fountain' },
  { pattern: '756', name: 'six-ball weave' },
  { pattern: '9555', name: 'six balls, one high' },
  // 7 balls
  { pattern: '7', name: 'cascade' },
  { pattern: '867', name: 'seven-ball weave' },
];

/**
 * Build the library, deriving each ball count from the validator. Throws if a
 * curated pattern is invalid — a build-time guarantee that every menu entry runs
 * (the accompanying test enforces the same, so this never surfaces at runtime).
 */
export function buildLibrary(): LibraryEntry[] {
  return CURATED.map(({ pattern, name }) => {
    const result = validatePattern(pattern);
    if (!result.ok) {
      throw new Error(`library pattern ${pattern} is invalid`);
    }
    return { pattern, name, ballCount: result.ballCount };
  });
}

/** The curated library (memoized module-level; every entry is a valid siteswap). */
export const PATTERN_LIBRARY: readonly LibraryEntry[] = buildLibrary();
