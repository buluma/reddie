const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

test.describe('board refresh ordering', () => {
  let app, page, userData;
  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-board-'));
    app = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`],
      env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' },
    });
    await expect.poll(() => app.windows().some(w => w.url().includes('index.html'))).toBe(true);
    page = app.windows().find(w => w.url().includes('index.html'));
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.locator('#settings-modal .close-btn').click();
    await app.evaluate(({ ipcMain }) => {
      global.boardRequests = [];
      for (const channel of ['fetch-issues', 'fetch-authored-issues']) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => new Promise(resolve => global.boardRequests.push({ channel, resolve })));
      }
    });
  });
  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  });
  async function pending(count) {
    await expect.poll(() => app.evaluate(() => global.boardRequests.length)).toBe(count);
  }
  async function resolveNewest(id) {
    await app.evaluate((_, id) => global.boardRequests.pop().resolve({ items: [{ id, subject: `Ticket ${id}`, status: { id: 1 } }] }), id);
  }
  test('late assigned response cannot overwrite the authored board or cache', async () => {
    await page.evaluate(() => { window.assignedLoad = loadFromAPI(); });
    await pending(1);
    await page.evaluate(() => { window.authoredLoad = setBoardMode('authored'); });
    await pending(2);
    await resolveNewest(202);
    await page.evaluate(() => window.authoredLoad);
    await expect(page.locator('#backlog-list')).toContainText('Ticket 202');
    await resolveNewest(101);
    await page.evaluate(() => window.assignedLoad);
    await expect(page.locator('#backlog-list')).not.toContainText('Ticket 101');
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban-state-authored')));
    expect(cache.backlog.map(t => t.issueId)).toEqual([202]);
  });
  test('newer same-mode refresh wins and preserves scratch cards', async () => {
    await page.evaluate(() => { addTask('todo'); window.olderLoad = loadFromAPI(); window.newerLoad = loadFromAPI(); });
    await pending(2);
    await resolveNewest(303);
    await page.evaluate(() => window.newerLoad);
    await expect(page.locator('#backlog-list')).toContainText('Ticket 303');
    await resolveNewest(202);
    await page.evaluate(() => window.olderLoad);
    await expect(page.locator('#backlog-list')).toContainText('Ticket 303');
    await expect(page.locator('#todo-list .task-card')).toHaveCount(1);
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban-state-authored')));
    expect(cache.todo).toHaveLength(1);
    expect(cache.todo[0].issueId).toBeNull();
  });
  test('late failures do not surface against the newer board', async () => {
    await page.evaluate(() => { window.olderLoad = loadFromAPI(); window.newerLoad = loadFromAPI(); });
    await pending(2);
    await resolveNewest(404);
    await page.evaluate(() => window.newerLoad);
    await expect(page.locator('#backlog-list')).toContainText('Ticket 404');
    await app.evaluate(() => global.boardRequests.pop().resolve({ error: 'Obsolete error' }));
    await page.evaluate(() => window.olderLoad);
    await expect(page.locator('#toast-container')).not.toContainText('Obsolete error');
  });
});
