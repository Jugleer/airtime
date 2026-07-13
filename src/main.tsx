import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useAppStore } from './state';
import { decodeConfig } from './state/codec';
import { installThreeConsoleFilter } from './render3d/threeConsole';
import { initAnalytics } from './analytics/goatcounter';

// Filter r3f's one-time deprecated-THREE.Clock warning before any <Canvas> mounts
// (see render3d/threeConsole). Must run before the first render.
installThreeConsoleFilter();

// Cookieless GoatCounter visit beacon (owner round 8). No-op unless this is a
// production build AND a site code is configured (see src/analytics/goatcounter
// for the enable rule and the owner setup step) — so dev/test never beacons,
// and the app ships disabled-by-default. One count per full page load, which is
// exactly right for this single-page app (URL-query state; no path routes) —
// no per-query-edit or per-scrub recounting is wired.
initAnalytics();

// Boot order: URL > defaults (DESIGN.md §6, §7). The shared config is read ONCE
// here, before the first render, and applied over the store's defaults so the sim
// (and camera) start from the shared scene. A missing or malformed query yields an
// empty partial, so the app simply starts at the defaults — a bad URL never
// crashes (the decode is total; applyConfig clamps every field).
const shared = decodeConfig(window.location.search);
if (Object.keys(shared).length > 0) {
  const store = useAppStore.getState();
  // Overlay the decoded fields on a full default config (currentConfig at boot
  // reads the just-created default store), then apply the resolved config.
  store.applyConfig({ ...store.currentConfig(), ...shared });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
