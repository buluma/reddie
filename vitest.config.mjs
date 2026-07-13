import { defineConfig } from 'vitest/config';

// Vitest owns the pure-logic unit suite under src/__tests__; Playwright owns
// the Electron e2e suite under e2e/. Without this, vitest's default glob
// (**/*.{test,spec}.js) also sweeps up e2e/*.spec.js and dies on Playwright's
// test.describe() ("did not expect test.describe() to be called here").
// Pin discovery to the unit directory so the two runners never collide.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.js'],
  },
});
