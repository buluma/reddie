const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

// Returns the main board window (index.html), waiting for it to appear -
// distinct from the hidden tray popover window the app also opens.
async function getMainWindow(app) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const match = app.windows().find((w) => w.url().includes('index.html'));
    if (match) return match;
    await app.waitForEvent('window').catch(() => {});
  }
  throw new Error('main window (index.html) never appeared');
}

// End-to-end smoke test: launch the actual Electron app the way a user would
// (main process boots, creates the window, preload bridges IPC, renderer.js
// paints the board) and assert it comes up healthy. This exercises the whole
// main<->preload<->renderer wiring that the unit tests can't reach - a broken
// preload bridge, a renderer script error, or a missing IPC handler would
// leave the board empty and fail here.
//
// No Redmine credentials are needed: with no API key the main process skips
// connect() and the renderer still renders its empty board shell, so the
// test is hermetic and safe to run in CI.
test.describe('app launch', () => {
  let app;
  let page;
  const pageErrors = [];

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [path.join(__dirname, '..')],
      // Force the no-credentials path so the test never depends on a
      // developer's local .env pointing at a live instance.
      env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' },
    });
    // The app opens two BrowserWindows - the main board (index.html) and the
    // hidden tray popover (tray-popover.html) - and both carry the title
    // "Reddie", so firstWindow() would non-deterministically hand back
    // whichever raced to open first. Select the main window by URL instead.
    page = await getMainWindow(app);
    // Attach before waiting on load so a boot-time renderer error is caught.
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('opens a window titled Reddie', async () => {
    expect(await page.title()).toBe('Reddie');
  });

  test('renders all four board columns', async () => {
    for (const id of ['backlog', 'todo', 'in-progress', 'done']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test('exposes the preload IPC bridge to the renderer', async () => {
    // If preload.js failed to load or contextBridge broke, window.reddieAPI
    // would be undefined and every renderer action would throw.
    const hasBridge = await page.evaluate(() => typeof window.reddieAPI === 'object' && window.reddieAPI !== null);
    expect(hasBridge).toBe(true);
  });

  test('loads the pure urgency module into the renderer scope', async () => {
    const hasUrgency = await page.evaluate(
      () => typeof window.reddieUrgency === 'object' && typeof window.reddieUrgency.classifyTrayUrgency === 'function',
    );
    expect(hasUrgency).toBe(true);
  });

  test('does not surface a renderer console error on boot', async () => {
    expect(pageErrors).toEqual([]);
  });
});
