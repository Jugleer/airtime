import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the static SPA works when hosted under a repo subpath
// (GitHub Pages project site, Phase 9). No backend, no external requests.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // Default to Node for fast pure-core tests; UI tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock (see src/ui/App.test.tsx).
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // The property-test value lives in core/ (PLAN.md P1/P2 coverage gates).
      include: ['src/core/**'],
      reportsDirectory: './coverage',
    },
  },
});
