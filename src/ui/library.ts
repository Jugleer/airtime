// src/ui/library — the curated pattern library (DESIGN.md §6; PLAN.md Phase 9).
//
// A short list of honestly-named siteswaps spanning 2–5 balls and a range of
// flavors (cascades, showers, the box family, holds, multiplex-free classics).
// Each entry's ball count is derived from the parser (not hand-typed), so the
// label can never drift from the pattern; a unit test validates every entry.

import { validatePattern } from '../core/siteswap';

/** One library entry: the pattern text, a display name, and its ball count b. */
export interface LibraryEntry {
  readonly pattern: string;
  readonly name: string;
  readonly ballCount: number;
}

/** Raw curated list (pattern + name); ball counts are attached from the parser. */
const CURATED: readonly { readonly pattern: string; readonly name: string }[] = [
  { pattern: '31', name: 'two-ball shower' },
  { pattern: '3', name: 'cascade' },
  { pattern: '441', name: 'half-box' },
  { pattern: '531', name: 'box-ish tower' },
  { pattern: '423', name: 'tennis-ish (with a hold)' },
  { pattern: '51', name: 'three-ball shower' },
  { pattern: '7131', name: 'high–low weave' },
  { pattern: '4', name: 'fountain' },
  { pattern: '53', name: 'four-ball half-shower' },
  { pattern: '552', name: 'four balls, one held' },
  { pattern: '633', name: 'four-ball tower' },
  { pattern: '5', name: 'cascade' },
  { pattern: '744', name: 'five-ball with a hold' },
  { pattern: '645', name: 'five-ball weave' },
  { pattern: '97531', name: 'cascade of towers' },
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
