import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ballCount as meanBallCount, validatePattern } from '../siteswap';
import {
  canonicalRotation,
  enumerateSiteswaps,
  EXPLORER_MAX_RESULTS,
  EXPLORER_MAX_THROW,
  EXPLORER_PERIOD_MAX,
  type SiteswapQuery,
} from './index';

// The generator (DESIGN.md §5): enumerate valid vanilla siteswaps of (b, L, N) by
// walking closed cycles in the state graph. Every returned pattern must pass the
// existing core/siteswap validator (never a hardcoded folklore list), satisfy the
// average theorem, be in canonical (lex-greatest-rotation) form, and be unique.

describe('core/stategraph enumerateSiteswaps — canonical form', () => {
  it('canonicalRotation returns the lexicographically GREATEST rotation', () => {
    // The juggling convention: 441 not 414, 531 not 315, 504 not 450/045.
    expect(canonicalRotation([4, 1, 4]).join('')).toBe('441');
    expect(canonicalRotation([1, 5, 3]).join('')).toBe('531');
    // Every rotation of the "450" family canonicalizes to 504 (starts with the 5).
    expect(canonicalRotation([4, 5, 0]).join('')).toBe('504');
    expect(canonicalRotation([0, 4, 5]).join('')).toBe('504');
    // A sub-periodic sequence canonicalizes stably regardless of offset.
    expect(canonicalRotation([3, 3, 3]).join('')).toBe('333');
  });

  it('every result is already in canonical form (idempotent)', () => {
    const { patterns } = enumerateSiteswaps({ ballCount: 3, period: 5, maxThrow: 7 });
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(canonicalRotation(p.values)).toEqual(p.values);
    }
  });
});

describe('core/stategraph enumerateSiteswaps — the classic 3-ball sets', () => {
  it('3-ball period-3 maxThrow-5 is exactly {423, 441, 504, 522, 531}', () => {
    const { patterns, truncated } = enumerateSiteswaps({ ballCount: 3, period: 3, maxThrow: 5 });
    expect(truncated).toBe(false);
    expect(patterns.map((p) => p.text)).toEqual(['423', '441', '504', '522', '531']);
    // Spot-check the canonical members the owner named (folklore "450" ⇒ 504).
    const texts = new Set(patterns.map((p) => p.text));
    for (const member of ['441', '531', '522', '504']) {
      expect(texts.has(member)).toBe(true);
    }
  });

  it('the filters carve the expected subsets of that set', () => {
    const base = { ballCount: 3, period: 3, maxThrow: 5 };
    const noZero = enumerateSiteswaps({ ...base, excludeZeros: true }).patterns.map((p) => p.text);
    expect(noZero).toEqual(['423', '441', '522', '531']); // 504 dropped (has a 0)
    const noTwo = enumerateSiteswaps({ ...base, excludeTwos: true }).patterns.map((p) => p.text);
    expect(noTwo).toEqual(['441', '504', '531']); // 423, 522 dropped (have a 2)
    const strict = enumerateSiteswaps({
      ...base,
      excludeZeros: true,
      excludeTwos: true,
    }).patterns.map((p) => p.text);
    expect(strict).toEqual(['441', '531']);
  });

  it('the trivial pattern is the only 3-ball period-1 result', () => {
    const { patterns } = enumerateSiteswaps({ ballCount: 3, period: 1, maxThrow: 5 });
    expect(patterns.map((p) => p.text)).toEqual(['3']);
  });

  it('does NOT list sub-periodic padding (no 333 in the period-3 list)', () => {
    const { patterns } = enumerateSiteswaps({ ballCount: 3, period: 3, maxThrow: 3 });
    // The only max≤3 3-ball pattern is 3 itself (period 1) — nothing has period 3.
    expect(patterns.map((p) => p.text)).toEqual([]);
  });
});

describe('core/stategraph enumerateSiteswaps — validity & the average theorem', () => {
  const domain = fc.record({
    ballCount: fc.integer({ min: 1, max: 7 }),
    period: fc.integer({ min: 1, max: 6 }),
    maxThrow: fc.integer({ min: 1, max: 9 }),
    excludeZeros: fc.boolean(),
    excludeTwos: fc.boolean(),
    primeOnly: fc.boolean(),
  });

  it('every generated pattern passes the core/siteswap validator with the queried b', () => {
    fc.assert(
      fc.property(domain, (query: SiteswapQuery) => {
        const { patterns } = enumerateSiteswaps(query);
        for (const p of patterns) {
          const validation = validatePattern(p.values);
          expect(validation.ok).toBe(true);
          if (validation.ok) {
            // Average theorem: mean(h) === b, an integer, for every result.
            expect(validation.ballCount).toBe(query.ballCount);
          }
          expect(meanBallCount(p.values)).toBeCloseTo(query.ballCount as number, 9);
          expect(p.values.length).toBe(query.period);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('canonical rotations are unique across the returned list', () => {
    fc.assert(
      fc.property(domain, (query: SiteswapQuery) => {
        const { patterns } = enumerateSiteswaps(query);
        const keys = new Set(patterns.map((p) => p.text));
        expect(keys.size).toBe(patterns.length);
      }),
      { numRuns: 200 },
    );
  });

  it('honors the requested filters (no 0s / no 2s / prime)', () => {
    fc.assert(
      fc.property(domain, (query: SiteswapQuery) => {
        const { patterns } = enumerateSiteswaps(query);
        for (const p of patterns) {
          if (query.excludeZeros) {
            expect(p.values.includes(0)).toBe(false);
          }
          if (query.excludeTwos) {
            expect(p.values.includes(2)).toBe(false);
          }
          if (query.primeOnly) {
            expect(p.prime).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('core/stategraph enumerateSiteswaps — primality', () => {
  it('flags 531/441 prime and 423 non-prime (its ground state recurs at beat 2)', () => {
    const three = enumerateSiteswaps({ ballCount: 3, period: 3, maxThrow: 5 }).patterns;
    const byText = new Map(three.map((p) => [p.text, p]));
    expect(byText.get('531')?.prime).toBe(true);
    expect(byText.get('441')?.prime).toBe(true);
    expect(byText.get('423')?.prime).toBe(false);
    // The period-1 cascade has a single state, so it is trivially prime.
    const cascade = enumerateSiteswaps({ ballCount: 3, period: 1, maxThrow: 5 }).patterns;
    expect(cascade[0]?.prime).toBe(true);
  });

  it('primeOnly is a strict subset of the unfiltered set', () => {
    const all = enumerateSiteswaps({ ballCount: 3, period: 5, maxThrow: 7 }).patterns.map(
      (p) => p.text,
    );
    const prime = enumerateSiteswaps({
      ballCount: 3,
      period: 5,
      maxThrow: 7,
      primeOnly: true,
    }).patterns.map((p) => p.text);
    const allSet = new Set(all);
    expect(prime.length).toBeGreaterThan(0);
    expect(prime.length).toBeLessThanOrEqual(all.length);
    for (const text of prime) {
      expect(allSet.has(text)).toBe(true);
    }
  });
});

describe('core/stategraph enumerateSiteswaps — caps & truncation', () => {
  it('flags truncation and never exceeds maxResults', () => {
    const result = enumerateSiteswaps({ ballCount: 3, period: 9, maxThrow: 12 });
    expect(result.patterns.length).toBeLessThanOrEqual(EXPLORER_MAX_RESULTS);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(result.patterns.length);
  });

  it('respects a custom maxResults cap', () => {
    const result = enumerateSiteswaps({ ballCount: 3, period: 7, maxThrow: 9, maxResults: 10 });
    expect(result.patterns.length).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('a fully-enumerated query is not flagged truncated', () => {
    const result = enumerateSiteswaps({ ballCount: 3, period: 3, maxThrow: 5 });
    expect(result.truncated).toBe(false);
  });

  it('returns empty (never throws) for out-of-cap or degenerate queries', () => {
    // period / maxThrow past the caps
    expect(enumerateSiteswaps({ ballCount: 3, period: EXPLORER_PERIOD_MAX + 1, maxThrow: 5 }).patterns).toEqual([]);
    expect(enumerateSiteswaps({ ballCount: 3, period: 3, maxThrow: EXPLORER_MAX_THROW + 1 }).patterns).toEqual([]);
    // b > N admits no pattern (max ≥ mean = b always)
    expect(enumerateSiteswaps({ ballCount: 6, period: 3, maxThrow: 4 }).patterns).toEqual([]);
    // degenerate
    expect(enumerateSiteswaps({ ballCount: 0, period: 3, maxThrow: 5 }).patterns).toEqual([]);
    expect(enumerateSiteswaps({ ballCount: 3, period: 0, maxThrow: 5 }).patterns).toEqual([]);
  });

  it('results are sorted ascending by throw values (deterministic order)', () => {
    const { patterns } = enumerateSiteswaps({ ballCount: 3, period: 4, maxThrow: 6 });
    for (let i = 1; i < patterns.length; i++) {
      const a = patterns[i - 1]!.values;
      const b = patterns[i]!.values;
      let cmp = 0;
      for (let k = 0; k < a.length && cmp === 0; k++) cmp = (a[k] as number) - (b[k] as number);
      expect(cmp).toBeLessThan(0);
    }
  });

  it('is deterministic: identical queries give identical lists', () => {
    const q: SiteswapQuery = { ballCount: 4, period: 5, maxThrow: 7 };
    expect(enumerateSiteswaps(q).patterns.map((p) => p.text)).toEqual(
      enumerateSiteswaps(q).patterns.map((p) => p.text),
    );
  });
});
