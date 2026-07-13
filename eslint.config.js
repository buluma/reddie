const js = require('@eslint/js');
const globals = require('globals');

// Flat config. Three source contexts share this repo with no build step:
// the Electron main/preload side (CommonJS, Node globals), the renderer/
// popover side (browser globals, scripts loaded via <script> so they share
// one global scope), and the Vitest test files. Vendored libraries and
// build output are never linted.
module.exports = [
  {
    ignores: ['src/vendor/**', 'dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    // Electron main process and its Node-side helpers (CommonJS).
    files: ['src/main.js', 'src/preload.js', 'src/tray-preload.js', 'src/config-store.js', 'src/redmine-client.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // This codebase deliberately swallows certain errors with a commented
      // empty catch (invalid tray image, unsupported setBadgeCount platform,
      // etc.) - an unused catch binding there is intentional, not a mistake.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    // Renderer-side scripts. They're loaded as plain <script> tags into one
    // shared window scope, so a symbol defined in urgency.js (reddieUrgency)
    // or exposed on window in one file is legitimately referenced from
    // another - declare those cross-file globals so no-undef doesn't trip.
    files: ['src/renderer.js', 'src/tray-popover.js', 'src/urgency.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Vendored libs loaded before renderer.js (see index.html).
        Sortable: 'readonly',
        marked: 'readonly',
        DOMPurify: 'readonly',
        // src/urgency.js's global export, consumed by renderer.js.
        reddieUrgency: 'readonly',
        // Preload bridges (contextBridge.exposeInMainWorld).
        trayAPI: 'readonly',
        module: 'writable',
      },
    },
    rules: {
      // The renderer exposes many handlers only through inline onclick= in
      // index.html (and window.foo = foo), which ESLint can't see as uses -
      // don't fail the build on those. Real dead locals still surface as
      // warnings; intentional empty catches (see the main-process note) are
      // allowed the same way.
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/__tests__/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
