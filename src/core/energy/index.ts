// Phase 0 placeholder — src/core/energy (DESIGN.md §4.5).
// Exact polynomial integration of P = F.v with the W+ / W- split arrives in
// Phase 2.

/** Positive part of instantaneous power P = F.v (throw-work contribution, W+). */
export function positivePart(power: number): number {
  return Math.max(power, 0);
}

/** Negative part of instantaneous power (catch-absorption contribution, W-). */
export function negativePart(power: number): number {
  return Math.min(power, 0);
}
