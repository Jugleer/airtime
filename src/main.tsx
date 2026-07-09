import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useAppStore } from './state';
import { decodeConfig } from './state/codec';

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
