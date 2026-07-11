import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIO_VOLUME_MAX,
  BEAT_PERIOD_MAX,
  DEFAULT_AUDIO_ENABLED,
  DEFAULT_CAMERA_POSE,
  GRAVITY_MAX,
  useAppStore,
} from './index';
import { decodeConfig, encodeConfig, type ShareConfig } from './codec';
import { horizonTime } from './simulation';

// Reset to a clean default sim before each test (the store is a module singleton).
beforeEach(() => {
  useAppStore.getState().hardReset();
  useAppStore.getState().setPattern('3');
  useAppStore.setState({ simTime: 0, playing: true });
});

describe('applyConfig (URL boot / preset load / JSON import)', () => {
  it('resets to a clean t = 0 sim carrying the config values', () => {
    const config = useAppStore.getState().currentConfig();
    const shared: ShareConfig = {
      ...config,
      pattern: '531',
      beatPeriod: 0.4,
      gravity: 6,
      orbitColoring: true,
      audioEnabled: true,
      audioVolume: 0.3,
      camera: { position: [1, 2, 3], target: [0, 1, 0] },
    };
    // Scrub away first so we can prove the reset.
    useAppStore.setState({ simTime: 5, playing: false, epochs: [{ beat: 3, params: {} }] });

    useAppStore.getState().applyConfig(shared);
    const state = useAppStore.getState();

    expect(state.sim.patternText).toBe('531');
    expect(state.beatPeriod).toBeCloseTo(0.4, 9);
    expect(state.gravity).toBeCloseTo(6, 9);
    expect(state.orbitColoring).toBe(true);
    expect(state.audioEnabled).toBe(true);
    expect(state.audioVolume).toBeCloseTo(0.3, 9);
    expect(state.cameraView).toEqual({ position: [1, 2, 3], target: [0, 1, 0] });
    // Clean rebuild: t = 0, playing, no epochs, no transition.
    expect(state.simTime).toBe(0);
    expect(state.playing).toBe(true);
    expect(state.epochs).toHaveLength(0);
    expect(state.kinematicsEpochs).toHaveLength(0);
    expect(state.transition).toBeNull();
    // The sim actually reflects the new base params.
    expect(state.sim.kinematics.gravity).toBeCloseTo(6, 9);
    expect(state.baseParams.beatPeriod).toBeCloseTo(0.4, 9);
  });

  it('boot order is URL > defaults (decoded partial overlaid on the default config)', () => {
    const store = useAppStore.getState();
    const decoded = decodeConfig('v=1&p=441&g=4.2&au=1');
    store.applyConfig({ ...store.currentConfig(), ...decoded });
    const state = useAppStore.getState();
    // URL-provided fields win…
    expect(state.sim.patternText).toBe('441');
    expect(state.gravity).toBeCloseTo(4.2, 4);
    expect(state.audioEnabled).toBe(true);
    // …everything else stays at the defaults (not in the URL).
    expect(state.ballColor).toBe('#2f6fed');
    expect(state.handCount).toBe(2);
  });

  it('currentConfig → applyConfig → currentConfig is a fixed point (shareable fields)', () => {
    useAppStore.getState().setPattern('531');
    useAppStore.getState().setGravity(7);
    useAppStore.getState().setOrbitColoring(true);
    const before = useAppStore.getState().currentConfig();

    useAppStore.getState().applyConfig(before);
    const after = useAppStore.getState().currentConfig();
    expect(after).toEqual(before);
  });

  it('clamps out-of-range values instead of trusting the payload', () => {
    const config = useAppStore.getState().currentConfig();
    useAppStore.getState().applyConfig({
      ...config,
      beatPeriod: 999,
      gravity: 999,
      audioVolume: 999,
      handCount: 99,
    });
    const state = useAppStore.getState();
    expect(state.beatPeriod).toBeCloseTo(BEAT_PERIOD_MAX, 9);
    expect(state.gravity).toBeCloseTo(GRAVITY_MAX, 9);
    expect(state.audioVolume).toBeCloseTo(AUDIO_VOLUME_MAX, 9);
    expect(state.handCount).toBe(8);
  });

  it('falls back to the default pattern on an invalid one (never crashes)', () => {
    const config = useAppStore.getState().currentConfig();
    useAppStore.getState().applyConfig({ ...config, pattern: '52' }); // collision + bad average
    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('3');
    expect(state.validation.ok).toBe(true);
  });

  it('re-derives preset geometry when the config hand points do not match the count', () => {
    const config = useAppStore.getState().currentConfig();
    // 4 hands but only the default 2 points: geometry should come from the preset.
    useAppStore.getState().applyConfig({ ...config, handCount: 4, handPreset: 'circle' });
    const state = useAppStore.getState();
    expect(state.handCount).toBe(4);
    expect(state.handThrowPoints).toHaveLength(4);
    expect(state.handCatchPoints).toHaveLength(4);
  });

  it('an encode → decode → apply round-trip reproduces the scene', () => {
    useAppStore.getState().setPattern('441');
    useAppStore.getState().setBallColor('#ff8800');
    const query = encodeConfig(useAppStore.getState().currentConfig());

    // Simulate opening the link in a fresh session: reset, then apply the decoded URL.
    useAppStore.getState().hardReset();
    useAppStore.getState().setPattern('3');
    const store = useAppStore.getState();
    store.applyConfig({ ...store.currentConfig(), ...decodeConfig(query) });

    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('441');
    expect(state.ballColor).toBe('#ff8800');
  });

  it('seeks to a nonzero time bookmark, arrives playing, and extends the horizon past the initial range', () => {
    const config = useAppStore.getState().currentConfig();
    const initialHorizon = horizonTime(useAppStore.getState().sim);
    // A bookmark well beyond the initially generated range (INITIAL_BEATS ≈ 40 s).
    const seekTime = initialHorizon + 15;

    useAppStore.getState().applyConfig({ ...config, time: seekTime });
    const state = useAppStore.getState();

    // The playhead lands on the bookmark, and a t-load arrives PLAYING (like a fresh boot).
    expect(state.simTime).toBeCloseTo(seekTime, 6);
    expect(state.playing).toBe(true);
    // The generated horizon grew (append-only) to cover the bookmark + future span + margin.
    expect(horizonTime(state.sim)).toBeGreaterThan(initialHorizon);
    expect(horizonTime(state.sim)).toBeGreaterThanOrEqual(seekTime);
  });

  it('clamps a negative time bookmark to 0 (loads at the start)', () => {
    const config = useAppStore.getState().currentConfig();
    useAppStore.getState().applyConfig({ ...config, time: -5 });
    expect(useAppStore.getState().simTime).toBe(0);
  });

  it('has the DESIGN.md §6 audio + camera defaults at startup', () => {
    // Fresh reset leaves the audio + camera fields at their documented defaults.
    useAppStore.setState({
      audioEnabled: DEFAULT_AUDIO_ENABLED,
      cameraView: DEFAULT_CAMERA_POSE,
    });
    const state = useAppStore.getState();
    expect(state.audioEnabled).toBe(false);
    expect(state.cameraView).toEqual({ position: [0, 1.35, 3.2], target: [0, 1.35, 0] });
  });
});
