const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { RedmineClient, buildColumnMapping } = require('./redmine-client');
const { loadPersistedConfig, persistConfig } = require('./config-store');
const { autoUpdater } = require('electron-updater');

// Auto-download/install is off on purpose: macOS's Squirrel.Mac (the
// updater apply step electron-updater uses under the hood) requires the
// downloaded build to carry the same stable code-signing identity as the
// running app before it'll install it. Both builds are ad-hoc signed (no
// paid Apple Developer cert - same blocker as notarization elsewhere in
// this project), so that verification always fails and the app never
// finishes applying an update on its own. Detect-and-notify instead;
// the user grabs the new build from GitHub Releases manually.
autoUpdater.autoDownload = false;

function sendUpdateStatus(status, extra = {}) {
  console.log('Update status:', status, extra);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...extra });
  }
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'));
autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: err.message }));
// No 'download-progress'/'update-downloaded' listeners - those only fire
// if something calls downloadUpdate(), which nothing here does now that
// autoDownload is off.

// Talks directly to Redmine's own REST API - no Converge or any other
// intermediary backend required. Anyone can run this against their own
// Redmine instance by setting these two values (Settings, or .env).
const DEFAULT_REDMINE_BASE_URL = process.env.REDMINE_BASE_URL || 'https://redmine.nasctech.com';
const DEFAULT_REDMINE_API_KEY = process.env.REDMINE_API_KEY || '';

let config = {
  redmineBaseUrl: DEFAULT_REDMINE_BASE_URL,
  redmineApiKey: DEFAULT_REDMINE_API_KEY,
  columnOverrides: {},
};

let client = new RedmineClient(config.redmineBaseUrl, config.redmineApiKey);
let columnMapping = { statusIdToColumn: {}, columnToStatusId: {} };
let activities = [];
let priorities = [];
let lastStatuses = [];
let currentUserId = null;

function rebuildClient() {
  client = new RedmineClient(config.redmineBaseUrl, config.redmineApiKey);
}

async function connect() {
  if (!config.redmineApiKey) {
    return { error: 'No API key configured' };
  }
  try {
    const [user, statuses, activityList, priorityList] = await Promise.all([
      client.getCurrentUser(),
      client.listStatuses(),
      client.listActivities(),
      client.listPriorities(),
    ]);
    lastStatuses = statuses;
    columnMapping = buildColumnMapping(statuses, config.columnOverrides);
    activities = activityList;
    priorities = priorityList;
    currentUserId = user && user.id;
    return { ok: true, user };
  } catch (err) {
    console.error('Connect failed:', err.message);
    return { error: err.message };
  }
}

async function fetchIssues() {
  try {
    const issues = await client.listMyIssues();
    return { items: issues };
  } catch (err) {
    console.error('Fetch issues failed:', err.message);
    return { items: [], error: err.message };
  }
}

async function fetchAuthoredIssues() {
  try {
    const issues = await client.listAuthoredIssues();
    return { items: issues };
  } catch (err) {
    console.error('Fetch authored issues failed:', err.message);
    return { items: [], error: err.message };
  }
}

async function fetchIssueDetail(issueId) {
  try {
    return await client.getIssueDetail(issueId);
  } catch (err) {
    console.error('Fetch issue detail failed:', err.message);
    return { error: err.message };
  }
}

let mainWindow;
const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // hiddenInset (traffic lights, no title bar) is a macOS convention -
    // Windows/Linux keep the normal OS-drawn frame instead of trying to
    // fake it, since faking it well needs real custom minimize/maximize/
    // close controls this app doesn't have.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  createWindow();

  // A packaged build already gets its icon for free from Info.plist's
  // CFBundleIconFile (build/icon.icns) - this is only needed so `npm
  // start` (raw Electron binary, no Info.plist) shows it too. build/
  // isn't bundled into the packaged app's asar, so iconPath wouldn't
  // resolve there anyway; guarded to dev builds and never allowed to
  // block window creation if it fails for any other reason.
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(iconPath);
    } catch (err) {
      console.error('Failed to set dock icon:', err.message);
    }
  }

  // .env wins if it supplied a key; otherwise fall back to the encrypted
  // config from a previous Settings save (see config-store.js).
  if (!config.redmineApiKey) {
    const persisted = loadPersistedConfig();
    if (persisted.redmineApiKey) {
      config = { ...config, ...persisted };
      rebuildClient();
    }
  }

  if (config.redmineApiKey) {
    await connect();
  }

  // Only makes sense against a packaged build with real release metadata -
  // in dev mode (npm start) there's no update feed to check and
  // electron-updater just errors, so skip it entirely there. Delayed so
  // it never competes with the initial board load for network/attention.
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('Update check failed:', err.message);
      });
    }, 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('get-config', async () => {
  return config;
});

ipcMain.handle('save-config', async (event, newConfig) => {
  config = { ...config, ...newConfig };
  rebuildClient();
  persistConfig(config);
  console.log('Config saved:', { ...config, redmineApiKey: config.redmineApiKey ? '(set)' : '' });
  return await connect();
});

ipcMain.handle('check-connection', async () => {
  return await connect();
});

ipcMain.handle('get-column-mapping', async () => {
  return columnMapping;
});

ipcMain.handle('fetch-statuses', async () => {
  return { items: lastStatuses };
});

ipcMain.handle('save-column-overrides', async (event, overrides) => {
  config.columnOverrides = overrides;
  persistConfig(config);
  columnMapping = buildColumnMapping(lastStatuses, config.columnOverrides);
  return { ok: true, columnMapping };
});

ipcMain.handle('fetch-issues', async () => {
  return await fetchIssues();
});

ipcMain.handle('fetch-authored-issues', async () => {
  return await fetchAuthoredIssues();
});

ipcMain.handle('fetch-issue-detail', async (event, issueId) => {
  return await fetchIssueDetail(issueId);
});

ipcMain.handle('update-status', async (event, { issueId, statusId }) => {
  try {
    await client.updateStatus(issueId, statusId);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fetch-projects', async () => {
  try {
    const projects = await client.listProjects();
    return { items: projects };
  } catch (err) {
    return { items: [], error: err.message };
  }
});

ipcMain.handle('fetch-project-trackers', async (event, projectId) => {
  try {
    const trackers = await client.listProjectTrackers(projectId);
    return { items: trackers };
  } catch (err) {
    return { items: [], error: err.message };
  }
});

ipcMain.handle('create-issue', async (event, { projectId, trackerId, subject, description }) => {
  try {
    const result = await client.createIssue({
      projectId,
      trackerId,
      subject,
      description,
      assigneeId: currentUserId,
    });
    return { ok: true, issue: result.issue };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fetch-project-members', async (event, projectId) => {
  try {
    const members = await client.listProjectMembers(projectId);
    return { items: members };
  } catch (err) {
    return { items: [], error: err.message };
  }
});

ipcMain.handle('update-assignee', async (event, { issueId, userId }) => {
  try {
    await client.updateAssignee(issueId, userId);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('add-comment', async (event, { issueId, comment }) => {
  try {
    await client.addComment(issueId, comment);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fetch-activities', async () => {
  return { items: activities };
});

ipcMain.handle('fetch-priorities', async () => {
  return { items: priorities };
});

ipcMain.handle('update-priority', async (event, { issueId, priorityId }) => {
  try {
    await client.updatePriority(issueId, priorityId);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('update-subject', async (event, { issueId, subject }) => {
  try {
    await client.updateSubject(issueId, subject);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('upload-attachment', async (event, issueId) => {
  // File picking has to happen here, not in the renderer - contextIsolation
  // means the renderer can't touch the filesystem at all, so there's no
  // reason to round-trip a chosen path through it either.
  const picked = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  if (picked.canceled || !picked.filePaths.length) {
    return { canceled: true };
  }
  const filePath = picked.filePaths[0];
  const filename = path.basename(filePath);
  try {
    const buffer = fs.readFileSync(filePath);
    const token = await client.uploadFile(buffer, filename);
    await client.attachToIssue(issueId, token, filename);
    return { ok: true, filename };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('add-timelog', async (event, { issueId, hours, activityId, comment, spentOn }) => {
  try {
    await client.addTimeEntry(issueId, { hours, activityId, comment, spentOn });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { error: 'Updates only work in a packaged build, not npm start' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('install-update', async () => {
  autoUpdater.quitAndInstall();
});
