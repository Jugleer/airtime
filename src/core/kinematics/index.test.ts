import { describe, expect, it } from 'vitest';
import { apexHeight } from './index';

describe('core/kinematics placeholder', () => {
  it('computes the apex height from air time and gravity', () => {
    // z_apex = g * t_air^2 / 8; t_air = 1 s, g = 9.81 -> 9.81 / 8
    expect(apexHeight(1, 9.81)).toBeCloseTo(9.81 / 8, 12);
  });

  it('has zero apex for a zero air time', () => {
    expect(apexHeight(0)).toBe(0);
  });
});
