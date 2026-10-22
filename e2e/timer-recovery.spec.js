const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { test, expect, _electron: electron } = require('@playwright/test');

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
