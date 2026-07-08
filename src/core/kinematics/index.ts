// Phase 0 placeholder — src/core/kinematics (DESIGN.md §4.2–§4.4).
// Closed-form parabola solver + quintic Hermite carry/return paths arrive in
// Phase 2. No numeric differentiation, ever (CLAUDE.md hard rule 3).

/**
 * Physical apex height above the throw point for equal-height throw and catch
 * points, NOTATION.md identity (3): z_apex = g * t_air^2 / 8.
 *
 * @param airTime t_air of the throw (s).
 * @param gravity g (m/s^2, default 9.81).
 */
export function apexHeight(airTime: number, gravity = 9.81): number {
  return (gravity * airTime * airTime) / 8;
}
