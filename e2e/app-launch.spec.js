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

// Reads a window's CSP <meta> as { directive: [sources] }. Eval blocking
// can't be checked by behaviour here: while Playwright's DevTools session is
// attached, Chromium lets eval() through even from page scripts (Electron
// does block it without Playwright attached). So eval and plugins are
// asserted on the declared policy; connect-src gets a real runtime check.
async function cspDirectives(win) {
  const content = await win.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
  );
  return Object.fromEntries(
    content
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
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
  // Chromium reports CSP violations as console errors, not page errors.
  const cspViolations = [];

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
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
    });
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

  // RDD-25: both renderer pages carry a CSP. Inline handlers are still
  // allowed ('unsafe-inline', the window.foo/onclick convention), but eval
  // and renderer-side network requests are not - the renderer reaches
  // Redmine only through IPC, so connect-src 'none' costs nothing. See
  // cspDirectives() for why eval is checked on the declared policy.
  test('main window CSP disallows eval and plugins', async () => {
    const csp = await cspDirectives(page);
    expect(csp['script-src']).toBeDefined();
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    expect(csp['object-src']).toEqual(["'none'"]);
  });

  test('main window CSP blocks renderer network requests', async () => {
    const directive = await page.evaluate(
      () =>
        new Promise((resolve) => {
          document.addEventListener('securitypolicyviolation', (e) => resolve(e.effectiveDirective), { once: true });
          fetch('https://example.invalid/').catch(() => {});
          setTimeout(() => resolve(null), 2000);
        }),
    );
    expect(directive).toBe('connect-src');
  });

  test('inline onclick handlers still work under the CSP', async () => {
    await page.click('.settings-btn');
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.click('#settings-modal .close-btn');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
  });

  test('tray popover CSP disallows eval, plugins and network', async () => {
    const popover = app.windows().find((w) => w.url().includes('tray-popover.html'));
    expect(popover).toBeTruthy();
    const csp = await cspDirectives(popover);
    expect(csp['script-src']).toBeDefined();
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['connect-src']).toEqual(["'none'"]);
  });

  test('no CSP violations during boot or the checks above', async () => {
    // The connect-src probe above is a deliberate violation - ignore it.
    expect(cspViolations.filter((m) => !m.includes('example.invalid'))).toEqual([]);
  });
});
