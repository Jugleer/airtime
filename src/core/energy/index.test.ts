import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validatePattern } from '../siteswap';
import { buildTimeline, type TimelineParams } from '../timeline';
import {
  buildKinematics,
  magnitudeSquared,
  type CarryMotion,
  type Kinematics,
  type PolySegment,
} from '../kinematics';
import {
  aggregateHandEnergy,
  carryEnergy,
  energyReport,
  negativePart,
  positivePart,
  segmentPower,
} from './index';

const DEFAULT_PARAMS: TimelineParams = { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 };
const G = 9.81;

function kinematicsFor(
  text: string,
  beatCount: number,
  handCount = 2,
): { kinematics: Kinematics; timeline: ReturnType<typeof buildTimeline> } {
  const result = validatePattern(text);
  if (!result.ok) {
    throw new Error(`fixture pattern ${text} is invalid`);
  }
  const values = result.values;
  const timeline = buildTimeline(values, { beatCount, params: { ...DEFAULT_PARAMS, handCount } });
  return { kinematics: buildKinematics(timeline, { values, handCount }), timeline };
}

/** The work–energy theorem value for a carry: net = ΔKE + g·Δy (per kg). */
function workEnergyExpectation(carry: CarryMotion, gravity: number): number {
  const deltaKE = 0.5 * (magnitudeSquared(carry.endVelocity) - magnitudeSquared(carry.startVelocity));
  const deltaY = carry.throwPoint.y - carry.catchPoint.y;
  return deltaKE + gravity * deltaY;
}

// --- Placeholder-era API (kept) ---------------------------------------------

describe('positivePart / negativePart', () => {
  it('splits power into throw work (W+) and catch absorption (W−)', () => {
    expect(positivePart(2)).toBe(2);
    expect(positivePart(-2)).toBe(0);
    expect(negativePart(-2)).toBe(-2);
    expect(negativePart(2)).toBe(0);
  });

  it('sums the split back to the original power', () => {
    for (const power of [-3, -0.5, 0, 1.25, 4]) {
      expect(positivePart(power) + negativePart(power)).toBeCloseTo(power, 12);
    }
  });
});

// --- Power polynomial -------------------------------------------------------

describe('segmentPower', () => {
  it('gives zero power for a flight segment (F = 0 in free fall)', () => {
    const { kinematics } = kinematicsFor('3', 12);
    const flight = kinematics.ballSegments(0).find((s) => s.y.degree === 2);
    expect(flight).toBeDefined();
    if (!flight) return;
    const { power, duration } = segmentPower(flight, G);
    // Contact force is zero throughout a flight, so P ≡ 0 and its integral is 0.
    expect(Math.abs(power.integrate(0, duration))).toBeLessThan(1e-12);
  });
});

// --- Carry energy & the work–energy cross-check (§4.5) ----------------------

describe('carryEnergy — W+/W− split and net', () => {
  it('reports W+ ≥ 0, W− ≤ 0, and net = W+ + W−', () => {
    const { kinematics } = kinematicsFor('531', 24);
    for (const carry of kinematics.allCarries()) {
      if (carry.startBeat < 0 || carry.startBeat > 18) continue;
      const energy = carryEnergy(carry.segments, G);
      expect(energy.workPositive).toBeGreaterThanOrEqual(-1e-12);
      expect(energy.workNegative).toBeLessThanOrEqual(1e-12);
      expect(energy.net).toBeCloseTo(energy.workPositive + energy.workNegative, 12);
    }
  });

  it('does real throw work on a cascade carry (W+ > 0)', () => {
    const { kinematics } = kinematicsFor('3', 16);
    const carry = kinematics.allCarries().find((c) => c.startBeat >= 4 && c.startBeat <= 10);
    expect(carry).toBeDefined();
    if (!carry) return;
    expect(carryEnergy(carry.segments, G).workPositive).toBeGreaterThan(0);
  });
});

/**
 * Independent oracle for the W⁺/W⁻ split: dense midpoint quadrature of max(P, 0)
 * and min(P, 0) over each carry segment, using segmentPower's exact power
 * polynomial. This pins the split itself, not just its sum, so a root-finding
 * regression that mis-attributes power between W⁺ and W⁻ while preserving net is
 * caught. Numeric integration is a TEST-only tool here — the core ban on numeric
 * methods does not apply to tests.
 */
function quadratureSplit(
  segments: readonly PolySegment[],
  gravity: number,
  samples = 20000,
): { positive: number; negative: number } {
  let positive = 0;
  let negative = 0;
  for (const segment of segments) {
    const { power, duration } = segmentPower(segment, gravity);
    const step = duration / samples;
    for (let i = 0; i < samples; i++) {
      const value = power.eval((i + 0.5) * step);
      if (value > 0) {
        positive += value * step;
      } else {
        negative += value * step;
      }
    }
  }
  return { positive, negative };
}

describe('carryEnergy — W+/W− split matches a dense quadrature oracle (§4.5)', () => {
  const cases = [
    { pattern: '531', gravity: G, holdDepth: 0.1 },
    { pattern: '51', gravity: 30, holdDepth: 0.1 },
    { pattern: '531', gravity: G, holdDepth: 0.4 },
  ];
  for (const { pattern, gravity, holdDepth } of cases) {
    it(`splits ${pattern} (g=${gravity}, holdDepth=${holdDepth}) to the quadrature oracle`, () => {
      const result = validatePattern(pattern);
      if (!result.ok) throw new Error(`bad fixture ${pattern}`);
      const values = result.values;
      const timeline = buildTimeline(values, { beatCount: 28, params: DEFAULT_PARAMS });
      const kinematics = buildKinematics(timeline, { values, handCount: 2, gravity, holdDepth });
      // Tolerance ~1e-6 relative (quadrature error dominates the closed-form split),
      // with a small absolute floor for low-work carries.
      const tol = (expected: number): number => 1e-6 * Math.abs(expected) + 1e-8;
      let checked = 0;
      for (const carry of kinematics.allCarries()) {
        if (carry.startBeat < 4 || carry.startBeat > 16) continue;
        const energy = carryEnergy(carry.segments, gravity);
        const oracle = quadratureSplit(carry.segments, gravity);
        expect(Math.abs(energy.workPositive - oracle.positive)).toBeLessThanOrEqual(
          tol(oracle.positive),
        );
        expect(Math.abs(energy.workNegative - oracle.negative)).toBeLessThanOrEqual(
          tol(oracle.negative),
        );
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('property: net contact work = ΔKE + g·Δy to 1e-9 (work–energy theorem)', () => {
  it('holds for every carry across many patterns and hand counts', () => {
    const arb = fc.constantFrom('3', '531', '441', '423', '522', '51', '40', '55500', '633');
    fc.assert(
      fc.property(arb, fc.constantFrom(2, 3), (pattern, handCount) => {
        const { kinematics } = kinematicsFor(pattern, 28, handCount);
        for (const carry of kinematics.allCarries()) {
          if (carry.startBeat < 4 || carry.startBeat > 20) continue;
          const net = carryEnergy(carry.segments, G).net;
          expect(net).toBeCloseTo(workEnergyExpectation(carry, G), 9);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('holds under a non-default gravity and hold depth', () => {
    const result = validatePattern('531');
    if (!result.ok) throw new Error('bad fixture');
    const values = result.values;
    const timeline = buildTimeline(values, { beatCount: 24, params: DEFAULT_PARAMS });
    const gravity = 4.2;
    const kinematics = buildKinematics(timeline, { values, handCount: 2, gravity, holdDepth: 0.25 });
    for (const carry of kinematics.allCarries()) {
      if (carry.startBeat < 4 || carry.startBeat > 18) continue;
      expect(carryEnergy(carry.segments, gravity).net).toBeCloseTo(
        workEnergyExpectation(carry, gravity),
        9,
      );
    }
  });

  it('holds at gravity and hold-depth extremes (fixed rows)', () => {
    const result = validatePattern('531');
    if (!result.ok) throw new Error('bad fixture');
    const values = result.values;
    // Cross the gravity extremes g ∈ {0.5, 30} with the hold-depth extremes
    // holdDepth ∈ {0, 0.4}; the identity is geometry- and gravity-independent.
    const rows = [
      { gravity: 0.5, holdDepth: 0 },
      { gravity: 0.5, holdDepth: 0.4 },
      { gravity: 30, holdDepth: 0 },
      { gravity: 30, holdDepth: 0.4 },
    ];
    for (const { gravity, holdDepth } of rows) {
      const timeline = buildTimeline(values, { beatCount: 24, params: DEFAULT_PARAMS });
      const kinematics = buildKinematics(timeline, { values, handCount: 2, gravity, holdDepth });
      for (const carry of kinematics.allCarries()) {
        if (carry.startBeat < 4 || carry.startBeat > 18) continue;
        expect(carryEnergy(carry.segments, gravity).net).toBeCloseTo(
          workEnergyExpectation(carry, gravity),
          9,
        );
      }
    }
  });
});

// --- Aggregation & the panel report -----------------------------------------

describe('aggregateHandEnergy', () => {
  it('counts one carry per active throw-beat over the period and reports magnitudes', () => {
    const { kinematics } = kinematicsFor('3', 24);
    const period = kinematics.spatialPeriodBeats; // 2 beats for 3 at n_h=2
    const energy = aggregateHandEnergy(0, kinematics.carriesForHand(0), 0, period, period * 0.25, G);
    expect(energy.carryCount).toBe(1); // hand 0 throws once per 2-beat period
    expect(energy.workNegativeMagnitude).toBeGreaterThanOrEqual(0);
    expect(energy.net).toBeCloseTo(energy.workPositive - energy.workNegativeMagnitude, 12);
    expect(energy.averagePower).toBeCloseTo(energy.workPositive / (period * 0.25), 12);
  });

  it('has zero average power for a zero-length period', () => {
    const energy = aggregateHandEnergy(0, [], 0, 0, 0, G);
    expect(energy.averagePower).toBe(0);
    expect(energy.carryCount).toBe(0);
  });
});

describe('energyReport — panel data (§4.5, §6)', () => {
  it('is symmetric for the cascade and sums per-hand into totals', () => {
    const { kinematics, timeline } = kinematicsFor('3', 24);
    const report = energyReport(kinematics, timeline);
    expect(report.perHand).toHaveLength(2);
    // The two hands of a symmetric cascade do equal work.
    const [h0, h1] = report.perHand;
    expect(h0?.workPositive).toBeCloseTo(h1?.workPositive ?? -1, 9);
    expect(report.totalWorkPositive).toBeCloseTo(
      (h0?.workPositive ?? 0) + (h1?.workPositive ?? 0),
      9,
    );
    expect(report.totalNet).toBeCloseTo(report.totalWorkPositive - report.totalWorkNegativeMagnitude, 9);
    expect(report.periodTime).toBeGreaterThan(0);
  });

  it('is stable across periods (per-period energy is the same each period)', () => {
    const { kinematics, timeline } = kinematicsFor('531', 36);
    const period = kinematics.spatialPeriodBeats;
    const periodTime = timeline.beatTime(period) - timeline.beatTime(0);
    const carries = kinematics.carriesForHand(0);
    const first = aggregateHandEnergy(0, carries, period, period, periodTime, G);
    const second = aggregateHandEnergy(0, carries, 2 * period, period, periodTime, G);
    expect(second.workPositive).toBeCloseTo(first.workPositive, 8);
    expect(second.net).toBeCloseTo(first.net, 8);
  });
});

// --- Per-carry gravity under a runtime gravity epoch (§4.6) ------------------

describe('per-carry gravity threading (§4.6)', () => {
  it('evaluates each carry with the gravity in effect for that carry', () => {
    const result = validatePattern('3');
    if (!result.ok) throw new Error('bad fixture');
    const values = result.values;
    const timeline = buildTimeline(values, { beatCount: 24, params: DEFAULT_PARAMS });
    const epochTime = timeline.beatTime(8);
    const gravityAfter = 3;
    const kinematics = buildKinematics(timeline, {
      values,
      handCount: 2,
      gravity: G,
      epochs: [{ time: epochTime, gravity: gravityAfter }],
    });
    let sawBefore = false;
    let sawAfter = false;
    for (const carry of kinematics.allCarries()) {
      if (carry.startBeat < 2 || carry.startBeat > 18) continue;
      // A carry resolves its gravity at its catch time (its own start).
      const expected = carry.startTime < epochTime ? G : gravityAfter;
      expect(carry.gravity).toBeCloseTo(expected, 12);
      sawBefore ||= expected === G;
      sawAfter ||= expected === gravityAfter;
      // Work–energy theorem holds with the carry's OWN gravity (net = ΔKE + g·Δy).
      const deltaKE =
        0.5 *
        (magnitudeSquared(carry.endVelocity) - magnitudeSquared(carry.startVelocity));
      const deltaY = carry.throwPoint.y - carry.catchPoint.y;
      expect(carryEnergy(carry.segments, carry.gravity).net).toBeCloseTo(
        deltaKE + carry.gravity * deltaY,
        8,
      );
    }
    expect(sawBefore && sawAfter).toBe(true);
  });
});
