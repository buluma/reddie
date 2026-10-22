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
    await expect.poll(() => app.evaluate(() => global.detailRequests.length), { timeout: 15000 }).toBe(count);
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
    await page.evaluate(() => { void saveSubjectEdit(); });
    expect(await app.evaluate(() => global.lastSubjectWrite)).toEqual({ issueId: 2, subject: 'Edited second' });
    await pending(1);
    await resolve(2, { issue: { id: 2, subject: 'Edited second' }, timeEntries: [] });
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
    await expect(page.locator('#toast-container .toast', { hasText: 'Comment posted' })).toHaveCount(1);
  });
  test('an older subject save still reports success and refreshes the board', async () => {
    await app.evaluate(({ ipcMain }) => {
      global.boardFetches = 0;
      ipcMain.removeHandler('fetch-issues');
      ipcMain.handle('fetch-issues', () => { global.boardFetches += 1; return { notConfigured: true }; });
      ipcMain.removeHandler('update-subject');
      ipcMain.handle('update-subject', (event, data) => new Promise(resolve => {
        global.lastSubjectWrite = data;
        global.resolveSubject = resolve;
      }));
    });
    await page.evaluate(() => { void openIssueDetail(8); });
    await pending(1);
    await resolve(8, { issue: { id: 8, subject: 'Original subject' } });
    await expect(page.locator('#detail-subject')).toHaveText('Original subject');
    await page.locator('#detail-subject').fill('Renamed subject');
    await page.evaluate(() => { void saveSubjectEdit(); });
    await expect.poll(() => app.evaluate(() => !!global.resolveSubject)).toBe(true);
    await page.evaluate(() => { void openIssueDetail(9); });
    await pending(1);
    await resolve(9, { issue: { id: 9, subject: 'Other subject' } });
    await expect(page.locator('#detail-subject')).toHaveText('Other subject');
    await expect(page.locator('#toast-container .toast', { hasText: 'Subject updated' })).toHaveCount(0, { timeout: 10000 });
    await app.evaluate(() => global.resolveSubject({ ok: true }));
    await expect(page.locator('#toast-container .toast', { hasText: 'Subject updated' })).toHaveCount(1);
    await expect.poll(() => app.evaluate(() => global.boardFetches)).toBe(1);
    expect(await app.evaluate(() => global.lastSubjectWrite)).toEqual({ issueId: 8, subject: 'Renamed subject' });
    await expect(page.locator('#detail-subject')).toHaveText('Other subject');
  });
  test('an older description save refreshes a reopened issue without replacing another view', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('update-issue');
      ipcMain.handle('update-issue', (event, data) => new Promise(resolve => {
        global.lastIssueWrite = data;
        global.resolveIssueWrite = resolve;
      }));
    });
    await page.evaluate(() => { void openIssueDetail(10); });
    await pending(1);
    await resolve(10, { issue: { id: 10, subject: 'Described issue', description: 'Old text' } });
    await expect(page.locator('#detail-subject')).toHaveText('Described issue');
    await page.locator('#description-display').click();
    await page.locator('#description-input').fill('New text');
    await page.locator('#description-input').press('Tab');
    await expect.poll(() => app.evaluate(() => !!global.resolveIssueWrite)).toBe(true);
    await page.evaluate(() => { void openIssueDetail(11); });
    await pending(1);
    await resolve(11, { issue: { id: 11, subject: 'Undescribed issue' } });
    await expect(page.locator('#detail-subject')).toHaveText('Undescribed issue');
    await page.evaluate(() => { void openIssueDetail(10); });
    await pending(1);
    await resolve(10, { issue: { id: 10, subject: 'Described issue', description: 'Old text' } });
    await expect(page.locator('#detail-subject')).toHaveText('Described issue');
    await app.evaluate(() => global.resolveIssueWrite({ ok: true }));
    await expect(page.locator('#toast-container .toast', { hasText: 'Description updated' })).toHaveCount(1);
    await pending(1);
    await resolve(10, { issue: { id: 10, subject: 'Described issue', description: 'New text' } });
    expect(await app.evaluate(() => global.lastIssueWrite)).toEqual({ issueId: 10, fields: { description: 'New text' } });
    await expect(page.locator('#detail-subject')).toHaveText('Described issue');
    await expect(page.locator('#description-display')).toContainText('New text');
  });
  test('discarding another timer starts it for the issue where it was clicked', async () => {
    await app.evaluate(({ ipcMain }) => {
      global.timerStarts = [];
      ipcMain.removeHandler('timer-cancel');
      ipcMain.handle('timer-cancel', () => new Promise(resolve => { global.resolveCancel = resolve; }));
      ipcMain.removeHandler('timer-start');
      ipcMain.handle('timer-start', (event, data) => {
        global.timerStarts.push(data);
        return { ok: true, state: { status: 'idle' } };
      });
    });
    await page.evaluate(() => { void openIssueDetail(12); });
    await pending(1);
    await resolve(12, { issue: { id: 12, subject: 'Timer target' } });
    await expect(page.locator('#detail-subject')).toHaveText('Timer target');
    await page.evaluate(() => { void discardOtherTimerAndStartHere(); });
    await expect.poll(() => app.evaluate(() => !!global.resolveCancel)).toBe(true);
    await page.evaluate(() => { void openIssueDetail(13); });
    await pending(1);
    await resolve(13, { issue: { id: 13, subject: 'Different issue' } });
    await expect(page.locator('#detail-subject')).toHaveText('Different issue');
    await app.evaluate(() => global.resolveCancel({ ok: true, state: { status: 'idle' } }));
    await expect.poll(() => app.evaluate(() => global.timerStarts)).toEqual([{ ticketId: 12, subject: 'Timer target' }]);
  });
  test('a failed discard does not start a timer', async () => {
    await app.evaluate(({ ipcMain }) => {
      global.timerStarts = [];
      ipcMain.removeHandler('timer-cancel');
      ipcMain.handle('timer-cancel', () => ({ error: 'Cancel failed' }));
    });
    await page.evaluate(() => discardOtherTimerAndStartHere());
    await expect(page.locator('#toast-container .toast', { hasText: 'Cancel failed' })).toHaveCount(1);
    expect(await app.evaluate(() => global.timerStarts)).toEqual([]);
  });

  test('a connection save attempt cannot retarget a pending timer start', async () => {
    await app.evaluate(({ ipcMain }) => {
      global.timerStarts = [];
      global.resolveCancel = null;
      ipcMain.removeHandler('timer-cancel');
      ipcMain.handle('timer-cancel', () => new Promise(resolve => { global.resolveCancel = resolve; }));
    });
    await page.evaluate(() => { window.pendingTimerStart = discardOtherTimerAndStartHere(); });
    await expect.poll(() => app.evaluate(() => !!global.resolveCancel)).toBe(true);
    page.once('dialog', dialog => dialog.accept());
    await page.evaluate(() => saveSettings());
    await app.evaluate(() => global.resolveCancel({ ok: true, state: { status: 'idle' } }));
    await page.evaluate(() => window.pendingTimerStart);
    expect(await app.evaluate(() => global.timerStarts)).toEqual([]);
    await expect(page.locator('#toast-container')).toContainText('Connection changed');
  });

});
