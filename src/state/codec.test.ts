import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CODEC_VERSION,
  decodeConfig,
  encodeConfig,
  isShareConfigLike,
  type ShareConfig,
} from './codec';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');

const coord = fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true });
const positive = (max: number): fc.Arbitrary<number> =>
  fc.double({ min: 0.001, max, noNaN: true, noDefaultInfinity: true });

const hexColor = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`);

const patternArb = fc
  .array(fc.constantFrom(...DIGITS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

const planarPoint = fc.record({ x: coord, z: coord });

/** A full arbitrary ShareConfig (hand-point arrays sized to the hand count). */
const shareConfigArb: fc.Arbitrary<ShareConfig> = fc
  .integer({ min: 1, max: 8 })
  .chain((handCount) =>
    fc
      .record({
        pattern: patternArb,
        beatPeriod: positive(1),
        dwellTime: positive(1),
        playbackSpeed: positive(2),
        gravity: positive(30),
        holdDepth: positive(0.4),
        carryPathKind: fc.constantFrom('quintic' as const, 'cubic' as const),
        handPreset: fc.constantFrom('line' as const, 'circle' as const),
        handThrowPoints: fc.array(planarPoint, { minLength: handCount, maxLength: handCount }),
        handCatchPoints: fc.array(planarPoint, { minLength: handCount, maxLength: handCount }),
        ballRadius: positive(0.1),
        ballColor: hexColor,
        orbitColoring: fc.boolean(),
        showHands: fc.boolean(),
        showHandPaths: fc.boolean(),
        timelineWindow: positive(15),
        trailLength: positive(8),
        ghostsEnabled: fc.boolean(),
        chartsVisible: fc.boolean(),
        chartAxisMode: fc.constantFrom(
          'magnitude' as const,
          'x' as const,
          'y' as const,
          'z' as const,
        ),
        graphMaxHeight: fc.integer({ min: 3, max: 11 }),
        graphVisible: fc.boolean(),
        graphMinimap: fc.boolean(),
        audioEnabled: fc.boolean(),
        catchTickEnabled: fc.boolean(),
        audioVolume: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        camera: fc.record({
          position: fc.tuple(coord, coord, coord),
          target: fc.tuple(coord, coord, coord),
        }),
        // Optional playhead-time bookmark (present or absent).
        time: fc.option(fc.double({ min: 0, max: 120, noNaN: true, noDefaultInfinity: true }), {
          nil: undefined,
        }),
      })
      .map((rest) => ({ ...rest, handCount })),
  );

/** Codec precision: floats round to 4 dp, so tolerance is comfortably above 5e-5. */
const TOL = 1e-4;

describe('URL codec round-trip (encode → decode = identity to codec precision)', () => {
  it('recovers every field within codec precision for random configs', () => {
    fc.assert(
      fc.property(shareConfigArb, (config) => {
        const decoded = decodeConfig(encodeConfig(config));

        // Discrete fields: exact identity.
        expect(decoded.pattern).toBe(config.pattern);
        expect(decoded.carryPathKind).toBe(config.carryPathKind);
        expect(decoded.handPreset).toBe(config.handPreset);
        expect(decoded.chartAxisMode).toBe(config.chartAxisMode);
        expect(decoded.ballColor).toBe(config.ballColor);
        expect(decoded.handCount).toBe(config.handCount);
        expect(decoded.graphMaxHeight).toBe(config.graphMaxHeight);
        expect(decoded.orbitColoring).toBe(config.orbitColoring);
        expect(decoded.showHands).toBe(config.showHands);
        expect(decoded.showHandPaths).toBe(config.showHandPaths);
        expect(decoded.ghostsEnabled).toBe(config.ghostsEnabled);
        expect(decoded.chartsVisible).toBe(config.chartsVisible);
        expect(decoded.graphVisible).toBe(config.graphVisible);
        expect(decoded.graphMinimap).toBe(config.graphMinimap);
        expect(decoded.audioEnabled).toBe(config.audioEnabled);
        expect(decoded.catchTickEnabled).toBe(config.catchTickEnabled);

        // Continuous fields: within rounding precision.
        expect(decoded.beatPeriod).toBeCloseTo(config.beatPeriod, 4);
        expect(decoded.dwellTime).toBeCloseTo(config.dwellTime, 4);
        expect(decoded.playbackSpeed).toBeCloseTo(config.playbackSpeed, 4);
        expect(decoded.gravity).toBeCloseTo(config.gravity, 4);
        expect(decoded.holdDepth).toBeCloseTo(config.holdDepth, 4);
        expect(decoded.ballRadius).toBeCloseTo(config.ballRadius, 4);
        expect(decoded.timelineWindow).toBeCloseTo(config.timelineWindow, 4);
        expect(decoded.trailLength).toBeCloseTo(config.trailLength, 4);
        expect(decoded.audioVolume).toBeCloseTo(config.audioVolume, 4);

        // Hand-point arrays element-wise.
        expect(decoded.handThrowPoints).toHaveLength(config.handCount);
        expect(decoded.handCatchPoints).toHaveLength(config.handCount);
        for (let i = 0; i < config.handCount; i++) {
          expect(Math.abs((decoded.handThrowPoints?.[i]?.x ?? NaN) - config.handThrowPoints[i]!.x)).toBeLessThanOrEqual(TOL);
          expect(Math.abs((decoded.handThrowPoints?.[i]?.z ?? NaN) - config.handThrowPoints[i]!.z)).toBeLessThanOrEqual(TOL);
          expect(Math.abs((decoded.handCatchPoints?.[i]?.x ?? NaN) - config.handCatchPoints[i]!.x)).toBeLessThanOrEqual(TOL);
          expect(Math.abs((decoded.handCatchPoints?.[i]?.z ?? NaN) - config.handCatchPoints[i]!.z)).toBeLessThanOrEqual(TOL);
        }

        // Camera pose.
        for (let i = 0; i < 3; i++) {
          expect(Math.abs((decoded.camera?.position[i] ?? NaN) - config.camera.position[i]!)).toBeLessThanOrEqual(TOL);
          expect(Math.abs((decoded.camera?.target[i] ?? NaN) - config.camera.target[i]!)).toBeLessThanOrEqual(TOL);
        }

        // Optional time bookmark: absent stays absent; present round-trips to 3 dp.
        if (config.time === undefined) {
          expect(decoded.time).toBeUndefined();
        } else {
          expect(decoded.time).toBeCloseTo(config.time, 3);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('encode is idempotent through decode (re-encoding a decoded config is stable)', () => {
    fc.assert(
      fc.property(shareConfigArb, (config) => {
        const once = encodeConfig(config);
        const decoded = decodeConfig(once) as ShareConfig;
        expect(encodeConfig(decoded)).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});

describe('URL codec versioning + graceful degradation', () => {
  it('emits the required version field', () => {
    const query = encodeConfig(sampleConfig());
    expect(new URLSearchParams(query).get('v')).toBe(CODEC_VERSION);
  });

  it('treats an unversioned query as no shared config (falls back to defaults)', () => {
    expect(decodeConfig('p=531&bp=0.3')).toEqual({});
    expect(decodeConfig('')).toEqual({});
  });

  it('ignores malformed parameters but keeps the well-formed ones', () => {
    const decoded = decodeConfig('v=1&p=531&bp=notanumber&g=9.81&nh=oops&oc=maybe&cy=zzz');
    expect(decoded.pattern).toBe('531');
    expect(decoded.gravity).toBeCloseTo(9.81, 4);
    expect(decoded.beatPeriod).toBeUndefined();
    expect(decoded.handCount).toBeUndefined();
    expect(decoded.orbitColoring).toBeUndefined();
    expect(decoded.carryPathKind).toBeUndefined();
  });

  it('drops a hand-point list with an odd token count', () => {
    expect(decodeConfig('v=1&tp=0.1,0.2,0.3').handThrowPoints).toBeUndefined();
    expect(decodeConfig('v=1&tp=0.1,0.2').handThrowPoints).toEqual([{ x: 0.1, z: 0.2 }]);
  });

  it('drops a non-hex ball color', () => {
    expect(decodeConfig('v=1&bc=nothex').ballColor).toBeUndefined();
    expect(decodeConfig('v=1&bc=2f6fed').ballColor).toBe('#2f6fed');
  });

  it('reads the optional t= playhead bookmark (absent = undefined, clamped ≥ 0)', () => {
    expect(decodeConfig('v=1&t=5.321').time).toBeCloseTo(5.321, 3);
    expect(decodeConfig('v=1&p=531').time).toBeUndefined();
    expect(decodeConfig('v=1&t=-4').time).toBe(0); // negative times clamp to 0
    expect(decodeConfig('v=1&t=notanumber').time).toBeUndefined();
  });

  it('never throws on arbitrary versioned junk', () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        expect(() => decodeConfig(`v=1&${junk}`)).not.toThrow();
      }),
    );
  });
});

describe('isShareConfigLike (JSON import guard)', () => {
  it('accepts a real config and rejects malformed objects', () => {
    expect(isShareConfigLike(sampleConfig())).toBe(true);
    expect(isShareConfigLike(null)).toBe(false);
    expect(isShareConfigLike({})).toBe(false);
    expect(isShareConfigLike({ ...sampleConfig(), beatPeriod: 'fast' })).toBe(false);
    expect(isShareConfigLike({ ...sampleConfig(), camera: { position: [0, 0], target: [0, 0, 0] } })).toBe(
      false,
    );
  });
});

function sampleConfig(): ShareConfig {
  return {
    pattern: '531',
    beatPeriod: 0.25,
    dwellTime: 0.3,
    playbackSpeed: 1,
    gravity: 9.81,
    holdDepth: 0.1,
    carryPathKind: 'quintic',
    handCount: 2,
    handPreset: 'line',
    handThrowPoints: [
      { x: 0.1, z: 0 },
      { x: -0.1, z: 0 },
    ],
    handCatchPoints: [
      { x: 0.3, z: 0 },
      { x: -0.3, z: 0 },
    ],
    ballRadius: 0.035,
    ballColor: '#2f6fed',
    orbitColoring: false,
    showHands: true,
    showHandPaths: false,
    timelineWindow: 3,
    trailLength: 0.8,
    ghostsEnabled: true,
    chartsVisible: true,
    chartAxisMode: 'magnitude',
    graphMaxHeight: 7,
    graphVisible: true,
    graphMinimap: true,
    audioEnabled: false,
    catchTickEnabled: true,
    audioVolume: 0.5,
    camera: { position: [0, 1.35, 3.2], target: [0, 1.35, 0] },
  };
}

// --- Hand-workspace codec (owner feature 2026-07-11; orchestrator ruling 4) -----

describe('workspace codec', () => {
  const primitiveKinds = ['sphere', 'cube', 'tetra'] as const;
  const scaleArb = fc.record({
    x: fc.double({ min: 0.1, max: 2, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: 0.1, max: 2, noNaN: true, noDefaultInfinity: true }),
    z: fc.double({ min: 0.1, max: 2, noNaN: true, noDefaultInfinity: true }),
  });

  it('primitives round-trip (kind, scale to 4 dp, enabled) exactly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...primitiveKinds),
        scaleArb,
        fc.boolean(),
        (kind, scale, enabled) => {
          const config: ShareConfig = { ...sampleConfig(), workspace: { kind, scale, enabled } };
          const decoded = decodeConfig(encodeConfig(config));
          expect(decoded.workspace?.kind).toBe(kind);
          expect(decoded.workspace?.enabled).toBe(enabled);
          expect(decoded.workspace?.scale.x).toBeCloseTo(scale.x, 4);
          expect(decoded.workspace?.scale.y).toBeCloseTo(scale.y, 4);
          expect(decoded.workspace?.scale.z).toBeCloseTo(scale.z, 4);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('an absent workspace stays absent (backward compatible)', () => {
    const decoded = decodeConfig(encodeConfig(sampleConfig()));
    expect(decoded.workspace).toBeUndefined();
  });

  it('an STL workspace degrades to disabled on reload (geometry never travels)', () => {
    const config: ShareConfig = {
      ...sampleConfig(),
      workspace: { kind: 'stl', scale: { x: 0.5, y: 0.6, z: 0.7 }, enabled: true },
    };
    const decoded = decodeConfig(encodeConfig(config));
    expect(decoded.workspace?.kind).toBe('stl');
    expect(decoded.workspace?.enabled).toBe(false); // forced off — mesh cannot travel
    expect(decoded.workspace?.scale.y).toBeCloseTo(0.6, 4);
  });

  it('isShareConfigLike accepts a valid workspace and rejects a malformed one', () => {
    expect(
      isShareConfigLike({ ...sampleConfig(), workspace: { kind: 'cube', scale: { x: 1, y: 1, z: 1 }, enabled: true } }),
    ).toBe(true);
    // Absent workspace is fine (optional).
    expect(isShareConfigLike(sampleConfig())).toBe(true);
    // Bad kind / non-numeric scale are rejected.
    expect(
      isShareConfigLike({ ...sampleConfig(), workspace: { kind: 'blob', scale: { x: 1, y: 1, z: 1 }, enabled: true } }),
    ).toBe(false);
    expect(
      isShareConfigLike({ ...sampleConfig(), workspace: { kind: 'sphere', scale: { x: 'big', y: 1, z: 1 }, enabled: true } }),
    ).toBe(false);
  });
});

// --- Bottom-dock tri-state codec (owner round-2 #1; orchestrator ruling 2026-07-11) ---

describe('dock-mode codec (tri-state, backward compatible)', () => {
  it('round-trips each dockMode via the `dm` key', () => {
    for (const dockMode of ['none', 'charts', 'explorer'] as const) {
      const decoded = decodeConfig(encodeConfig({ ...sampleConfig(), dockMode }));
      expect(decoded.dockMode).toBe(dockMode);
    }
  });

  it('an old `cv`-only link (no `dm`) derives the equivalent dockMode at decode', () => {
    // Legacy link: encodes cv but not dm. The decode must derive dockMode itself —
    // the boot path merges the decoded partial over currentConfig(), which always
    // carries a concrete dockMode, so a downstream fallback could never fire
    // (round-3 wave-2b review finding: cv-only links opened with charts hidden).
    const decodedOn = decodeConfig('v=1&cv=1');
    expect(decodedOn.chartsVisible).toBe(true);
    expect(decodedOn.dockMode).toBe('charts');
    const decodedOff = decodeConfig('v=1&cv=0');
    expect(decodedOff.chartsVisible).toBe(false);
    expect(decodedOff.dockMode).toBe('none');
    // No cv at all: nothing to derive from.
    expect(decodeConfig('v=1').dockMode).toBeUndefined();
  });

  it('a malformed `dm` is ignored (graceful degradation)', () => {
    expect(decodeConfig('v=1&dm=zzz').dockMode).toBeUndefined();
  });

  it('isShareConfigLike accepts a valid dockMode and rejects a bad one', () => {
    expect(isShareConfigLike({ ...sampleConfig(), dockMode: 'explorer' })).toBe(true);
    expect(isShareConfigLike(sampleConfig())).toBe(true); // absent is fine (optional)
    expect(isShareConfigLike({ ...sampleConfig(), dockMode: 'sidebar' })).toBe(false);
  });
});
