// src/core/energy — per-hand contact work over the carries (DESIGN.md §4.5).
//
// During a carry the hand exerts a contact force F(t) = m·(a(t) − g_vec) on the
// ball (m = 1 kg normalized, g_vec = (0, −g, 0)); F = 0 at both carry endpoints
// by construction (§4.3). Instantaneous power is P = F·v. Because every carry
// segment is a per-axis polynomial (core/kinematics), P is itself a polynomial,
// so the throw-work / catch-absorption split
//
//   W⁺ = ∫ max(P, 0) dt      W⁻ = ∫ min(P, 0) dt      (net = W⁺ + W⁻)
//
// is computed in closed form: split at the sign-change roots of P and integrate
// each signed piece exactly. The work–energy identity net = ΔKE + g·Δy is a
// built-in cross-check (property-tested to 1e-9). Energies are per-kg (m = 1 kg);
// they scale linearly with mass (NOTATION.md conventions).
//
// Pure and deterministic: no Date.now / Math.random / performance.

import type { CarryMotion, Kinematics, PolySegment } from '../kinematics';
import { Polynomial, signedIntegral } from '../kinematics';
import type { Timeline } from '../timeline';

/** Positive part of instantaneous power P = F·v (throw-work contribution, W⁺). */
export function positivePart(power: number): number {
  return Math.max(power, 0);
}

/** Negative part of instantaneous power (catch-absorption contribution, W⁻). */
export function negativePart(power: number): number {
  return Math.min(power, 0);
}

/**
 * The instantaneous-power polynomial P(s) = F·v over a carry segment's local
 * time, with F = a − g_vec (m = 1 kg), g_vec = (0, −g, 0). Position is a
 * polynomial per axis, so v = p′, a = p″, and P = Σ F_axis·v_axis is a polynomial
 * (degree ≤ 7 for the quintic carry). No numeric differentiation (CLAUDE.md rule 3).
 */
export function segmentPower(
  segment: PolySegment,
  gravity: number,
): { power: Polynomial; duration: number } {
  const vx = segment.x.derivative();
  const vy = segment.y.derivative();
  const vz = segment.z.derivative();
  const ax = vx.derivative();
  const ay = vy.derivative();
  const az = vz.derivative();
  // F = m·(a − g_vec), m = 1, g_vec = (0, −g, 0) ⇒ Fx = ax, Fy = ay + g, Fz = az.
  const fx = ax;
  const fy = ay.addConstant(gravity);
  const fz = az;
  const power = fx.multiply(vx).add(fy.multiply(vy)).add(fz.multiply(vz));
  return { power, duration: segment.endTime - segment.startTime };
}

/** Contact work over a carry: W⁺ (throw work), W⁻ (catch absorption, ≤ 0), net. */
export interface CarryEnergy {
  /** W⁺ = ∫ max(P, 0) dt ≥ 0. */
  readonly workPositive: number;
  /** W⁻ = ∫ min(P, 0) dt ≤ 0. */
  readonly workNegative: number;
  /** net = W⁺ + W⁻ = ∫ P dt (equals ΔKE + g·Δy by the work–energy theorem). */
  readonly net: number;
}

/**
 * Exact contact energy over a carry's segments: sum the closed-form signed
 * integrals of P across each segment (DESIGN.md §4.5). `net = W⁺ + W⁻`.
 */
export function carryEnergy(segments: readonly PolySegment[], gravity: number): CarryEnergy {
  let workPositive = 0;
  let workNegative = 0;
  for (const segment of segments) {
    const { power, duration } = segmentPower(segment, gravity);
    const { positive, negative } = signedIntegral(power, 0, duration);
    workPositive += positive;
    workNegative += negative;
  }
  return { workPositive, workNegative, net: workPositive + workNegative };
}

/** Per-hand energy aggregated over one spatial period (DESIGN.md §4.5). */
export interface HandEnergy {
  readonly hand: number;
  /** Number of carries counted in the period. */
  readonly carryCount: number;
  /** Total throw work W⁺ over the period (J/kg). */
  readonly workPositive: number;
  /** Total catch absorption |W⁻| over the period (J/kg, reported as magnitude). */
  readonly workNegativeMagnitude: number;
  /** Net contact work over the period (J/kg). */
  readonly net: number;
  /** Average mechanical power W⁺/period (W/kg). */
  readonly averagePower: number;
  /** Duration of one spatial period (s). */
  readonly periodTime: number;
}

/**
 * Aggregate one hand's carry energy over the beats [periodStartBeat,
 * periodStartBeat + periodBeats). Carries are selected by their catch beat, so
 * each period counts one carry per active throw-beat of the hand.
 *
 * Each carry is evaluated with the gravity IN EFFECT for that carry (DESIGN.md
 * §4.6): a runtime gravity epoch changes the contact work of future carries only.
 * The `gravity` argument is the fallback used when a carry carries no per-carry
 * gravity of its own (kept for signature stability); `CarryMotion.gravity` from
 * `buildKinematics` always resolves the segment's own g.
 */
export function aggregateHandEnergy(
  hand: number,
  carries: readonly CarryMotion[],
  periodStartBeat: number,
  periodBeats: number,
  periodTime: number,
  gravity: number,
): HandEnergy {
  let workPositive = 0;
  let workNegative = 0;
  let carryCount = 0;
  const endBeat = periodStartBeat + periodBeats;
  for (const carry of carries) {
    if (carry.startBeat < periodStartBeat || carry.startBeat >= endBeat) {
      continue;
    }
    const energy = carryEnergy(carry.segments, carry.gravity ?? gravity);
    workPositive += energy.workPositive;
    workNegative += energy.workNegative;
    carryCount += 1;
  }
  return {
    hand,
    carryCount,
    workPositive,
    workNegativeMagnitude: -workNegative,
    net: workPositive + workNegative,
    averagePower: periodTime > 0 ? workPositive / periodTime : 0,
    periodTime,
  };
}

/** The full per-hand energy panel data plus pattern totals (DESIGN.md §6). */
export interface EnergyReport {
  readonly perHand: HandEnergy[];
  readonly totalWorkPositive: number;
  readonly totalWorkNegativeMagnitude: number;
  readonly totalNet: number;
  readonly periodBeats: number;
  readonly periodTime: number;
  /**
   * The first period-aligned beat of the representative window (memory fix #1). 0 in
   * the common (full-range) case; when the sim is windowed to a retain floor the
   * report re-anchors to the first aligned period inside the retained past so the
   * carries it aggregates are always generated. Drives the EnergyPanel caption.
   */
  readonly periodStartBeat: number;
}

/**
 * Build the energy panel report: for every hand, aggregate contact work over one
 * spatial period (DESIGN.md §4.5, §6). The representative period is the first
 * period-aligned window at or above `windowFloorBeat`; energies are per-kg.
 *
 * `windowFloorBeat` (default 0 ⇒ today's `[0, spatialPeriodBeats)` window, byte-
 * identical) is the sim's retain floor under memory fix #1: when the resident sim is
 * windowed to bound long-session memory, its carries below the floor no longer exist,
 * so the report re-anchors its representative period to the first period-aligned beat
 * `⌈windowFloorBeat / P⌉·P` inside the retained past. The beat schedule stays anchored
 * at beat 0, so `beatTime` is exact for the re-anchored window and — on a uniform
 * (settled-tempo) grid — the numbers are identical to the beat-0 window (periodicity).
 */
export function energyReport(
  kinematics: Kinematics,
  timeline: Timeline,
  windowFloorBeat: number = 0,
): EnergyReport {
  const periodBeats = kinematics.spatialPeriodBeats;
  const periodStartBeat =
    periodBeats > 0 ? Math.ceil(Math.max(0, windowFloorBeat) / periodBeats) * periodBeats : 0;
  const periodTime =
    periodBeats > 0
      ? timeline.beatTime(periodStartBeat + periodBeats) - timeline.beatTime(periodStartBeat)
      : 0;
  const perHand: HandEnergy[] = [];
  let totalWorkPositive = 0;
  let totalWorkNegative = 0;
  for (let hand = 0; hand < kinematics.handCount; hand++) {
    const energy = aggregateHandEnergy(
      hand,
      kinematics.carriesForHand(hand),
      periodStartBeat,
      periodBeats,
      periodTime,
      kinematics.gravity,
    );
    perHand.push(energy);
    totalWorkPositive += energy.workPositive;
    totalWorkNegative += energy.net - energy.workPositive; // = W⁻ (≤ 0)
  }
  return {
    perHand,
    totalWorkPositive,
    totalWorkNegativeMagnitude: -totalWorkNegative,
    totalNet: totalWorkPositive + totalWorkNegative,
    periodBeats,
    periodTime,
    periodStartBeat,
  };
}
