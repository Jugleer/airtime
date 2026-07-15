// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../state';
import { setCaptureRoot, type CaptureRootState } from '../render3d/captureBridge';
import { DEFAULT_EXPORT_OPTIONS } from './types';
import { ExportError, runExport } from './capture';

afterEach(() => {
  setCaptureRoot(null);
  vi.restoreAllMocks();
  useAppStore.getState().hardReset();
});

describe('runExport (guards without a live scene)', () => {
  it('rejects with ExportError when no capture root is registered', async () => {
    const before = useAppStore.getState().playing;
    await expect(
      runExport(DEFAULT_EXPORT_OPTIONS, () => {}, { cancelled: false }),
    ).rejects.toBeInstanceOf(ExportError);
    // It bails before touching any clock/playing state.
    expect(useAppStore.getState().playing).toBe(before);
  });
});

// A minimal structurally-compatible capture root: the export loop only calls
// advance / setFrameloop and reads gl.domElement's size + the camera setters, all
// no-ops here (we assert on the horizon it leaves behind, not on pixels).
function makeMockRoot(): CaptureRootState {
  const camera = {
    position: { set() {} },
    lookAt() {},
    updateMatrixWorld() {},
  };
  const gl = {
    domElement: { clientWidth: 64, clientHeight: 64, width: 64, height: 64 },
    render() {},
  };
  return {
    gl,
    scene: {},
    camera,
    advance() {},
    setFrameloop() {},
    frameloop: 'always',
  } as unknown as CaptureRootState;
}

/**
 * Drive the append-only horizon far past the playhead, then park the clock back at
 * t = 0 (setSimTime never shrinks — the exact ratchet the export seeks trip). The
 * returned pair is the minimal beatCount for t = 0 and the inflated one; a correct
 * restore must trim the inflated tail back to the minimal.
 */
function inflateHorizonAtStart(): { minimalBeats: number; inflatedBeats: number } {
  const minimalBeats = useAppStore.getState().sim.beatCount;
  useAppStore.getState().setSimTime(100);
  const inflatedBeats = useAppStore.getState().sim.beatCount;
  useAppStore.getState().setSimTime(0);
  // Parked back at t = 0 with the horizon still generated out to ~100 s.
  expect(useAppStore.getState().sim.beatCount).toBe(inflatedBeats);
  expect(inflatedBeats).toBeGreaterThan(minimalBeats);
  return { minimalBeats, inflatedBeats };
}

describe('runExport horizon hygiene (memory fix #4)', () => {
  it('trims the inflated horizon back to minimal after a completed export', async () => {
    const root = makeMockRoot();
    setCaptureRoot(() => root);
    // A working 2D context so the GIF path runs to completion.
    const ctx2d = {
      clearRect() {},
      drawImage() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4) };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx2d as unknown as CanvasRenderingContext2D,
    );

    const { minimalBeats, inflatedBeats } = inflateHorizonAtStart();

    const result = await runExport(DEFAULT_EXPORT_OPTIONS, () => {}, { cancelled: false });
    expect(result.frameCount).toBeGreaterThan(0);

    // The forward reach the export generated is released; the horizon is back to the
    // minimum for the playhead (t = 0), not the inflated Pass-2 value.
    const after = useAppStore.getState();
    expect(after.simTime).toBe(0);
    expect(after.sim.beatCount).toBe(minimalBeats);
    expect(after.sim.beatCount).toBeLessThan(inflatedBeats);
  });

  it('clears the export floor pin after a completed export (memory fix #1)', async () => {
    const root = makeMockRoot();
    setCaptureRoot(() => root);
    const ctx2d = {
      clearRect() {},
      drawImage() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4) };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx2d as unknown as CanvasRenderingContext2D,
    );
    expect(useAppStore.getState().exportFloorPin).toBeNull();
    await runExport(DEFAULT_EXPORT_OPTIONS, () => {}, { cancelled: false });
    // The pin is set/cleared only inside runExport; it must not leak past it.
    expect(useAppStore.getState().exportFloorPin).toBeNull();
  });

  it('clears the export floor pin on an early bail (memory fix #1)', async () => {
    const root = makeMockRoot();
    setCaptureRoot(() => root);
    // jsdom's getContext('2d') yields null → the ctx-null early bail clears the pin.
    await expect(
      runExport(DEFAULT_EXPORT_OPTIONS, () => {}, { cancelled: false }),
    ).rejects.toBeInstanceOf(ExportError);
    expect(useAppStore.getState().exportFloorPin).toBeNull();
  });

  it('trims the inflated horizon on an early bail (no 2D context)', async () => {
    const root = makeMockRoot();
    setCaptureRoot(() => root);
    // jsdom's getContext('2d') yields null → the ctx-null early bail (capture.ts).
    const { minimalBeats, inflatedBeats } = inflateHorizonAtStart();

    await expect(
      runExport(DEFAULT_EXPORT_OPTIONS, () => {}, { cancelled: false }),
    ).rejects.toBeInstanceOf(ExportError);

    const after = useAppStore.getState();
    expect(after.simTime).toBe(0);
    expect(after.sim.beatCount).toBe(minimalBeats);
    expect(after.sim.beatCount).toBeLessThan(inflatedBeats);
  });
});
