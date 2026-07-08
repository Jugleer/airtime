// Phase 0 placeholder — src/core/stategraph (DESIGN.md §5).
// State-space generation for (b, N), BFS navigation and cycle extraction arrive
// in Phase 8.

/**
 * Population count of a landing-schedule state vector; for a valid state this
 * equals the ball count b (DESIGN.md §5, NOTATION.md term "state": bit i = "a
 * ball lands i beats from now").
 */
export function popcount(state: readonly boolean[]): number {
  return state.reduce((count, occupied) => (occupied ? count + 1 : count), 0);
}
