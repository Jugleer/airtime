import { describe, expect, it } from 'vitest';
import { validatePattern } from '../core/siteswap';
import { buildTimeline, type TimelineParams } from '../core/timeline';
import { buildKinematics } from '../core/kinematics';
import { energyReport, type EnergyReport } from '../core/energy';
import { energyRows, formatEnergy } from './energyPanel';

const DEFAULT_PARAMS: TimelineParams = { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 };

/** Build an energy report for a pattern (a known, deterministic sim). */
function reportFor(text: string, handCount = 2): EnergyReport {
  const result = validatePattern(text);
  if (!result.ok) {
    throw new Error(`fixture pattern ${text} is invalid`);
  }
  const values = result.values;
  const timeline = buildTimeline(values, { beatCount: 24, params: { ...DEFAULT_PARAMS, handCount } });
  const kinematics = buildKinematics(timeline, { values, handCount });
  return energyReport(kinematics, timeline);
}

describe('energyRows — panel aggregation (§4.5, §6)', () => {
  it('emits one row per hand plus a totals row', () => {
    const { hands, total } = energyRows(reportFor('3'));
    expect(hands).toHaveLength(2);
    expect(hands[0]?.label).toBe('Hand 0');
    expect(hands[1]?.label).toBe('Hand 1');
    expect(total.label).toBe('Total');
  });

  it('every row satisfies net = W+ − |W−| (the panel cross-check)', () => {
    const { hands, total } = energyRows(reportFor('531'));
    for (const row of [...hands, total]) {
      expect(row.net).toBeCloseTo(row.workPositive - row.workNegativeMagnitude, 9);
    }
  });

  it('per-hand rows sum to the totals row (each column)', () => {
    const { hands, total } = energyRows(reportFor('531', 3));
    const summed = hands.reduce(
      (acc, row) => ({
        workPositive: acc.workPositive + row.workPositive,
        workNegativeMagnitude: acc.workNegativeMagnitude + row.workNegativeMagnitude,
        net: acc.net + row.net,
        averagePower: acc.averagePower + row.averagePower,
      }),
      { workPositive: 0, workNegativeMagnitude: 0, net: 0, averagePower: 0 },
    );
    expect(total.workPositive).toBeCloseTo(summed.workPositive, 9);
    expect(total.workNegativeMagnitude).toBeCloseTo(summed.workNegativeMagnitude, 9);
    expect(total.net).toBeCloseTo(summed.net, 9);
    expect(total.averagePower).toBeCloseTo(summed.averagePower, 9);
  });

  it('reports non-negative throw work and catch absorption magnitudes', () => {
    const { hands } = energyRows(reportFor('3'));
    for (const row of hands) {
      expect(row.workPositive).toBeGreaterThanOrEqual(-1e-12);
      expect(row.workNegativeMagnitude).toBeGreaterThanOrEqual(-1e-12);
      expect(row.averagePower).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('the symmetric cascade does equal work on both hands', () => {
    const { hands } = energyRows(reportFor('3'));
    expect(hands[0]?.workPositive).toBeCloseTo(hands[1]?.workPositive ?? -1, 9);
  });
});

describe('formatEnergy', () => {
  it('formats to three decimals by default', () => {
    expect(formatEnergy(1.23456)).toBe('1.235');
    expect(formatEnergy(0)).toBe('0.000');
  });

  it('folds negative zero to a clean zero', () => {
    expect(formatEnergy(-0)).toBe('0.000');
  });

  it('renders an em dash for non-finite values', () => {
    expect(formatEnergy(NaN)).toBe('—');
    expect(formatEnergy(Infinity)).toBe('—');
  });

  it('honors a custom precision', () => {
    expect(formatEnergy(2.5, 1)).toBe('2.5');
  });
});
