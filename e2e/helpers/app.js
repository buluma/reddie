const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect, _electron: electron } = require('@playwright/test');

// One launch path for source and packaged smoke checks. Every owned profile
// is temporary, and failures during launch clean up just like normal teardown.
async function launchTestApp({ userData, env = {}, onPage = () => {} } = {}) {
  const ownsProfile = !userData;
  userData ||= fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-e2e-'));
  const executablePath = process.env.REDDIE_E2E_EXECUTABLE;
  let app;
  async function close() {
    try { await app?.close(); } finally {
      if (ownsProfile) fs.rmSync(userData, { recursive: true, force: true });
    }
  }
  try {
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : [path.join(__dirname, '..', '..')]), `--user-data-dir=${userData}`],
      env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '', ...env },
    });
    await expect.poll(() => app.windows().some(window => window.url().includes('index.html')), { timeout: 10000 }).toBe(true);
    const page = app.windows().find(window => window.url().includes('index.html'));
    onPage(page);
    await page.waitForLoadState('domcontentloaded');
    return { app, page, userData, close };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { launchTestApp };
