import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deletePresetFrom,
  loadPresetFrom,
  presetNamesOf,
  readPresetMap,
  savePresetTo,
  writePresetMap,
  type PresetMap,
} from './presets';
import type { ShareConfig } from './codec';

/** A minimal in-memory Storage (the localStorage surface the presets use). */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

function config(pattern: string): ShareConfig {
  return {
    pattern,
    beatPeriod: 0.25,
    dwellTime: 0.3,
    playbackSpeed: 1,
    gravity: 9.81,
    holdDepth: 0.1,
    carryPathKind: 'quintic',
    handCount: 2,
    handPreset: 'line',
    handThrowPoints: [{ x: 0.1, z: 0 }],
    handCatchPoints: [{ x: 0.3, z: 0 }],
    ballRadius: 0.035,
    ballColor: '#2f6fed',
    orbitColoring: false,
    timelineWindow: 3,
    trailLength: 0.8,
    ghostsEnabled: true,
    chartsVisible: true,
    chartAxisMode: 'magnitude',
    graphMaxHeight: 7,
    graphVisible: true,
    audioEnabled: false,
    catchTickEnabled: true,
    audioVolume: 0.5,
    camera: { position: [0, 1.35, 3.2], target: [0, 1.35, 0] },
  };
}

describe('preset storage (pure, over an injected Storage)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('saves, lists, loads, and deletes named presets', () => {
    expect(presetNamesOf(readPresetMap(storage))).toEqual([]);

    const namesAfterSave = savePresetTo(storage, 'my 531', config('531'));
    expect(namesAfterSave).toEqual(['my 531']);
    expect(loadPresetFrom(storage, 'my 531')?.pattern).toBe('531');

    savePresetTo(storage, 'a cascade', config('3'));
    expect(presetNamesOf(readPresetMap(storage))).toEqual(['a cascade', 'my 531']); // sorted

    const namesAfterDelete = deletePresetFrom(storage, 'my 531');
    expect(namesAfterDelete).toEqual(['a cascade']);
    expect(loadPresetFrom(storage, 'my 531')).toBeNull();
  });

  it('overwrites a preset of the same name', () => {
    savePresetTo(storage, 'slot', config('3'));
    savePresetTo(storage, 'slot', config('441'));
    expect(presetNamesOf(readPresetMap(storage))).toEqual(['slot']);
    expect(loadPresetFrom(storage, 'slot')?.pattern).toBe('441');
  });

  it('rejects a blank preset name', () => {
    expect(savePresetTo(storage, '   ', config('3'))).toBeNull();
    expect(presetNamesOf(readPresetMap(storage))).toEqual([]);
  });

  it('degrades to no-ops when storage is unavailable (null)', () => {
    expect(readPresetMap(null)).toEqual({});
    expect(savePresetTo(null, 'x', config('3'))).toBeNull();
    expect(deletePresetFrom(null, 'x')).toBeNull();
    expect(loadPresetFrom(null, 'x')).toBeNull();
    expect(writePresetMap(null, {} as PresetMap)).toBe(false);
  });

  it('returns an empty map on corrupt stored JSON (never throws)', () => {
    storage.setItem('airtime.presets.v1', '{not json');
    expect(readPresetMap(storage)).toEqual({});
  });
});

describe('store preset actions (over a mock ambient localStorage)', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let mock: Storage;

  beforeEach(() => {
    mock = makeStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mock,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('savePreset / loadPreset / deletePreset drive the store + storage', async () => {
    const { useAppStore } = await import('./index');
    useAppStore.getState().setPattern('531');
    useAppStore.getState().savePreset('box');
    expect(useAppStore.getState().presetNames).toContain('box');
    expect(mock.getItem('airtime.presets.v1')).toContain('531');

    // Change the running pattern, then load the preset back.
    useAppStore.getState().setPattern('3');
    expect(useAppStore.getState().sim.patternText).toBe('3');
    useAppStore.getState().loadPreset('box');
    expect(useAppStore.getState().sim.patternText).toBe('531');

    useAppStore.getState().deletePreset('box');
    expect(useAppStore.getState().presetNames).not.toContain('box');
  });
});
