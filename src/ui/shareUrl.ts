// src/ui/shareUrl — the single source of truth for the "share this scene" URL
// recipe. Both SharePanel's Copy button and the top-bar Report-a-Bug reproduction
// link build the versioned link the SAME way: origin + pathname + the codec's
// encoded query. Rebuilding fresh from the LIVE store config (never
// window.location.href, which is only synced when the user clicks Copy and
// otherwise goes stale) keeps the two call sites in lockstep.

import { useAppStore } from '../state';
import { encodeConfig, type ShareConfig } from '../state/codec';

/** Build the versioned share URL for a config: origin + pathname + encoded query. */
export function shareUrlFor(config: ShareConfig): string {
  const query = encodeConfig(config);
  const base =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : '';
  return `${base}?${query}`;
}

/**
 * Rebuild the share URL from the store's CURRENT config, sampled at CALL time.
 * Call this inside a click/interaction handler so the link reflects the state at
 * the moment of the click (camera, sliders, playhead) — not whenever a component
 * last rendered.
 */
export function currentShareUrl(): string {
  return shareUrlFor(useAppStore.getState().currentConfig());
}
