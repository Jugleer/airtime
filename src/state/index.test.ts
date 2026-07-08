import { describe, expect, it } from 'vitest';
import { defaultEffectiveDwell, useAppStore } from './index';

describe('app store (state layer)', () => {
  it('starts on the default cascade pattern', () => {
    expect(useAppStore.getState().pattern).toBe('3');
  });

  it('updates the pattern through the action', () => {
    useAppStore.getState().setPattern('531');
    expect(useAppStore.getState().pattern).toBe('531');
    useAppStore.getState().setPattern('3');
  });

  it('derives a default effective dwell from core/timing', () => {
    // t_d_eff = min(0.3, 0.75 * 3 * 0.25) = min(0.3, 0.5625) = 0.3
    expect(defaultEffectiveDwell).toBeCloseTo(0.3, 12);
  });
});
