import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ballCount,
  digitToValue,
  formatPattern,
  landsAtBeat,
  landingSite,
  meanThrow,
  MAX_THROW,
  orbits,
  parsePattern,
  periodLength,
  spatialPeriodBeats,
  stateAt,
  stateSequence,
  validatePattern,
  valueToDigit,
} from './index';

// --- Character parsing -------------------------------------------------------

describe('digitToValue / valueToDigit', () => {
  it('maps digits 0-9 and letters a-z to 0-35', () => {
    expect(digitToValue('0')).toBe(0);
    expect(digitToValue('9')).toBe(9);
    expect(digitToValue('a')).toBe(10);
    expect(digitToValue('z')).toBe(35);
  });

  it('accepts uppercase letters', () => {
    expect(digitToValue('A')).toBe(10);
    expect(digitToValue('Z')).toBe(35);
  });

  it('rejects other characters and multi-char strings', () => {
    expect(digitToValue('!')).toBeNull();
    expect(digitToValue(' ')).toBeNull();
    expect(digitToValue('ab')).toBeNull();
  });

  it('round-trips every encodable value through its canonical char', () => {
    for (let value = 0; value <= MAX_THROW; value++) {
      expect(digitToValue(valueToDigit(value))).toBe(value);
    }
  });

  it('throws for out-of-range values', () => {
    expect(() => valueToDigit(-1)).toThrow(RangeError);
    expect(() => valueToDigit(36)).toThrow(RangeError);
    expect(() => valueToDigit(1.5)).toThrow(RangeError);
  });
});

describe('parsePattern', () => {
  it('parses a pattern and ignores whitespace', () => {
    const parsed = parsePattern('5 3 1');
    expect(parsed.ok && parsed.values).toEqual([5, 3, 1]);
  });

  it('parses letters', () => {
    const parsed = parsePattern('b97');
    expect(parsed.ok && parsed.values).toEqual([11, 9, 7]);
  });

  it('reports each bad character with its index', () => {
    const parsed = parsePattern('5!3');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0]?.index).toBe(1);
      expect(parsed.errors[0]?.character).toBe('!');
    }
  });
});

// --- Average / period / helpers ---------------------------------------------

describe('ballCount, meanThrow, periodLength, landingSite', () => {
  it('computes b as the mean throw value (average theorem)', () => {
    expect(ballCount([5, 3, 1])).toBe(3);
    expect(ballCount([])).toBe(0);
    expect(meanThrow([4, 0])).toBe(2);
    expect(meanThrow([])).toBe(0);
  });

  it('reports the period length', () => {
    expect(periodLength([5, 3, 1])).toBe(3);
    expect(periodLength([])).toBe(0);
  });

  it('computes the landing site (i + h) mod L', () => {
    expect(landingSite(0, 5, 3)).toBe(2);
    expect(landingSite(2, 1, 3)).toBe(0);
  });
});

// --- Validation --------------------------------------------------------------

describe('validatePattern', () => {
  it('accepts canonical valid patterns and reports b', () => {
    for (const [text, b] of [
      ['3', 3],
      ['531', 3],
      ['441', 3],
      ['97531', 5],
      ['423', 3],
      ['b', 11],
    ] as const) {
      const result = validatePattern(text);
      expect(result.ok, `${text} should be valid`).toBe(true);
      if (result.ok) {
        expect(result.ballCount).toBe(b);
      }
    }
  });

  it('names the colliding beats on a collision', () => {
    const result = validatePattern('54');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const collision = result.errors.find((e) => e.kind === 'collision');
      expect(collision?.message).toBe(
        'collision at beat 1: the 5 thrown at beat 0 and the 4 thrown at beat 1 both land there.',
      );
      expect(collision?.kind === 'collision' && collision.throws.map((t) => t.beat)).toEqual([
        0, 1,
      ]);
    }
  });

  it('lists three colliding throws with an Oxford-comma "all land there" message', () => {
    // 3@0, 2@1, 1@2 all map to site 0 (mod 3): three real throws land there.
    const result = validatePattern([3, 2, 1]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const collision = result.errors.find((e) => e.kind === 'collision');
      expect(collision?.message).toBe(
        'collision at beat 0: the 3 thrown at beat 0, the 2 thrown at beat 1, and the 1 thrown at beat 2 all land there.',
      );
    }
  });

  it('describes a value-0 collider as an idle beat, not a thrown ball', () => {
    // 10: the 1 lands on beat 1, where the 0 leaves the hand idle — double-booked.
    const result = validatePattern([1, 0]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const collision = result.errors.find((e) => e.kind === 'collision');
      expect(collision?.message).toBe(
        'collision at beat 1: the 1 thrown at beat 0 lands on beat 1, which the 0 at beat 1 leaves idle.',
      );
    }
  });

  it('flags a non-integer average', () => {
    const result = validatePattern('30');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.kind === 'average')).toBe(true);
    }
  });

  it('rejects the empty pattern', () => {
    const result = validatePattern('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.kind).toBe('average');
    }
  });

  it('propagates character errors', () => {
    const result = validatePattern('5?');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.kind).toBe('character');
    }
  });
});

// --- Orbits & spatial period -------------------------------------------------

describe('orbits', () => {
  it('partitions throws into ball-identity cycles', () => {
    expect(orbits([3])).toEqual([[0]]);
    // The 0 in `40` is a σ-fixed point carrying no ball, so it is not an orbit.
    expect(orbits([4, 0])).toEqual([[0]]);
    expect(orbits([5, 3, 1])).toEqual([[0, 2], [1]]);
    expect(orbits([4, 2, 3])).toEqual([[0, 1], [2]]);
  });

  it('excludes zero-ball cycles (a 0 carries no physical ball)', () => {
    // 3-ball pattern: three self-loops of value 5, and two idle 0s that drop out.
    expect(orbits([5, 0, 5, 0, 5])).toEqual([[0], [2], [4]]);
    // An all-zero pattern has no orbits at all.
    expect(orbits([0])).toEqual([]);
  });
});

describe('spatialPeriodBeats', () => {
  it('is lcm(minimal digit period, n_h)', () => {
    expect(spatialPeriodBeats([3], 2)).toBe(2);
    expect(spatialPeriodBeats([3], 1)).toBe(1);
    expect(spatialPeriodBeats([5, 3, 1], 2)).toBe(6);
    expect(spatialPeriodBeats([4, 0], 2)).toBe(2);
    expect(spatialPeriodBeats([], 2)).toBe(0);
    expect(spatialPeriodBeats([3], 0)).toBe(0);
  });

  it('reduces a non-minimal digit sequence before taking the lcm', () => {
    // 333 physically repeats every 2 beats (n_h=2), not lcm(3,2)=6.
    expect(spatialPeriodBeats([3, 3, 3], 2)).toBe(2);
    // 531531 reduces to period 3: lcm(3,2)=6.
    expect(spatialPeriodBeats([5, 3, 1, 5, 3, 1], 2)).toBe(6);
    // Already-minimal sequences are unaffected.
    expect(spatialPeriodBeats([3], 2)).toBe(2);
    expect(spatialPeriodBeats([5, 1], 2)).toBe(2);
  });
});

// --- State semantics ---------------------------------------------------------

describe('state semantics', () => {
  it('gives the ground state of a cascade popcount = b', () => {
    // 3 -> 111 (bits 0,1,2), 5 -> 11111.
    expect(stateAt([3], 0, 5)).toEqual([true, true, true, false, false]);
    expect(stateAt([5], 0, 6)).toEqual([true, true, true, true, true, false]);
  });

  it('matches the known 531 excited states', () => {
    const seq = stateSequence([5, 3, 1], 5);
    // Every state has popcount 3 (three balls).
    for (const state of seq) {
      expect(state.filter(Boolean)).toHaveLength(3);
    }
    expect(seq[0]).toEqual([true, true, true, false, false]);
  });

  it('landsAtBeat detects which beats receive a ball', () => {
    // 40: hand 0 (even beats) catches; odd beats are holes.
    expect(landsAtBeat([4, 0], 0)).toBe(true);
    expect(landsAtBeat([4, 0], 2)).toBe(true);
    expect(landsAtBeat([4, 0], 1)).toBe(false);
    expect(landsAtBeat([], 0)).toBe(false);
  });
});

// --- Property tests ----------------------------------------------------------

/** A permutation of [0..L-1] derived from a stable argsort of random keys. */
function permutationFromKeys(keys: number[]): number[] {
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.index);
}

/**
 * Arbitrary valid siteswap: choose L and a landing permutation π, set
 * base[i] = (π(i) − i) mod L, then add non-negative multiples of L. The map
 * i → (i + p[i]) mod L is π (a bijection), so it is collision-free, and the
 * average is an integer by the theorem — a valid pattern by construction.
 */
const validPatternArb = fc.integer({ min: 1, max: 8 }).chain((length) =>
  fc
    .record({
      keys: fc.array(fc.nat(), { minLength: length, maxLength: length }),
      extra: fc.array(fc.integer({ min: 0, max: 3 }), {
        minLength: length,
        maxLength: length,
      }),
    })
    .map(({ keys, extra }) => {
      const permutation = permutationFromKeys(keys);
      return permutation.map((target, index) => {
        const base = ((target - index) % length + length) % length;
        return base + length * (extra[index] as number);
      });
    }),
);

describe('property: valid patterns validate and round-trip', () => {
  it('every constructed valid pattern validates with integer b', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const result = validatePattern(values);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const sum = values.reduce((a, b) => a + b, 0);
          expect(result.ballCount).toBe(sum / values.length);
          expect(Number.isInteger(result.ballCount)).toBe(true);
        }
      }),
    );
  });

  it('formatPattern then parsePattern is the identity', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const text = formatPattern(values);
        const parsed = parsePattern(text);
        expect(parsed.ok && parsed.values).toEqual(values);
      }),
    );
  });
});

describe('property: collisions are rejected with the colliding beats named', () => {
  it('names both forced-collision beats', () => {
    const collisionCaseArb = fc
      .integer({ min: 2, max: 8 })
      .chain((length) =>
        fc.record({
          length: fc.constant(length),
          site: fc.integer({ min: 0, max: length - 1 }),
          pair: fc
            .uniqueArray(fc.integer({ min: 0, max: length - 1 }), {
              minLength: 2,
              maxLength: 2,
            })
            .filter((p) => p.length === 2),
          extra: fc.array(fc.integer({ min: 0, max: 3 }), {
            minLength: length,
            maxLength: length,
          }),
          fill: fc.array(fc.integer({ min: 0, max: 9 }), {
            minLength: length,
            maxLength: length,
          }),
        }),
      )
      .map(({ length, site, pair, extra, fill }) => {
        const values = [...fill];
        for (const index of pair) {
          const base = ((site - index) % length + length) % length;
          values[index] = base + length * (extra[index] as number);
        }
        return { values, site, pair: [...pair].sort((a, b) => a - b) };
      });

    fc.assert(
      fc.property(collisionCaseArb, ({ values, site, pair }) => {
        const result = validatePattern(values);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          const collision = result.errors.find(
            (e) => e.kind === 'collision' && e.beat === site,
          );
          expect(collision, `expected a collision at beat ${site}`).toBeDefined();
          if (collision && collision.kind === 'collision') {
            const beats = collision.throws.map((t) => t.beat);
            expect(beats).toContain(pair[0]);
            expect(beats).toContain(pair[1]);
          }
        }
      }),
    );
  });
});
