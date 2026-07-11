import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compiledBallCount,
  compiledSpatialPeriodBeats,
  isExtendedNotation,
  parseNotation,
  validateNotation,
} from './notation';
import { validatePattern } from './index';

describe('isExtendedNotation', () => {
  it('flags only patterns containing ( or [', () => {
    expect(isExtendedNotation('3')).toBe(false);
    expect(isExtendedNotation('531')).toBe(false);
    expect(isExtendedNotation('5x1')).toBe(false); // vanilla: x = value 33
    expect(isExtendedNotation('(4,4)')).toBe(true);
    expect(isExtendedNotation('[33]33')).toBe(true);
    expect(isExtendedNotation('([44],2x)')).toBe(true);
  });
});

describe('validateNotation — vanilla delegation is bit-identical', () => {
  it('routes vanilla text to validatePattern (same ball count)', () => {
    for (const [text, b] of [
      ['3', 3],
      ['531', 3],
      ['441', 3],
      ['b', 11],
    ] as const) {
      const result = validateNotation(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.vanilla).toBe(true);
        expect(result.ballCount).toBe(b);
      }
    }
  });

  it('preserves the verbatim vanilla collision message (first-line contract)', () => {
    const notation = validateNotation('54');
    const vanilla = validatePattern('54');
    expect(notation.ok).toBe(false);
    expect(vanilla.ok).toBe(false);
    if (!notation.ok && !vanilla.ok) {
      expect(notation.errors[0]?.message).toBe(vanilla.errors[0]?.message);
    }
  });
});

describe('validateNotation — sync classics', () => {
  const cases: readonly [string, number, number, boolean][] = [
    // text, ballCount, spatialPeriodBeats(n_h=2), multiplex
    ['(4,4)', 4, 2, false],
    ['(6x,4)*', 5, 4, false],
    ['(4,2x)*', 3, 4, false],
    ['(2,2)', 2, 2, false], // both hands hold
    ['(4,0)', 2, 2, false],
  ];
  for (const [text, ballCount, period, multiplex] of cases) {
    it(`${text} → ${ballCount} balls, spatial period ${period}`, () => {
      const result = validateNotation(text);
      expect(result.ok, `${text} should validate`).toBe(true);
      if (result.ok) {
        expect(result.sync).toBe(true);
        expect(result.multiplex).toBe(multiplex);
        expect(result.ballCount).toBe(ballCount);
        expect(compiledSpatialPeriodBeats(result.compiled, 2)).toBe(period);
      }
    });
  }
});

describe('validateNotation — multiplex classics', () => {
  const cases: readonly [string, number, boolean][] = [
    ['[33]33', 4, true],
    ['24[54]', 5, true],
    ['[54]24', 5, true],
    ['([44],2x)*', 5, true], // valid sync-multiplex combo
  ];
  for (const [text, ballCount, multiplex] of cases) {
    it(`${text} → ${ballCount} balls`, () => {
      const result = validateNotation(text);
      expect(result.ok, `${text} should validate`).toBe(true);
      if (result.ok) {
        expect(result.multiplex).toBe(multiplex);
        expect(result.ballCount).toBe(ballCount);
      }
    });
  }
});

describe('validateNotation — invalid extended patterns', () => {
  it('rejects the unbalanced sync-multiplex ([44],2x)', () => {
    const result = validateNotation('([44],2x)');
    // It PARSES (orchestrator: "must parse") but fails validation (imbalance).
    expect(parseNotation('([44],2x)').ok).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/collision|imbalance/);
    }
  });

  it('rejects a sync collision (4,4x)', () => {
    // both 4 and 4x land in hand 0 at beat 0 → 2 land, 1 thrown there.
    const result = validateNotation('(4,4x)');
    expect(result.ok).toBe(false);
  });

  it('rejects the bare unmirrored (6x,4) (both balls land in the right hand)', () => {
    // Only valid as (6x,4)* — the single repeating pair is unbalanced.
    expect(parseNotation('(6x,4)').ok).toBe(true);
    expect(validateNotation('(6x,4)').ok).toBe(false);
  });

  it('rejects an empty multiplex and a 0 inside a multiplex', () => {
    expect(validateNotation('[]3').ok).toBe(false);
    expect(validateNotation('[30]3').ok).toBe(false);
  });

  it('rejects unbalanced multiplex [3]2 (2 balls thrown ≠ arriving)', () => {
    // [3]2: beat0 throws 1, beat1 throws 1; landings: 3@0→beat0, 2@1→beat1. Actually valid.
    // Use a genuinely unbalanced one instead: [33]3 (period 2): out[0]=2,out[1]=1;
    // 3s from beat0 land beat (0+3)%2=1 (×2); 3 from beat1 lands beat (1+3)%2=0.
    // in[1]=2, in[0]=1 → out[0]=2≠in[0]=1. Invalid.
    const result = validateNotation('[33]3');
    expect(result.ok).toBe(false);
  });

  it('reports a syntax error on an unclosed group', () => {
    expect(validateNotation('[33').ok).toBe(false);
    expect(validateNotation('(4,4').ok).toBe(false);
  });

  it("rejects a crossing 'x' on an async throw (sync-only, ruling)", () => {
    // Inside a multiplex the pattern IS extended, so [54x]24 routes to the extended
    // parser; the `x` on the async 4 is well defined only for sync, so it must reject
    // (not silently simulate as [54]24).
    const bracketed = validateNotation('[54x]24');
    expect(bracketed.ok).toBe(false);
    if (!bracketed.ok) {
      expect(bracketed.errors[0]?.message).toMatch(/crossing 'x' is supported in sync patterns only/);
    }
    // The extended async parser itself rejects a bare async cross (5x14) with the same
    // message — the crossing hand is undefined without an explicit sync hand.
    const bare = parseNotation('5x14');
    expect(bare.ok).toBe(false);
    if (!bare.ok) {
      expect(bare.errors[0]?.message).toMatch(/crossing 'x' is supported in sync patterns only/);
    }
  });

  it("preserves vanilla 'x' = value 33 (5x1 is NOT extended)", () => {
    // 5x1 has no ( or [, so it is vanilla: x is the digit for 33, giving [5, 33, 1] —
    // the async-cross rejection must not touch this path.
    expect(isExtendedNotation('5x1')).toBe(false);
    const result = validateNotation('5x1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vanilla).toBe(true);
      expect(result.values).toEqual([5, 33, 1]);
    }
  });
});

describe('compiledBallCount matches the sum/period definition', () => {
  it('([44],2x)* is a 5-ball pattern', () => {
    const parsed = parseNotation('([44],2x)*');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(compiledBallCount(parsed.compiled)).toBe(5);
      expect(parsed.compiled.period).toBe(4);
    }
  });
});

// --- Property: generated valid patterns validate; mutations fail ------------------

describe('property: random valid async multiplex patterns validate', () => {
  it('a landing-schedule-consistent multiplex pattern passes', () => {
    // Build a random valid async multiplex directly from a permutation-with-multiplicity:
    // pick a period L and, for each beat, a set of throw values whose landing sites form
    // a multiset equal to the throw-count multiset (the in==out condition).
    const arb = fc.integer({ min: 1, max: 4 }).chain((length) =>
      fc
        .array(fc.integer({ min: 1, max: 3 }), { minLength: length, maxLength: length })
        .map((counts) => ({ length, counts })),
    );
    fc.assert(
      fc.property(arb, ({ length, counts }) => {
        // Assign each beat `counts[b]` throws; give ball b a base landing so the schedule
        // balances: simplest guaranteed-valid family is every throw = k·length + base so it
        // lands on a fixed target beat. Construct out==in by making beat b throw `counts[b]`
        // balls all of value `length` (land back on beat b). That is trivially balanced.
        const beats: string[] = [];
        for (let b = 0; b < length; b++) {
          const n = counts[b] as number;
          const group = Array.from({ length: n }, () => valueChar(length)).join('');
          beats.push(n >= 2 ? `[${group}]` : group);
        }
        const text = beats.join('');
        const result = validateNotation(text);
        expect(result.ok, `${text} should validate`).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});

function valueChar(value: number): string {
  return value <= 9 ? String(value) : String.fromCharCode(97 + (value - 10));
}
