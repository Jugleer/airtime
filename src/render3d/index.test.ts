import { describe, expect, it } from 'vitest';
import { defaultThrowPoint, sampleApexHeight } from './index';

describe('render3d placeholder (render3d layer)', () => {
  it('places hand 0 at y = 1.0 m using a three Vector3', () => {
    const point = defaultThrowPoint();
    expect(point.x).toBeCloseTo(0.1, 12);
    expect(point.y).toBe(1.0);
    expect(point.z).toBe(0);
  });

  it('reuses core/kinematics for the sample apex height', () => {
    // z_apex = g * t_air^2 / 8 = 9.81 * 0.25 / 8
    expect(sampleApexHeight).toBeCloseTo((9.81 * 0.25) / 8, 12);
  });
});
