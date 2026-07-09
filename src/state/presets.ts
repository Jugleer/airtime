// src/state/presets — named preset storage in localStorage (DESIGN.md §6).
//
// Presets are named saves of a {@link ShareConfig} (the same payload the URL codec
// and JSON export use). localStorage access is confined to the state layer
// (CLAUDE.md: core stays pure) and fully guarded: private-mode / disabled storage
// throws on access, so every call is wrapped and degrades to a no-op rather than
// crashing the app (DESIGN.md §6: "guard for unavailable localStorage").
//
// Pure over an injected Storage for testing (a mock is passed in the unit test);
// the store calls the convenience wrappers that resolve the ambient localStorage.

import type { ShareConfig } from './codec';

/** The localStorage key holding the whole `{ name: ShareConfig }` map (one JSON blob). */
export const PRESETS_STORAGE_KEY = 'airtime.presets.v1';

/** A name → config map, as persisted. */
export type PresetMap = Record<string, ShareConfig>;

/** The ambient localStorage, or null when it is unavailable (private mode, tests). */
export function getLocalStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) {
      return null;
    }
    // Touch it: some environments expose the object but throw on use.
    const probe = '__airtime_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Read + parse the preset map from a Storage; `{}` on any read/parse failure. */
export function readPresetMap(storage: Storage | null): PresetMap {
  if (storage === null) {
    return {};
  }
  try {
    const raw = storage.getItem(PRESETS_STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PresetMap;
  } catch {
    return {};
  }
}

/** Persist a preset map; returns false when storage is unavailable or write fails. */
export function writePresetMap(storage: Storage | null, map: PresetMap): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** Names of the stored presets, sorted for a stable UI list. */
export function presetNamesOf(map: PresetMap): string[] {
  return Object.keys(map).sort((a, b) => a.localeCompare(b));
}

/** Add/overwrite a preset in a Storage; returns the updated name list (or null on failure). */
export function savePresetTo(
  storage: Storage | null,
  name: string,
  config: ShareConfig,
): string[] | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return null;
  }
  const map = readPresetMap(storage);
  map[trimmed] = config;
  if (!writePresetMap(storage, map)) {
    return null;
  }
  return presetNamesOf(map);
}

/** Remove a preset from a Storage; returns the updated name list (or null on failure). */
export function deletePresetFrom(storage: Storage | null, name: string): string[] | null {
  if (storage === null) {
    return null;
  }
  const map = readPresetMap(storage);
  if (!(name in map)) {
    return presetNamesOf(map);
  }
  delete map[name];
  if (!writePresetMap(storage, map)) {
    return null;
  }
  return presetNamesOf(map);
}

/** Look up one stored preset's config, or null when absent. */
export function loadPresetFrom(storage: Storage | null, name: string): ShareConfig | null {
  const map = readPresetMap(storage);
  return map[name] ?? null;
}
