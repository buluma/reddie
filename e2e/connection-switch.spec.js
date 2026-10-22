const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

test('connection switching validates first, guards timers, and scopes board data', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const key = req.headers['x-redmine-api-key'];
    if (key === 'bad') { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const payload = {
      '/users/current.json': { user: { id: key === 'second' ? 2 : 1, firstname: 'Test' } },
      '/issue_statuses.json': { issue_statuses: [{ id: 1, name: 'New' }] },
      '/enumerations/time_entry_activities.json': { time_entry_activities: [] },
      '/enumerations/issue_priorities.json': { issue_priorities: [] },
      '/issues.json': { issues: [], total_count: 0 },
    }[pathname] || {};
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-connection-'));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' } });
    await expect.poll(() => app.windows().some(w => w.url().includes('index.html'))).toBe(true);
    const page = app.windows().find(w => w.url().includes('index.html'));
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    // Dummy credentials only, in an isolated temporary profile. Avoid an OS
    // Keychain prompt from unsigned development Electron during this test.
    await app.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false; });
    async function save(key) {
      await page.locator('#redmine-base').fill(base);
      await page.locator('#redmine-api-key').fill(key);
      await page.evaluate(() => saveSettings());
    }
    await save('first');
    const first = await page.evaluate(() => window.reddieAPI.getConfig());
    expect(first.connectionScope).toBe(`${base}|1`);
    const firstKey = await page.evaluate(() => getStateKey());
    await page.evaluate(() => { addTask('todo'); cacheImageDataUrl('/private.png', 'data:image/png;base64,AA=='); });
    const rejected = await page.evaluate(base => window.reddieAPI.saveConfig({ redmineBaseUrl: base, redmineApiKey: 'bad' }), base);
    expect(rejected.error).toBeTruthy();
    expect((await page.evaluate(() => window.reddieAPI.getConfig())).redmineApiKey).toBe('first');
    await page.evaluate(() => window.reddieAPI.startTimer(42, 'Original account work'));
    const blocked = await page.evaluate(base => window.reddieAPI.saveConfig({ redmineBaseUrl: base, redmineApiKey: 'second' }), base);
    expect(blocked.error).toMatch(/active timer/);
    expect((await page.evaluate(() => window.reddieAPI.getTimerState())).ticketId).toBe(42);
    expect((await page.evaluate(() => window.reddieAPI.getConfig())).connectionScope).toBe(`${base}|1`);
    await page.evaluate(() => window.reddieAPI.cancelTimer());
    await page.locator('.settings-btn').click();
    await save('second');
    expect((await page.evaluate(() => window.reddieAPI.getConfig())).connectionScope).toBe(`${base}|2`);
    expect(await page.evaluate(() => getStateKey())).not.toBe(firstKey);
    await expect(page.locator('#todo-list .task-card')).toHaveCount(0);
    expect(await page.evaluate(() => imageDataUrlCache.size)).toBe(0);
    await page.locator('.settings-btn').click();
    await save('first');
    await expect(page.locator('#todo-list .task-card')).toHaveCount(1);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
