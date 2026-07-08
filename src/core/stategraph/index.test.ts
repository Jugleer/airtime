import { describe, expect, it } from 'vitest';
import { popcount } from './index';

describe('core/stategraph placeholder', () => {
  it('counts occupied landing slots (= ball count b)', () => {
    expect(popcount([true, false, true])).toBe(2);
    expect(popcount([true, true, true])).toBe(3);
    expect(popcount([])).toBe(0);
  });
});
