import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../state';
import { DEFAULT_EXPORT_OPTIONS } from './types';
import { ExportError, runExport } from './capture';

afterEach(() => {
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
