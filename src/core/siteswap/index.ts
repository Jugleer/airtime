// Phase 0 placeholder — src/core/siteswap (DESIGN.md §2, §3).
// Pure and deterministic: no cross-layer imports, no Date.now / Math.random /
// performance. Time (when it appears) is always a function argument.

/** Period length L of a pattern = number of beats before it repeats. */
export function periodLength(pattern: readonly number[]): number {
  return pattern.length;
}

/**
 * Average theorem (NOTATION.md): ball count b = mean of the throw values.
 * Returns 0 for the empty pattern.
 */
export function averageThrow(pattern: readonly number[]): number {
  if (pattern.length === 0) {
    return 0;
  }
  const total = pattern.reduce((sum, throwValue) => sum + throwValue, 0);
  return total / pattern.length;
}
