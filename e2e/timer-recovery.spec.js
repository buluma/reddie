const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { test, expect, _electron: electron } = require('@playwright/test');

async function getMainWindow(app) {
  await expect.poll(() => app.windows().find(window => window.url().includes('index.html')) || null).not.toBeNull();
  return app.windows().find(window => window.url().includes('index.html'));
}

test('restart offers paused recovery and never automatically submits time', async () => {
  const waiting = [];
  let ready = false;
  let writes = 0;
  const server = http.createServer((req, res) => {
    const answer = () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'GET') writes++;
      const route = new URL(req.url, 'http://localhost').pathname;
      res.end(JSON.stringify({
        '/users/current.json': { user: { id: 1 } },
        '/issue_statuses.json': { issue_statuses: [{ id: 1, name: 'New' }] },
        '/enumerations/time_entry_activities.json': { time_entry_activities: [] },
        '/enumerations/issue_priorities.json': { issue_priorities: [] },
        '/issues.json': { issues: [], total_count: 0 },
      }[route] || {}));
    };
    if (!ready && req.url.startsWith('/users/current.json')) waiting.push(answer);
    else answer();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-recovery-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ redmineBaseUrl: base, redmineApiKeyPlaintext: 'dummy' }));
  fs.writeFileSync(path.join(userData, 'timer.json'), JSON.stringify({
    version: 1, savedAt: 61000, connectionScope: `${base}|1`, submissionPending: false,
    state: { status: 'running', ticketId: 42, subject: 'Saved work', runningSince: 1000, elapsedMs: 0 },
  }));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' } });
    // Hold the connection probe until the native dialog has a controlled
    // responder. This exercises the actual startup recovery wiring.
    await app.evaluate(({ dialog }) => {
      global.recoveryDialogs = [];
      dialog.showMessageBox = async (window, options) => { global.recoveryDialogs.push(options); return { response: 0 }; };
    });
    ready = true;
    waiting.splice(0).forEach(answer => answer());
    await expect.poll(() => app.evaluate(() => global.recoveryDialogs.length)).toBe(1);
    await expect.poll(async () => {
      const page = app.windows().find(w => w.url().includes('index.html'));
      return page ? page.evaluate(() => window.reddieAPI.getTimerState()) : null;
    }).toEqual({ status: 'paused', ticketId: 42, subject: 'Saved work', elapsedMs: 60000, runningSince: null });
    expect(writes).toBe(0);
    const prompt = await app.evaluate(() => global.recoveryDialogs[0]);
    expect(prompt.buttons).toContain('Recover paused timer');
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'timer.json'), 'utf8'));
    expect(saved.state.status).toBe('paused');
    expect(saved.submissionPending).toBe(false);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('reading saved preferences can skip an unused encrypted credential', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-preferences-'));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' } });
    const result = await app.evaluate(({ app, safeStorage }) => {
      const require = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
      const fs = require('fs');
      const path = require('path');
      fs.writeFileSync(path.join(app.getPath('userData'), 'config.json'), JSON.stringify({
        redmineApiKeyEncrypted: 'unused', textFormat: 'textile', columnOverrides: { 1: 'todo' },
      }));
      let decryptions = 0;
      const available = safeStorage.isEncryptionAvailable;
      const decrypt = safeStorage.decryptString;
      try {
        safeStorage.isEncryptionAvailable = () => true;
        safeStorage.decryptString = () => { decryptions++; throw new Error('Unexpected Keychain access'); };
        const preferences = require(path.join(app.getAppPath(), 'src/config-store.js')).loadPersistedConfig({ skipCredentials: true });
        return { preferences, decryptions };
      } finally {
        safeStorage.isEncryptionAvailable = available;
        safeStorage.decryptString = decrypt;
      }
    });
    expect(result.decryptions).toBe(0);
    expect(result.preferences).toMatchObject({ redmineApiKey: '', textFormat: 'textile', columnOverrides: { 1: 'todo' } });
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('account mismatch keeps saved work and blocks replacement timers', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const route = new URL(req.url, 'http://localhost').pathname;
    res.end(JSON.stringify({
      '/users/current.json': { user: { id: 1 } },
      '/issue_statuses.json': { issue_statuses: [] },
      '/enumerations/time_entry_activities.json': { time_entry_activities: [] },
      '/enumerations/issue_priorities.json': { issue_priorities: [] },
      '/issues.json': { issues: [], total_count: 0 },
    }[route] || {}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-mismatch-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ redmineBaseUrl: base, redmineApiKeyPlaintext: 'dummy' }));
  fs.writeFileSync(path.join(userData, 'timer.json'), JSON.stringify({
    version: 1, savedAt: 2000, connectionScope: `${base}|99`, submissionPending: false,
    state: { status: 'paused', ticketId: 42, subject: 'Other account work', runningSince: null, elapsedMs: 60000 },
  }));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' } });
    await app.evaluate(({ dialog }) => {
      global.recoveryDialogs = [];
      dialog.showMessageBox = async (window, options) => { global.recoveryDialogs.push(options); return { response: 0 }; };
    });
    const page = await getMainWindow(app);
    await expect.poll(() => app.evaluate(() => global.recoveryDialogs.length)).toBe(1);
    const prompt = await app.evaluate(() => global.recoveryDialogs[0]);
    expect(prompt.buttons).toEqual(['Keep saved for later', 'Discard timer']);
    expect(prompt.defaultId).toBe(0);
    expect(await page.evaluate(() => window.reddieAPI.getTimerState())).toMatchObject({ status: 'idle' });
    const blocked = await page.evaluate(() => window.reddieAPI.startTimer(43, 'Replacement'));
    expect(blocked.error).toMatch(/Recover or discard/);
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'timer.json'), 'utf8')).state.ticketId).toBe(42);
    await page.locator('.settings-btn').click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await expect(page.locator('[data-click="recover-timer"]')).toBeVisible();
    await page.locator('[data-click="recover-timer"]').click();
    await expect.poll(() => app.evaluate(() => global.recoveryDialogs.length)).toBe(2);
    const afterKeep = await page.evaluate(() => window.reddieAPI.startTimer(44, 'Still blocked'));
    expect(afterKeep.error).toMatch(/Recover or discard/);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('pending submission requires an explicit Redmine reconciliation choice', async () => {
  let writes = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') writes++;
    const route = new URL(req.url, 'http://localhost').pathname;
    res.end(JSON.stringify({
      '/users/current.json': { user: { id: 7 } },
      '/issue_statuses.json': { issue_statuses: [] },
      '/enumerations/time_entry_activities.json': { time_entry_activities: [] },
      '/enumerations/issue_priorities.json': { issue_priorities: [] },
      '/issues.json': { issues: [], total_count: 0 },
    }[route] || {}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-pending-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ redmineBaseUrl: base, redmineApiKeyPlaintext: 'dummy' }));
  fs.writeFileSync(path.join(userData, 'timer.json'), JSON.stringify({
    version: 1, savedAt: 61000, connectionScope: `${base}|7`, submissionPending: true,
    state: { status: 'running', ticketId: 42, subject: 'Possibly submitted', runningSince: 1000, elapsedMs: 0 },
  }));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' } });
    await app.evaluate(({ dialog }) => {
      global.recoveryDialogs = [];
      dialog.showMessageBox = async (window, options) => { global.recoveryDialogs.push(options); return { response: 2 }; };
    });
    const page = await getMainWindow(app);
    await expect.poll(() => app.evaluate(() => global.recoveryDialogs.length)).toBe(1);
    const prompt = await app.evaluate(() => global.recoveryDialogs[0]);
    expect(prompt.buttons).toContain('I checked Redmine: recover paused timer');
    expect(prompt.detail).toMatch(/Recovery never submits automatically/);
    expect(await page.evaluate(() => window.reddieAPI.getTimerState())).toMatchObject({ status: 'idle' });
    expect(writes).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'timer.json'), 'utf8'));
    expect(saved.submissionPending).toBe(true);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('a timer snapshot write failure leaves the in-memory timer unchanged', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-write-failure-'));
  fs.mkdirSync(path.join(userData, 'timer.json'));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`], env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' } });
    await expect.poll(() => app.windows().find(w => w.url().includes('index.html')) || null).not.toBeNull();
    const page = app.windows().find(w => w.url().includes('index.html'));
    const result = await page.evaluate(() => window.reddieAPI.startTimer(42, 'Must not start'));
    expect(result.error).toBeTruthy();
    expect(await page.evaluate(() => window.reddieAPI.getTimerState())).toMatchObject({ status: 'idle' });
    expect(fs.statSync(path.join(userData, 'timer.json')).isDirectory()).toBe(true);
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
