// src/ui/energyPanel — pure shaping + formatting for the energy panel table
// (DESIGN.md §4.5, §6). No React, no DOM: turns core's period-aggregated
// `EnergyReport` into display rows (one per hand + a totals row) so the panel
// aggregation is unit-testable without mounting a component.
//
// Period window (verified against core/energy `energyReport`): the report
// aggregates each hand's carries over the FIRST spatial period, beats
// [0, spatialPeriodBeats), using each carry's OWN (epoch-threaded) gravity. So the
// numbers describe the steady-state period under the params in force at the START
// of the pattern (t = 0 base). A runtime epoch that lands AFTER the first period
// (the common case — an edit while running is applied at the future playhead beat)
// does NOT move these numbers; a change folded into the base (playhead at t = 0)
// does. The panel documents this so the operator reads the figures correctly.

import type { EnergyReport, HandEnergy } from '../core/energy';

/** One display row of the energy table (a hand, or the totals row). */
export interface EnergyRow {
  /** Row label ("Hand 0", …, or "Total"). */
  readonly label: string;
  /** Throw work W⁺ over the period (J/kg, ≥ 0). */
  readonly workPositive: number;
  /** Catch absorption |W⁻| over the period (J/kg magnitude, ≥ 0). */
  readonly workNegativeMagnitude: number;
  /** Net contact work W = W⁺ − |W⁻| over the period (J/kg). */
  readonly net: number;
  /** Average mechanical power W⁺/period (W/kg). */
  readonly averagePower: number;
}

/** A per-hand {@link HandEnergy} as a display row. */
function handRow(energy: HandEnergy): EnergyRow {
  return {
    label: `Hand ${energy.hand}`,
    workPositive: energy.workPositive,
    workNegativeMagnitude: energy.workNegativeMagnitude,
    net: energy.net,
    averagePower: energy.averagePower,
  };
}

/**
 * The panel's rows: one per hand plus a "Total" row. The totals come from the
 * report's own summed fields (which sum the per-hand values), and the totals-row
 * average power is the sum of per-hand average powers — so the columns add up
 * exactly (the operator's cross-check: net = W⁺ − |W⁻| on every row, and the hand
 * rows sum to the total row). Pure; no rounding here (formatting is separate).
 */
export function energyRows(report: EnergyReport): { hands: EnergyRow[]; total: EnergyRow } {
  const hands = report.perHand.map(handRow);
  let averagePowerTotal = 0;
  for (const energy of report.perHand) {
    averagePowerTotal += energy.averagePower;
  }
  const total: EnergyRow = {
    label: 'Total',
    workPositive: report.totalWorkPositive,
    workNegativeMagnitude: report.totalWorkNegativeMagnitude,
    net: report.totalNet,
    averagePower: averagePowerTotal,
  };
  return { hands, total };
}

/** Format an energy/power value with fixed precision for the table (tabular nums). */
export function formatEnergy(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  // Fold -0 to 0 so a vanishing net doesn't render as "-0.000".
  const cleaned = Object.is(value, -0) ? 0 : value;
  return cleaned.toFixed(decimals);
}
