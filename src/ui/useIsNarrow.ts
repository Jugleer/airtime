// src/ui/useIsNarrow — a viewport-width media-query hook that drives the mobile
// (portrait, scene-first, tabbed) shell (round 9). True when the viewport is a
// phone-width column (≤ NARROW_MAX_PX); the desktop grid is used otherwise.
//
// GUARDED for jsdom / SSR exactly like the ResizeObserver guards in the shell: when
// `window.matchMedia` is undefined (the test environment, and very old engines) the
// hook reports `false`, so the existing tests — and any non-DOM render — see the
// UNCHANGED desktop layout. A dedicated mobile test injects a matchMedia mock.

import { useEffect, useState } from 'react';

/** The breakpoint (inclusive) below which the mobile shell renders. */
export const NARROW_MAX_PX = 760;
export const NARROW_QUERY = `(max-width: ${NARROW_MAX_PX}px)`;

/** Read the current match, guarded so a missing matchMedia is simply "not narrow". */
function readMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(NARROW_QUERY).matches;
}

/**
 * `true` while the viewport is phone-narrow (≤ {@link NARROW_MAX_PX} px), subscribing
 * to viewport changes via matchMedia's `change` event. Returns `false` whenever
 * `window.matchMedia` is unavailable (jsdom/tests), so those callers keep the desktop
 * layout untouched.
 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState<boolean>(readMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    // Sync once on mount in case the viewport changed between the initial read and
    // the subscription (e.g. a hydration/resize race).
    setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
