const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

test.describe('issue detail request ordering', () => {
  let app, page, userData;
  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-detail-'));
    app = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`],
      env: { ...process.env, REDMINE_API_KEY: '', REDMINE_BASE_URL: '' },
    });
    await expect.poll(() => app.windows().some(w => w.url().includes('index.html'))).toBe(true);
    page = app.windows().find(w => w.url().includes('index.html'));
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.locator('#settings-modal .close-btn').click();
    await app.evaluate(({ ipcMain }) => {
      global.detailRequests = [];
      ipcMain.removeHandler('fetch-issue-detail');
      ipcMain.handle('fetch-issue-detail', (event, id) => new Promise(resolve => {
        global.detailRequests.push({ id, resolve });
      }));
      ipcMain.removeHandler('update-subject');
      ipcMain.handle('update-subject', (event, data) => { global.lastSubjectWrite = data; return { ok: true }; });
    });
  });
  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  });
  async function resolve(id, result) {
    await app.evaluate((_, { id, result }) => {
      const index = global.detailRequests.findIndex(r => r.id === id);
      global.detailRequests.splice(index, 1)[0].resolve(result);
    }, { id, result });
  }
  async function pending(count) {
    await expect.poll(() => app.evaluate(() => global.detailRequests.length)).toBe(count);
  }
  test('late detail cannot replace the selection or redirect edits', async () => {
    await page.evaluate(() => { void openIssueDetail(1); void openIssueDetail(2); });
    await pending(2);
    await resolve(2, { issue: { id: 2, subject: 'Second ticket' }, timeEntries: [] });
    await expect(page.locator('#detail-subject')).toHaveText('Second ticket');
    await resolve(1, { issue: { id: 1, subject: 'First ticket' }, timeEntries: [] });
    await pending(0);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('#detail-subject')).toHaveText('Second ticket');
    await page.locator('#detail-subject').fill('Edited second');
    await page.evaluate(() => saveSubjectEdit());
    expect(await app.evaluate(() => global.lastSubjectWrite)).toEqual({ issueId: 2, subject: 'Edited second' });
  });
  test('closing a pending detail invalidates both successes and errors', async () => {
    await page.evaluate(() => { void openIssueDetail(3); closeIssueDetail(); });
    await pending(1);
    await resolve(3, { error: 'Late failure' });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('#issue-detail-modal')).not.toHaveClass(/show/);
    await expect(page.locator('#detail-subject')).not.toHaveText('Error');
  });
  test('same ticket reopened ignores its older request', async () => {
    await page.evaluate(() => { void openIssueDetail(4); void openIssueDetail(4); });
    await pending(2);
    await app.evaluate(() => global.detailRequests.pop().resolve({ issue: { id: 4, subject: 'Newest view' } }));
    await expect(page.locator('#detail-subject')).toHaveText('Newest view');
    await resolve(4, { issue: { id: 4, subject: 'Stale view' } });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('#detail-subject')).toHaveText('Newest view');
  });
  test('late project metadata cannot replace a newer issue', async () => {
    await app.evaluate(({ ipcMain }) => {
      global.memberRequests = [];
      ipcMain.removeHandler('fetch-project-members');
      ipcMain.handle('fetch-project-members', (event, id) => new Promise(resolve => global.memberRequests.push({ id, resolve })));
      for (const channel of ['fetch-project-trackers', 'fetch-project-categories', 'fetch-project-versions']) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => ({ items: [] }));
      }
    });
    await page.evaluate(() => { void openIssueDetail(5); });
    await pending(1);
    await resolve(5, { issue: { id: 5, subject: 'Old project', project: { id: 50 } } });
    await expect.poll(() => app.evaluate(() => global.memberRequests.length)).toBe(1);
    await page.evaluate(() => { void openIssueDetail(6); });
    await pending(1);
    await resolve(6, { issue: { id: 6, subject: 'New project', project: { id: 60 } } });
    await expect.poll(() => app.evaluate(() => global.memberRequests.length)).toBe(2);
    await app.evaluate(() => global.memberRequests.pop().resolve({ items: [{ id: 60, name: 'New member' }] }));
    await expect(page.locator('#detail-subject')).toHaveText('New project');
    await app.evaluate(() => global.memberRequests.pop().resolve({ items: [{ id: 50, name: 'Old member' }] }));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('#detail-subject')).toHaveText('New project');
    await expect(page.locator('#assignee-select')).toContainText('New member');
    await expect(page.locator('#assignee-select')).not.toContainText('Old member');
  });
  test('an older comment submission preserves the new view and its draft', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('add-comment');
      ipcMain.handle('add-comment', () => new Promise(resolve => { global.resolveComment = resolve; }));
    });
    await page.locator('#comment-input').fill('Old comment');
    await page.evaluate(() => { void postComment(); });
    await expect.poll(() => app.evaluate(() => !!global.resolveComment)).toBe(true);
    await page.evaluate(() => { void openIssueDetail(7); });
    await pending(1);
    await resolve(7, { issue: { id: 7, subject: 'Another issue' } });
    await expect(page.locator('#detail-subject')).toHaveText('Another issue');
    await page.locator('#comment-input').fill('New draft');
    await app.evaluate(() => global.resolveComment({ ok: true }));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator('#comment-input')).toHaveValue('New draft');
    await expect(page.locator('#detail-subject')).toHaveText('Another issue');
  });

});
