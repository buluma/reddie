const { defineConfig } = require('@playwright/test');

// e2e drives the real packaged-shape Electron app (main + preload + renderer
// over IPC), which the vitest suite deliberately doesn't touch - it only
// covers the pure logic. Kept in its own dir so `vitest run` and
// `playwright test` never try to pick up each other's files.
module.exports = defineConfig({
  testDir: './e2e',
  // The app makes no external network calls at startup without an API key,
  // but launching Electron + loading the renderer is still slower than a
  // unit test - give it room without hanging CI forever.
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
});
