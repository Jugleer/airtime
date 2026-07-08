// Phase 0 placeholder — src/core/timing (DESIGN.md §4.1, §4.6).

/**
 * Effective dwell preceding the rethrow of a ball whose incoming throw value was
 * h, NOTATION.md identity (4): t_d_eff(h) = min(t_d, beta * h * tau_b).
 * Guarantees t_air > 0 for every airborne throw (why 51, 531, 423 are possible).
 *
 * @param dwellTime   t_d, the global dwell slider (s).
 * @param throwValue  h of the incoming throw (beats).
 * @param beatPeriod  tau_b, the beat period (s).
 * @param betaClamp   beta, the per-throw dwell clamp factor (default 0.75).
 */
export function effectiveDwell(
  dwellTime: number,
  throwValue: number,
  beatPeriod: number,
  betaClamp = 0.75,
): number {
  return Math.min(dwellTime, betaClamp * throwValue * beatPeriod);
}
