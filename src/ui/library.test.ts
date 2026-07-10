import { describe, expect, it } from 'vitest';
import { PATTERN_LIBRARY, buildLibrary } from './library';
import { validatePattern } from '../core/siteswap';

describe('pattern library (DESIGN.md §6; PLAN.md Phase 9)', () => {
  it('has at least 30 curated entries', () => {
    expect(PATTERN_LIBRARY.length).toBeGreaterThanOrEqual(30);
  });

  it('every entry is a valid siteswap with a ball count matching the parser', () => {
    for (const entry of PATTERN_LIBRARY) {
      const result = validatePattern(entry.pattern);
      expect(result.ok, `${entry.pattern} should validate`).toBe(true);
      if (result.ok) {
        expect(entry.ballCount).toBe(result.ballCount);
        expect(Number.isInteger(entry.ballCount)).toBe(true);
      }
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate patterns', () => {
    const patterns = PATTERN_LIBRARY.map((entry) => entry.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('spans every ball count 2 through 7 (the dropdown groups by count)', () => {
    const counts = new Set(PATTERN_LIBRARY.map((entry) => entry.ballCount));
    for (const count of [2, 3, 4, 5, 6, 7]) {
      expect(counts.has(count), `expected at least one ${count}-ball pattern`).toBe(true);
    }
  });

  it('buildLibrary is deterministic', () => {
    expect(buildLibrary()).toEqual(buildLibrary());
  });
});
