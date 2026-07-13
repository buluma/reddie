const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { RedmineClient, buildColumnMapping, sameInstanceImagePath } = require('./redmine-client');
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
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version, currentVersion: app.getVersion() }));
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
  // How to render issue/comment bodies: 'auto' (guess from content),
  // 'markdown', or 'textile'. Instance-wide; see text-format.js.
  textFormat: 'auto',
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

// Closing the window hides it to the tray instead of quitting (see the
// mainWindow 'close' handler below) - isQuitting distinguishes that from
// an actual quit (Quit menu item / Cmd+Q), which must let the close go
// through rather than re-hiding a window that's about to be destroyed
// anyway.
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});

// Tray: a plain colored dot rather than a recolored copy of the app icon -
// it's a status indicator (how urgent is what's assigned to me right now),
// not a logo, so it shouldn't try to look like one.
let tray = null;
let trayMenu = null;
let popoverWindow = null;
// Last payload pushed from the renderer (see update-tray-status below) -
// kept around so a freshly-opened popover has something to show
// immediately instead of a blank frame until the next board refresh.
let latestTrayData = { count: 0, urgency: 'none', issues: [], columnCounts: {}, connected: false };
const trayIconCache = {};
const TRAY_COLORS = { none: '#808080', low: '#30d158', medium: '#ff9f0a', high: '#ff453a' };

// Pre-rendered PNGs (src/tray-icons/dot-<urgency>.png + @2x) rather than an
// SVG data URL - nativeImage.createFromDataURL only decodes raster formats
// (PNG/JPEG), not SVG markup, so an SVG data URL silently produces an
// empty image (confirmed live: tray showed no icon at all, only the
// setTitle() text). These live under src/, not build/ - build/ is
// electron-builder's buildResources dir, consumed at build time for the
// app's own OS-level icon and never copied into the packaged asar (see
// iconPath's comment above for the same gotcha with the dock icon; this
// bit the tray dots for real, confirmed via `asar list` showing no build/
// contents at all in the packaged app). @2x sibling files are picked up
// automatically by Electron for Retina displays as long as they sit next
// to the @1x file.
function loadTrayDot(urgency) {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray-icons', `dot-${urgency}.png`));
  // Template images let macOS recolor for light/dark menu bars - only the
  // neutral/no-work variant should get that treatment, the urgency colors
  // (green/orange/red) need to stay their actual color to mean anything.
  if (process.platform === 'darwin' && urgency === 'none') {
    img.setTemplateImage(true);
  }
  return img;
}

function cacheTrayIcons() {
  Object.keys(TRAY_COLORS).forEach((urgency) => {
    trayIconCache[urgency] = loadTrayDot(urgency);
  });
}

function truncateLabel(text, max = 40) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// `issues` is the same top-N unfinished-issue summary the renderer sends
// alongside count/urgency (see update-tray-status below) - rebuilt on every
// board refresh so the menu never goes stale while the app is running.
function buildTrayContextMenu(issues = []) {
  const ticketItems = issues.map((issue) => ({
    label: `#${issue.id} ${truncateLabel(issue.subject || '')}`,
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('open-issue-detail-from-tray', issue.id);
      }
    },
  }));

  trayMenu = Menu.buildFromTemplate([
    {
      label: 'Show Reddie',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    ...(ticketItems.length ? [{ type: 'separator' }, ...ticketItems] : []),
    { type: 'separator' },
    {
      label: 'Settings…',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('show-settings');
        }
      },
    },
    {
      label: 'Check for Updates…',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('show-updater');
        }
      },
    },
    { type: 'separator' },
    { role: 'quit' },
  ]);
  // Not tray.setContextMenu() here on purpose - that would make macOS show
  // this menu on left-click too (its behavior once a context menu is set),
  // which would swallow the click meant to toggle the popover below.
  // Shown manually via tray.popUpContextMenu() on right-click instead.
}

// Driven by { count, urgency } pushed from the renderer after every board
// refresh (see updateTrayStatus() in renderer.js) - the renderer already
// holds the fetched issue list and knows the column mapping/priority
// classification, so it computes urgency; main.js just paints the tray
// chrome from whatever it's told. Keeps Redmine domain logic out of main.js.
function updateTrayAppearance(count, urgency) {
  if (!tray || tray.isDestroyed()) return;
  const variant = count > 0 ? urgency : 'none';
  const icon = trayIconCache[variant] || trayIconCache.none;
  if (icon && !icon.isEmpty()) {
    try {
      tray.setImage(icon);
    } catch (err) {
      // ignore - invalid image, keep whatever's currently shown
    }
  }
  if (process.platform === 'darwin') {
    tray.setTitle(count > 0 ? (count > 99 ? '99+' : String(count)) : '');
  }
  tray.setToolTip(count > 0 ? `Reddie: ${count} issue${count !== 1 ? 's' : ''} assigned` : 'Reddie - no pending issues');

  // macOS/Linux(Unity) only - Electron silently no-ops this on Windows
  // (there's no equivalent without a per-window overlay icon, not worth
  // the extra plumbing for a count that's already visible in the tray
  // tooltip/title there).
  try {
    app.setBadgeCount(count);
  } catch (err) {
    // ignore - unsupported on this platform
  }
}

const POPOVER_WIDTH = 320;
// Starting height only - real height comes from tray-popover.js measuring
// its own rendered content (see tray-popover-resize below) and correcting
// it, since a fixed height left dead space below the footer whenever there
// were fewer than 5 tickets (confirmed live).
const POPOVER_DEFAULT_HEIGHT = 300;
let popoverHeight = POPOVER_DEFAULT_HEIGHT;

function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_DEFAULT_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    movable: false,
    skipTaskbar: true,
    // A closed/hidden main window still keeps the app alive for the tray
    // (see mainWindow's 'close' handler) - alwaysOnTop plus this popover's
    // own blur handler is what makes it behave like a native menu-bar
    // popover instead of just another window.
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'tray-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popoverWindow.loadFile(path.join(__dirname, 'tray-popover.html'));
  popoverWindow.on('blur', () => {
    if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.hide();
  });
}

// Tray bounds are reliable on macOS/Windows; several Linux desktop
// environments (GNOME/AppIndicator in particular) report an all-zero rect
// since there's no real "icon position" concept there - fall back to the
// primary display's corner in that case rather than positioning at (0,0).
function getPopoverPosition(height) {
  const trayBounds = tray.getBounds();
  if (trayBounds && trayBounds.width > 0) {
    const x = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2);
    const y = process.platform === 'darwin'
      ? Math.round(trayBounds.y + trayBounds.height + 4)
      : Math.round(trayBounds.y - height - 4);
    return { x, y };
  }
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - POPOVER_WIDTH - 12,
    y: workArea.y + workArea.height - height - 12,
  };
}

function showPopover() {
  if (!popoverWindow || popoverWindow.isDestroyed()) createPopoverWindow();
  const { x, y } = getPopoverPosition(popoverHeight);
  popoverWindow.setPosition(x, y);
  popoverWindow.webContents.send('tray-data', latestTrayData);
  popoverWindow.show();
  popoverWindow.focus();
}

function hidePopover() {
  if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.hide();
}

function createTray() {
  cacheTrayIcons();
  buildTrayContextMenu();
  createPopoverWindow();
  const icon = trayIconCache.none;
  tray = new Tray(icon && !icon.isEmpty() ? icon : nativeImage.createEmpty());
  tray.setToolTip('Reddie');
  // Left click: quick-glance popover. Right click: the fuller native menu
  // (ticket list plus Settings/Updates/Quit) - see the setContextMenu note
  // in buildTrayContextMenu() for why these two can't share tray.on('click').
  tray.on('click', () => {
    if (popoverWindow && popoverWindow.isVisible()) {
      hidePopover();
    } else {
      showPopover();
    }
  });
  tray.on('right-click', () => {
    hidePopover();
    tray.popUpContextMenu(trayMenu);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Below this, the header's controls (search, New Ticket, mode toggle,
    // theme/settings) have nowhere left to wrap to and start overlapping
    // instead - this is the point past which CSS alone can't save it.
    minWidth: 720,
    minHeight: 480,
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

  // Rendered Markdown (descriptions/comments) now emits live <a> links, and
  // marked autolinks bare URLs too. A plain in-frame click on one would
  // navigate this window away from index.html/renderer.js, destroying the
  // whole app UI until relaunch. Keep the renderer pinned to its own file://
  // and hand any http(s) link to the OS browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  // target=_blank / window.open links (same source: rendered ticket text)
  // never spawn an in-app window - external ones go to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // With a tray present, closing the window is "hide", not "quit" - on
  // every platform, not just macOS's usual convention, since the tray now
  // gives Windows/Linux users the same way back in. The Quit menu item
  // (and Cmd+Q) still exits for real via isQuitting/before-quit above.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(async () => {
  createWindow();
  createTray();

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

  // Can't gate on getAllWindows().length here: the tray popover is a
  // persistent (hidden) BrowserWindow, so the count is never 0. Closing the
  // main window only hides it (see its 'close' handler), so a dock click
  // must re-show that hidden window - or recreate it if it was genuinely
  // destroyed - rather than doing nothing because "a window still exists".
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
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

ipcMain.handle('fetch-tracker-custom-fields', async (event, { projectId, trackerId }) => {
  try {
    const fields = await client.listTrackerCustomFields(projectId, trackerId);
    return { items: fields };
  } catch (err) {
    return { items: [], error: err.message };
  }
});

ipcMain.handle('create-issue', async (event, { projectId, trackerId, subject, description, customFields }) => {
  try {
    const result = await client.createIssue({
      projectId,
      trackerId,
      subject,
      description,
      assigneeId: currentUserId,
      customFields,
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

ipcMain.handle('open-releases-page', async () => {
  await shell.openExternal('https://github.com/buluma/reddie/releases');
});

ipcMain.on('update-tray-status', (event, payload) => {
  latestTrayData = {
    count: payload.count || 0,
    urgency: payload.urgency || 'none',
    issues: payload.issues || [],
    columnCounts: payload.columnCounts || {},
    connected: !!payload.connected,
  };
  updateTrayAppearance(latestTrayData.count, latestTrayData.urgency);
  buildTrayContextMenu(latestTrayData.issues);
  if (popoverWindow && !popoverWindow.isDestroyed() && popoverWindow.isVisible()) {
    popoverWindow.webContents.send('tray-data', latestTrayData);
  }
});

// Popover buttons/ticket rows fire these (see tray-popover.js) - each hides
// the popover first so it doesn't linger on top once the main window comes
// forward for the action it triggered.
ipcMain.on('tray-popover-open-issue', (event, issueId) => {
  hidePopover();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('open-issue-detail-from-tray', issueId);
  }
});

ipcMain.on('tray-popover-open-settings', () => {
  hidePopover();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('show-settings');
  }
});

ipcMain.on('tray-popover-check-updates', () => {
  hidePopover();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('show-updater');
  }
});

ipcMain.on('tray-popover-quit', () => {
  app.quit();
});

// tray-popover.js measures its own rendered content height (document.body.
// scrollHeight) after every data render and reports it here, since the
// content's length varies with the ticket count - a fixed window height
// either clipped a long list or left dead space below a short one.
ipcMain.on('tray-popover-resize', (event, contentHeight) => {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  popoverHeight = Math.max(120, Math.min(Math.round(contentHeight), 560));
  popoverWindow.setSize(POPOVER_WIDTH, popoverHeight);
  if (popoverWindow.isVisible()) {
    const { x, y } = getPopoverPosition(popoverHeight);
    popoverWindow.setPosition(x, y);
  }
});

// Fetches an attachment image (embedded in a rendered description/comment)
// with the same X-Redmine-API-Key auth as every other request - only for
// URLs that actually resolve to the configured Redmine instance. A
// description can embed a link to any host (pasted from elsewhere); this
// must never attach the API key to a request going somewhere else.
ipcMain.handle('fetch-image', async (event, url) => {
  try {
    const fetchPath = sameInstanceImagePath(url, config.redmineBaseUrl);
    if (fetchPath === null) {
      return { error: 'Image is not on the configured Redmine instance' };
    }
    const { buffer, contentType } = await client.fetchBinary(fetchPath);
    return { ok: true, dataUrl: `data:${contentType};base64,${buffer.toString('base64')}` };
  } catch (err) {
    return { error: err.message };
  }
});
