import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// --- Core-boundary messages (DESIGN.md §2, CLAUDE.md hard rule 1) ---
const NO_PKG =
  'src/core/** must stay pure: no React/three/zustand imports. The dependency direction is ui/render3d -> state -> core (DESIGN.md §2).';
const NO_LAYER =
  'src/core/** may not import from state/ui/render3d. The dependency direction is ui/render3d -> state -> core (DESIGN.md §2).';
const NO_TIME =
  'src/core/** must be deterministic: no Date.now / Math.random / performance. Time is always a function argument (CLAUDE.md hard rule 1).';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Application + test sources run in the browser / jsdom.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Config and plain-JS files run in Node.
  {
    files: ['**/*.{js,cjs,mjs}', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // The core boundary. This block is the load-bearing lint rule; it must fail
  // on any cross-layer import or non-deterministic call inside src/core/**.
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: NO_PKG },
            { name: 'react-dom', message: NO_PKG },
            { name: 'three', message: NO_PKG },
            { name: 'zustand', message: NO_PKG },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', 'three/*', 'zustand/*', '@react-three/*'],
              message: NO_PKG,
            },
            {
              group: [
                '**/state',
                '**/state/**',
                '**/ui',
                '**/ui/**',
                '**/render3d',
                '**/render3d/**',
              ],
              message: NO_LAYER,
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: NO_TIME },
        { object: 'Math', property: 'random', message: NO_TIME },
        { object: 'performance', property: 'now', message: NO_TIME },
      ],
      'no-restricted-globals': ['error', { name: 'performance', message: NO_TIME }],
    },
  },

  // Keep ESLint out of Prettier's way (formatting is Prettier's job).
  prettier,
);
