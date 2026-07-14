// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { NARROW_QUERY, useIsNarrow } from './useIsNarrow';

interface MatchMediaMock {
  setMatches(next: boolean): void;
  /** The query string the most recent matchMedia() call was made with. */
  lastQuery(): string | undefined;
}

/** A minimal, controllable matchMedia mock: reports `matches` and fires `change`. */
function installMatchMedia(initialMatches: boolean): MatchMediaMock {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initialMatches;
  let query: string | undefined;
  const mql = {
    get matches() {
      return matches;
    },
    media: '',
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
  };
  window.matchMedia = ((q: string) => {
    query = q;
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) {
        cb({ matches: next } as MediaQueryListEvent);
      }
    },
    lastQuery: () => query,
  };
}

afterEach(() => {
  // Remove the mock so other suites see jsdom's default (undefined matchMedia).
  // @ts-expect-error deliberately clearing the mock between tests
  delete window.matchMedia;
  vi.restoreAllMocks();
});

describe('useIsNarrow', () => {
  it('returns false when matchMedia is undefined (jsdom / tests default)', () => {
    // jsdom does not implement matchMedia; ensure the guard reports "not narrow".
    // @ts-expect-error ensure it is absent for this case
    delete window.matchMedia;
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
  });

  it('reflects the initial match and the query string it subscribes to', () => {
    const mock = installMatchMedia(true);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(true);
    expect(mock.lastQuery()).toBe(NARROW_QUERY);
  });

  it('updates when the media query changes', () => {
    const mock = installMatchMedia(false);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
    act(() => mock.setMatches(true));
    expect(result.current).toBe(true);
    act(() => mock.setMatches(false));
    expect(result.current).toBe(false);
  });
});
