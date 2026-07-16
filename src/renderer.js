const columns = ['backlog', 'todo', 'in-progress', 'done'];
const AUTO_REFRESH_MS = 60000;

// 'assigned' (default): listMyIssues(), assignee-filtered. 'authored':
// listAuthoredIssues() - for tickets you created but reassigned to
// someone else, which otherwise drop out of the board with no way back.
// Each mode keeps its own localStorage state (and its own local scratch
// cards) so switching doesn't bleed one board's cards into the other.
let boardMode = 'assigned';

function getStateKey() {
  return boardMode === 'authored' ? 'kanban-state-authored' : 'kanban-state';
}

// Populated from the connected Redmine instance's real issue_statuses via
// getColumnMapping() - no hardcoded status ids, this varies per instance.
let columnMapping = { statusIdToColumn: {}, columnToStatusId: {} };

async function loadColumnMapping() {
  columnMapping = await window.reddieAPI.getColumnMapping();
}

// Time-entry activities for the time-log form - fetched once, reused
// across every detail view opened this session.
let activities = [];

async function loadActivities() {
  const result = await window.reddieAPI.fetchActivities();
  activities = (result && result.items) || [];
}

// Issue priorities for the detail view's priority dropdown - fetched once,
// same lifecycle as activities above.
let priorities = [];

async function loadPriorities() {
  const result = await window.reddieAPI.fetchPriorities();
  priorities = (result && result.items) || [];
}

// Issue statuses for resolving status_id in the changelog (see
// journalsHtml) - same instance-wide list openColumnMapping already fetches
// transiently, cached here instead since the changelog needs it on every
// issue detail render, not just when Settings > Column Mapping is open.
let statuses = [];

async function loadStatuses() {
  const result = await window.reddieAPI.fetchStatuses();
  statuses = (result && result.items) || [];
}

// Base URL of the connected Redmine instance - lets the issue modal link
// its ticket ID badge straight to the real ticket instead of just showing
// the number as text.
let redmineBaseUrl = '';

async function loadRedmineBaseUrl() {
  const config = await window.reddieAPI.getConfig();
  redmineBaseUrl = (config && config.redmineBaseUrl || '').replace(/\/+$/, '');
}

// Theme
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('reddie-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  applyTheme(localStorage.getItem('reddie-theme') || 'dark');
}

// Window transparency (macOS vibrancy). Unlike theme, the authoritative
// value lives in main.js's config (it has to be read before createWindow()
// runs - see main.js) rather than localStorage, so this is loaded async
// from getConfig() instead of being ready synchronously at paint time.
let windowTransparencyEnabled = false;

function applyTransparency(enabled) {
  document.documentElement.dataset.transparency = enabled ? 'on' : 'off';
  const btn = document.getElementById('transparency-toggle');
  if (btn) btn.classList.toggle('active', enabled);
}

async function loadWindowTransparencySetting() {
  const config = await window.reddieAPI.getConfig();
  windowTransparencyEnabled = !!config.windowTransparency;
  applyTransparency(windowTransparencyEnabled);
}

async function toggleTransparency() {
  windowTransparencyEnabled = !windowTransparencyEnabled;
  applyTransparency(windowTransparencyEnabled);
  await window.reddieAPI.saveWindowTransparency(windowTransparencyEnabled);
  showToast(
    windowTransparencyEnabled
      ? 'Transparency enabled — restart reddie to apply the window blur'
      : 'Transparency disabled — restart reddie to fully apply',
    'success',
  );
}

// Toasts
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Auto-updater status pushed from main.js (electron-updater events aren't
// a response to any renderer request, so this is a listener, not invoke).
function initUpdateListener() {
  window.reddieAPI.onUpdateStatus((data) => {
    switch (data.status) {
      case 'available':
        openUpdateModal(data.version, data.currentVersion);
        break;
      case 'error':
        showToast(`Update error: ${data.message}`, 'error');
        break;
      // 'checking' and 'not-available' are routine background noise - not
      // worth a toast.
    }
  });
}

function openUpdateModal(newVersion, currentVersion) {
  // Auto-install isn't possible on an unsigned/ad-hoc-signed build (macOS
  // refuses to apply an update without a matching stable code-signing
  // identity, which needs a paid Apple Developer account) - point at the
  // manual download instead of implying it'll just handle itself.
  const versionLine = currentVersion
    ? `Reddie v${newVersion} is available (you have v${currentVersion}).`
    : `Reddie v${newVersion} is available.`;
  document.getElementById('update-modal-body').textContent =
    `${versionLine} Grab it from GitHub Releases and install it manually.`;
  document.getElementById('update-modal').classList.add('show');
}

function closeUpdateModal() {
  document.getElementById('update-modal').classList.remove('show');
}

function openReleasesFromModal() {
  window.reddieAPI.openReleasesPage();
}

async function checkForUpdates() {
  const result = await window.reddieAPI.checkForUpdates();
  if (result && result.error) {
    showToast(result.error, 'error');
  } else {
    showToast('Checking for updates…', 'info');
  }
}

// Connection status
// Mirrored into the tray popover (see updateTrayStatus below) - it has no
// DOM of its own to read '#connection-status' back out of.
let isConnected = false;

function setConnectionStatus(state, text) {
  isConnected = state === 'connected';
  const el = document.getElementById('connection-status');
  el.classList.remove('connected', 'error');
  if (state) el.classList.add(state);
  el.querySelector('.status-text').textContent = text;
}

async function refreshConnectionStatus() {
  setConnectionStatus(null, 'Connecting…');
  try {
    const result = await window.reddieAPI.checkConnection();
    if (result && result.ok) {
      setConnectionStatus('connected', 'Connected');
    } else {
      setConnectionStatus('error', (result && result.error) || 'Disconnected');
    }
  } catch (err) {
    setConnectionStatus('error', 'Disconnected');
  }
}

// Issue detail
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Redmine's description/comment text is Markdown on any modern instance
// (the default text_formatting since Redmine 3.3) - marked.parse() renders
// it, DOMPurify.sanitize() strips anything that shouldn't end up as live
// HTML in the app (script tags, event handler attributes, etc.) before it
// goes into innerHTML. If a specific instance is still configured for
// Textile, this renders the raw source close to as-is (Textile markup
// mostly looks like plain text to a Markdown parser), just without any
// formatting - not a regression from the previous plain-escaped display.
// Body text format. `textFormatSetting` is the user's choice ('auto' |
// 'markdown' | 'textile', from config); `detectedFormat` is what the loaded
// issue bodies look like, used when the setting is 'auto'. Redmine's
// text_formatting is instance-wide and not exposed over REST (see
// text-format.js), so this is the best we can do client-side.
let textFormatSetting = 'auto';
let detectedFormat = 'markdown';
function effectiveTextFormat() {
  return reddieTextFormat.resolveFormat(textFormatSetting, detectedFormat);
}

async function loadTextFormatSetting() {
  const config = await window.reddieAPI.getConfig();
  textFormatSetting = config.textFormat || 'auto';
}

// `attachments` (the issue's attachment list) lets inline image references in
// the body - Markdown `![](name)` or Redmine's Textile `!name!` - be rewritten
// to the real attachment content_url before parsing, so they actually render
// instead of showing as a missing image / literal text (see inline-images.js).
// The body is then rendered with whichever parser matches the instance's
// format and sanitized before it reaches innerHTML.
function renderBody(text, attachments) {
  if (!text) return '';
  const format = effectiveTextFormat();
  // Expand Redmine macros (e.g. {{collapse}}) and resolve inline attachment
  // image refs to real content_urls before the body reaches the parser.
  const expanded = reddieMacros.expandRedmineMacros(text, format);
  const resolved = reddieInlineImages.resolveInlineAttachmentImages(expanded, attachments);
  const html = format === 'textile'
    ? textile.parse(resolved)
    : marked.parse(resolved, { breaks: true });
  return DOMPurify.sanitize(html);
}

// Rendered Markdown images pointing at this Redmine instance's attachments
// need the same X-Redmine-API-Key auth as everything else - a plain <img
// src> can't send that header, so the main process fetches the bytes
// (fetch-image already checks the URL resolves to the configured instance
// before attaching the key - see main.js) and this swaps in a data URL.
// Cached in-memory by URL so re-opening the same issue doesn't refetch
// images it already has. Bounded LRU: each entry is a full base64 data URL
// (~1.33x the raw image bytes), so an unbounded cache would grow without
// limit over a long session. Oldest-inserted entry is evicted past the cap;
// re-inserting a key refreshes its recency (delete-then-set).
const IMAGE_CACHE_MAX = 100;
const imageDataUrlCache = new Map();

function cacheImageDataUrl(src, dataUrl) {
  if (imageDataUrlCache.has(src)) imageDataUrlCache.delete(src);
  imageDataUrlCache.set(src, dataUrl);
  if (imageDataUrlCache.size > IMAGE_CACHE_MAX) {
    imageDataUrlCache.delete(imageDataUrlCache.keys().next().value);
  }
}

async function hydrateAuthenticatedImages(container) {
  const images = Array.from(container.querySelectorAll('img[src]'));
  await Promise.all(images.map(async (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    if (imageDataUrlCache.has(src)) {
      const cached = imageDataUrlCache.get(src);
      cacheImageDataUrl(src, cached); // refresh LRU recency
      img.src = cached;
      return;
    }
    const result = await window.reddieAPI.fetchImage(src);
    if (result && result.ok) {
      cacheImageDataUrl(src, result.dataUrl);
      img.src = result.dataUrl;
    }
    // Not the configured instance (or the fetch failed) - leave the <img>
    // pointing at its original src; the browser will just try to load it
    // unauthenticated like any normal external image link.
  }));
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function renderIssueDetail(issue, timeEntries, members) {
  currentDetailSubject = issue.subject || `Issue #${issue.id}`;
  document.getElementById('detail-subject').textContent = currentDetailSubject;
  currentDetailDescription = issue.description || '';

  // The current assignee might not hold project membership anymore (left
  // the project, role revoked) - keep them selectable anyway so the
  // dropdown reflects reality instead of silently jumping to "Unassigned".
  const memberOptions = [...(members || [])];
  if (issue.assigned_to && !memberOptions.some(m => m.id === issue.assigned_to.id)) {
    memberOptions.unshift(issue.assigned_to);
  }
  const assigneeOptionsHtml = [
    `<option value="">Unassigned</option>`,
    ...memberOptions.map(m => `<option value="${m.id}" ${issue.assigned_to && issue.assigned_to.id === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`),
  ].join('');

  const journalsHtml = (issue.journals || [])
    .filter(j => j.notes || (j.details && j.details.length))
    .map(j => {
      const detailsHtml = (j.details || []).map(d => `<div class="journal-detail-line">${journalDetailLine(d)}</div>`).join('');
      return `
      <div class="journal-entry">
        <div class="journal-meta">
          <strong>${escapeHtml((j.user && j.user.name) || 'Unknown')}</strong>
          <span class="journal-date">${formatDateTime(j.created_on)}</span>
        </div>
        ${detailsHtml}
        ${j.notes ? `<div class="journal-notes markdown-body">${renderBody(j.notes, issue.attachments)}</div>` : ''}
      </div>
    `;
    }).join('') || '<div class="detail-empty">No activity yet.</div>';

  const timeEntriesHtml = (timeEntries || [])
    .map(t => `
      <div class="time-entry-row">
        <span>${t.hours}h — ${escapeHtml((t.activity && t.activity.name) || 'Activity')}</span>
        <span class="journal-date">${formatDate(t.spent_on)}${t.user && t.user.name ? ' · ' + escapeHtml(t.user.name) : ''}</span>
      </div>
    `).join('') || '<div class="detail-empty">No time logged.</div>';
  const totalHours = (timeEntries || []).reduce((sum, t) => sum + (t.hours || 0), 0);

  const attachmentsHtml = (issue.attachments || [])
    .map(a => `<div class="attachment-row">📎 ${escapeHtml(a.filename)} <span class="journal-date">(${Math.round((a.filesize || 0) / 1024)} KB)</span></div>`)
    .join('') || '<div class="detail-empty">No attachments.</div>';

  // issue.parent is always present by default when set; issue.children
  // needs the explicit ?include=children (getIssueDetail requests it) -
  // only rendered if there's actually a relation, no empty section header
  // for the common case of a standalone ticket.
  const subtasksHtml = [
    issue.parent ? `<div class="subtask-row">↑ <span class="issue-id-link" onclick="openIssueDetail('${issue.parent.id}')">#${issue.parent.id}</span></div>` : '',
    ...(issue.children || []).map(c => `<div class="subtask-row">↳ <span class="issue-id-link" onclick="openIssueDetail('${c.id}')">#${c.id}</span> ${escapeHtml(c.subject)}</div>`),
    // Redmine reports relation_type from the issue_id ("from") side - flip
    // to the inverse label (RELATION_LABELS_INVERSE) when this issue is the
    // issue_to_id side, so "blocks" reads as "blocked by" from that end
    // instead of implying this issue blocks the other one.
    ...(issue.relations || []).map(r => {
      const isFrom = String(r.issue_id) === String(issue.id);
      const otherId = isFrom ? r.issue_to_id : r.issue_id;
      const label = (isFrom ? RELATION_LABELS : RELATION_LABELS_INVERSE)[r.relation_type] || r.relation_type;
      return `<div class="subtask-row">${escapeHtml(label)} <span class="issue-id-link" onclick="openIssueDetail('${otherId}')">#${otherId}</span></div>`;
    }),
  ].join('');

  // Most custom fields are blank on most tickets - only show ones that
  // actually have a value, same reasoning as the sub-tasks section above.
  const customFieldsHtml = (issue.custom_fields || [])
    .filter(f => f.value != null && f.value !== '' && !(Array.isArray(f.value) && f.value.length === 0))
    .map(f => `<div class="custom-field-row"><strong>${escapeHtml(f.name)}</strong> ${escapeHtml(Array.isArray(f.value) ? f.value.join(', ') : String(f.value))}</div>`)
    .join('');

  // The current priority might be inactive/retired (still a legal value
  // for an existing issue even after an admin disables it going forward)
  // - keep it selectable anyway, same reasoning as the assignee dropdown.
  const priorityOptions = [...priorities];
  if (issue.priority && !priorityOptions.some(p => p.id === issue.priority.id)) {
    priorityOptions.unshift(issue.priority);
  }
  const priorityOptionsHtml = priorityOptions
    .map(p => `<option value="${p.id}" ${issue.priority && issue.priority.id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  // Same "keep the current value selectable even if it's not in the
  // project's live list" reasoning as priorityOptions above - a ticket can
  // carry a tracker/category that's since been disabled for this project.
  const trackerOptions = [...currentDetailTrackers];
  if (issue.tracker && !trackerOptions.some(t => t.id === issue.tracker.id)) {
    trackerOptions.unshift(issue.tracker);
  }
  const trackerOptionsHtml = trackerOptions
    .map(t => `<option value="${t.id}" ${issue.tracker && issue.tracker.id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
    .join('');

  // Unlike tracker, category is optional on a Redmine issue - the empty
  // option clears it (changeIssueField sends '', which Redmine treats as
  // clear, same as the date fields).
  const categoryOptions = [...currentDetailCategories];
  if (issue.category && !categoryOptions.some(c => c.id === issue.category.id)) {
    categoryOptions.unshift(issue.category);
  }
  const categoryOptionsHtml = [
    `<option value="">—</option>`,
    ...categoryOptions.map(c => `<option value="${c.id}" ${issue.category && issue.category.id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`),
  ].join('');

  // Target version - Redmine's field is `fixed_version` on the issue,
  // `fixed_version_id` on PUT. Optional, same clear-via-empty-string
  // handling as category.
  const versionOptions = [...currentDetailVersions];
  if (issue.fixed_version && !versionOptions.some(v => v.id === issue.fixed_version.id)) {
    versionOptions.unshift(issue.fixed_version);
  }
  const versionOptionsHtml = [
    `<option value="">—</option>`,
    ...versionOptions.map(v => `<option value="${v.id}" ${issue.fixed_version && issue.fixed_version.id === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`),
  ].join('');

  // Falls back to plain text if the base URL isn't loaded yet - href
  // navigation away from index.html is caught by main.js's will-navigate
  // handler and routed to the OS browser, same as rendered body links.
  const idBadgeHtml = redmineBaseUrl
    ? `<a href="${escapeHtml(redmineBaseUrl)}/issues/${issue.id}" class="detail-badge detail-badge-link">#${issue.id}</a>`
    : `<span class="detail-badge">#${issue.id}</span>`;

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-badges">
      ${idBadgeHtml}
      <span class="detail-badge">${escapeHtml((issue.status && issue.status.name) || '—')}</span>
    </div>
    <div class="detail-meta">
      <div><strong>Project</strong> ${escapeHtml((issue.project && issue.project.name) || '—')}</div>
      <div><strong>Assignee</strong> <select id="assignee-select" class="assignee-select" onchange="changeAssignee(this.value)">${assigneeOptionsHtml}</select></div>
      <div><strong>Priority</strong> <select id="priority-select" class="assignee-select" onchange="changePriority(this.value)">${priorityOptionsHtml}</select></div>
      <div><strong>Tracker</strong> <select id="tracker-select" class="assignee-select" onchange="changeIssueField('tracker_id', Number(this.value))">${trackerOptionsHtml}</select></div>
      <div><strong>Category</strong> <select id="category-select" class="assignee-select" onchange="changeIssueField('category_id', this.value === '' ? '' : Number(this.value))">${categoryOptionsHtml}</select></div>
      <div><strong>Target version</strong> <select id="version-select" class="assignee-select" onchange="changeIssueField('fixed_version_id', this.value === '' ? '' : Number(this.value))">${versionOptionsHtml}</select></div>
      <div><strong>Author</strong> ${escapeHtml((issue.author && issue.author.name) || '—')}</div>
      <div><strong>Start</strong> <input type="date" id="start-date-input" class="assignee-select" value="${issue.start_date || ''}" onchange="changeIssueField('start_date', this.value)"></div>
      <div><strong>Due</strong> <input type="date" id="due-date-input" class="assignee-select" value="${issue.due_date || ''}" onchange="changeIssueField('due_date', this.value)"></div>
      <div><strong>% Done</strong> <input type="number" id="done-ratio-input" class="assignee-select" min="0" max="100" step="1" value="${issue.done_ratio != null ? issue.done_ratio : 0}" onchange="changeIssueField('done_ratio', this.value === '' ? 0 : Number(this.value))"></div>
      <div><strong>Estimation (h)</strong> <input type="number" id="estimated-hours-input" class="assignee-select" min="0" step="0.25" placeholder="—" value="${issue.estimated_hours != null ? issue.estimated_hours : ''}" onchange="changeIssueField('estimated_hours', this.value === '' ? '' : Number(this.value))"></div>
    </div>
    <div class="detail-section">
      <h3>Description</h3>
      <div class="detail-description markdown-body" id="description-display" onclick="editDescription()">${issue.description ? renderBody(issue.description, issue.attachments) : '<span class="detail-empty">No description. Click to add one.</span>'}</div>
      <textarea id="description-input" class="description-textarea" style="display:none" onblur="saveDescriptionEdit()"></textarea>
    </div>
    ${subtasksHtml ? `<div class="detail-section"><h3>Related tickets</h3>${subtasksHtml}</div>` : ''}
    ${customFieldsHtml ? `<div class="detail-section"><h3>Custom fields</h3>${customFieldsHtml}</div>` : ''}
    <div class="detail-section">
      <h3>Time logged${totalHours ? ` — ${totalHours}h total` : ''}</h3>
      <div id="timer-widget" class="timer-widget"></div>
      ${timeEntriesHtml}
      <div class="timelog-form">
        <input type="number" id="timelog-hours" class="timelog-hours" placeholder="Hours" min="0.01" max="24" step="0.25">
        <select id="timelog-activity" class="timelog-activity">
          ${activities.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <input type="text" id="timelog-comment" class="timelog-comment" placeholder="Comment (optional)">
        <button id="timelog-submit-btn" class="timelog-submit-btn" onclick="submitTimelog()">Log time</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>Attachments</h3>
      ${attachmentsHtml}
      <button id="attachment-upload-btn" class="secondary-btn" onclick="uploadAttachment()">Attach file…</button>
    </div>
    <div class="detail-section">
      <h3>Activity</h3>
      ${journalsHtml}
    </div>
  `;

  hydrateAuthenticatedImages(document.getElementById('detail-body'));
  renderTimerWidget();
}

let currentDetailIssueId = null;
// Cached alongside the open issue so comment/timelog refreshes don't need
// to re-fetch the project's member list just to re-render the same
// assignee dropdown.
let currentDetailMembers = [];
// Same lifecycle as currentDetailMembers, for the tracker/category/version dropdowns.
let currentDetailTrackers = [];
let currentDetailCategories = [];
let currentDetailVersions = [];
// The subject as last loaded from Redmine - lets the blur handler on
// #detail-subject skip a no-op PUT when focus just left the field without
// an actual edit.
let currentDetailSubject = null;
// Raw markdown source of the open issue's description - #description-display
// only ever holds the *rendered* HTML, so editing needs the source stashed
// separately (same reasoning as currentDetailSubject above).
let currentDetailDescription = null;

// SHA-24 time tracker. One active timer app-wide, held in main.js
// (reddieTimer's pure state shape) - mirrored here so the widget can render
// without an IPC round trip on every tick. `timerTickInterval` repaints the
// elapsed display locally once a second while running; main.js only pushes a
// fresh state on an actual transition (start/pause/reset/cancel/complete),
// not every second.
let currentTimerState = reddieTimer.initialTimerState();
let timerTickInterval = null;

async function openIssueDetail(issueId) {
  currentDetailIssueId = issueId;
  document.getElementById('issue-detail-modal').classList.add('show');
  document.getElementById('detail-subject').textContent = 'Loading…';
  document.getElementById('detail-body').innerHTML = '<div class="detail-loading">Loading…</div>';
  document.getElementById('comment-input').value = '';

  const result = await window.reddieAPI.fetchIssueDetail(issueId);
  if (!result || result.error || !result.issue) {
    document.getElementById('detail-subject').textContent = 'Error';
    document.getElementById('detail-body').innerHTML = `<div class="detail-empty">${escapeHtml((result && result.error) || 'Failed to load issue.')}</div>`;
    return;
  }

  const projectId = result.issue.project && result.issue.project.id;
  const [membersResult, trackersResult, categoriesResult, versionsResult] = projectId
    ? await Promise.all([
        window.reddieAPI.fetchProjectMembers(projectId),
        window.reddieAPI.fetchProjectTrackers(projectId),
        window.reddieAPI.fetchProjectCategories(projectId),
        window.reddieAPI.fetchProjectVersions(projectId),
      ])
    : [{ items: [] }, { items: [] }, { items: [] }, { items: [] }];
  currentDetailMembers = (membersResult && membersResult.items) || [];
  currentDetailTrackers = (trackersResult && trackersResult.items) || [];
  currentDetailCategories = (categoriesResult && categoriesResult.items) || [];
  currentDetailVersions = (versionsResult && versionsResult.items) || [];
  renderIssueDetail(result.issue, result.timeEntries, currentDetailMembers);
}

async function changeAssignee(value) {
  if (!currentDetailIssueId) return;
  const select = document.getElementById('assignee-select');
  const userId = value ? Number(value) : null;
  select.disabled = true;
  try {
    const result = await window.reddieAPI.updateAssignee(currentDetailIssueId, userId);
    if (result && result.error) {
      throw new Error(result.error);
    }
    showToast('Assignee updated', 'success');
    await loadFromAPI();
  } catch (err) {
    showToast(`Couldn't update assignee: ${err.message || err}`, 'error');
    // Re-load the detail view so the dropdown reflects the real current
    // assignee rather than whatever the failed selection left it showing.
    await openIssueDetail(currentDetailIssueId);
  } finally {
    if (select) select.disabled = false;
  }
}

async function changePriority(value) {
  if (!currentDetailIssueId) return;
  const select = document.getElementById('priority-select');
  const priorityId = Number(value);
  select.disabled = true;
  try {
    const result = await window.reddieAPI.updatePriority(currentDetailIssueId, priorityId);
    if (result && result.error) {
      throw new Error(result.error);
    }
    showToast('Priority updated', 'success');
  } catch (err) {
    showToast(`Couldn't update priority: ${err.message || err}`, 'error');
    await openIssueDetail(currentDetailIssueId);
  } finally {
    if (select) select.disabled = false;
  }
}

// Shared by the start/due date, % done, and estimation inputs - each is a
// single-field PUT via the generic updateIssue endpoint, same pattern as
// changePriority/changeAssignee above.
async function changeIssueField(field, value) {
  if (!currentDetailIssueId) return;
  try {
    const result = await window.reddieAPI.updateIssue(currentDetailIssueId, { [field]: value });
    if (result && result.error) {
      throw new Error(result.error);
    }
    showToast('Issue updated', 'success');
  } catch (err) {
    showToast(`Couldn't update issue: ${err.message || err}`, 'error');
    await openIssueDetail(currentDetailIssueId);
  }
}

function editDescription() {
  const display = document.getElementById('description-display');
  const input = document.getElementById('description-input');
  if (!display || !input) return;
  input.value = currentDetailDescription;
  display.style.display = 'none';
  input.style.display = 'block';
  input.focus();
}

async function saveDescriptionEdit() {
  if (!currentDetailIssueId) return;
  const display = document.getElementById('description-display');
  const input = document.getElementById('description-input');
  const description = input.value.trim();
  input.style.display = 'none';
  display.style.display = 'block';
  if (description === currentDetailDescription) return;
  try {
    const result = await window.reddieAPI.updateIssue(currentDetailIssueId, { description });
    if (result && result.error) {
      throw new Error(result.error);
    }
    currentDetailDescription = description;
    showToast('Description updated', 'success');
    await openIssueDetail(currentDetailIssueId);
  } catch (err) {
    showToast(`Couldn't update description: ${err.message || err}`, 'error');
    await openIssueDetail(currentDetailIssueId);
  }
}

async function uploadAttachment() {
  if (!currentDetailIssueId) return;
  const btn = document.getElementById('attachment-upload-btn');
  const issueId = currentDetailIssueId;
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const result = await window.reddieAPI.uploadAttachment(issueId);
    if (result && result.canceled) {
      return;
    }
    if (result && result.error) {
      throw new Error(result.error);
    }
    showToast(`${result.filename} attached`, 'success');
    const refreshed = await window.reddieAPI.fetchIssueDetail(issueId);
    if (refreshed && !refreshed.error && refreshed.issue) {
      renderIssueDetail(refreshed.issue, refreshed.timeEntries, currentDetailMembers);
    }
  } catch (err) {
    showToast(`Couldn't attach file: ${err.message || err}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Attach file…';
    }
  }
}

function closeIssueDetail() {
  document.getElementById('issue-detail-modal').classList.remove('show');
  currentDetailIssueId = null;
  currentDetailMembers = [];
  currentDetailSubject = null;
  currentDetailDescription = null;
  stopTimerTick();
}

function stopTimerTick() {
  if (timerTickInterval) {
    clearInterval(timerTickInterval);
    timerTickInterval = null;
  }
}

// Renders the timer widget for whichever ticket is open in the detail view.
// Three cases: no timer running anywhere (offer Start), a timer running for
// THIS ticket (Pause/Resume/Reset/Cancel/Complete), or a timer running for a
// DIFFERENT ticket (can't start a second one - offer to go finish it, or
// discard it and start here instead).
function renderTimerWidget() {
  const el = document.getElementById('timer-widget');
  if (!el) return; // detail view not open, or a re-render raced a close
  stopTimerTick();

  if (currentTimerState.status === 'idle') {
    el.innerHTML = `<button class="secondary-btn" onclick="startTimerHere()">▶ Start timer</button>`;
    return;
  }

  const mine = String(currentTimerState.ticketId) === String(currentDetailIssueId);
  if (!mine) {
    el.innerHTML = `
      <div class="timer-other-note">
        Timer running for <span class="issue-id-link" onclick="openIssueDetail('${currentTimerState.ticketId}')">#${currentTimerState.ticketId}</span>
        <span id="timer-other-elapsed" class="timer-elapsed"></span>
        <button class="secondary-btn" onclick="discardOtherTimerAndStartHere()">Discard it & start here</button>
      </div>`;
    const paint = () => {
      const span = document.getElementById('timer-other-elapsed');
      if (span) span.textContent = reddieTimer.formatElapsed(reddieTimer.elapsedMs(currentTimerState, Date.now()));
    };
    paint();
    timerTickInterval = setInterval(paint, 1000);
    return;
  }

  const running = currentTimerState.status === 'running';
  el.innerHTML = `
    <div class="timer-active">
      <span id="timer-mine-elapsed" class="timer-elapsed"></span>
      ${running
        ? `<button class="secondary-btn" onclick="pauseTimerHere()">⏸ Pause</button>`
        : `<button class="secondary-btn" onclick="startTimerHere()">▶ Resume</button>`}
      <button class="secondary-btn" onclick="resetTimerHere()">↺ Reset</button>
      <button class="secondary-btn" onclick="cancelTimerHere()">✕ Cancel</button>
      <select id="timer-complete-activity" class="timelog-activity">
        ${activities.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
      </select>
      <button class="timelog-submit-btn" onclick="completeTimerHere()">✓ Complete</button>
    </div>`;
  const paint = () => {
    const span = document.getElementById('timer-mine-elapsed');
    if (span) span.textContent = reddieTimer.formatElapsed(reddieTimer.elapsedMs(currentTimerState, Date.now()));
  };
  paint();
  if (running) timerTickInterval = setInterval(paint, 1000);
}

function applyTimerResult(result) {
  if (result && result.error) {
    showToast(result.error, 'error');
    return false;
  }
  currentTimerState = result.state;
  renderTimerWidget();
  return true;
}

async function startTimerHere() {
  const result = await window.reddieAPI.startTimer(currentDetailIssueId, currentDetailSubject);
  applyTimerResult(result);
}

async function pauseTimerHere() {
  applyTimerResult(await window.reddieAPI.pauseTimer());
}

async function resetTimerHere() {
  applyTimerResult(await window.reddieAPI.resetTimer());
}

async function cancelTimerHere() {
  applyTimerResult(await window.reddieAPI.cancelTimer());
}

async function discardOtherTimerAndStartHere() {
  await window.reddieAPI.cancelTimer();
  await startTimerHere();
}

async function completeTimerHere() {
  const activitySelect = document.getElementById('timer-complete-activity');
  const activityId = activitySelect ? parseInt(activitySelect.value, 10) : null;
  if (!activityId) {
    showToast('No activity selected', 'error');
    return;
  }
  const result = await window.reddieAPI.completeTimer(activityId);
  if (!applyTimerResult(result)) return;
  showToast(`Logged ${result.hours}h`, 'success');
  const issueId = currentDetailIssueId;
  if (!issueId) return;
  const refreshed = await window.reddieAPI.fetchIssueDetail(issueId);
  if (refreshed && !refreshed.error && refreshed.issue) {
    renderIssueDetail(refreshed.issue, refreshed.timeEntries, currentDetailMembers);
  }
}

async function saveSubjectEdit() {
  if (!currentDetailIssueId) return;
  const el = document.getElementById('detail-subject');
  const subject = el.textContent.trim();
  if (subject === currentDetailSubject) return;
  if (!subject) {
    showToast('Subject cannot be empty', 'error');
    el.textContent = currentDetailSubject;
    return;
  }
  try {
    const result = await window.reddieAPI.updateSubject(currentDetailIssueId, subject);
    if (result && result.error) {
      throw new Error(result.error);
    }
    currentDetailSubject = subject;
    showToast('Subject updated', 'success');
    await loadFromAPI();
  } catch (err) {
    showToast(`Couldn't update subject: ${err.message || err}`, 'error');
    el.textContent = currentDetailSubject;
  }
}

async function postComment() {
  const input = document.getElementById('comment-input');
  const btn = document.getElementById('comment-submit-btn');
  const comment = input.value.trim();
  if (!comment || !currentDetailIssueId) return;

  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const result = await window.reddieAPI.addComment(currentDetailIssueId, comment);
    if (result && result.error) {
      showToast(`Couldn't post comment: ${result.error}`, 'error');
      return;
    }
    input.value = '';
    showToast('Comment posted', 'success');
    // Re-fetch so the new comment shows up in the activity list
    const issueId = currentDetailIssueId;
    const refreshed = await window.reddieAPI.fetchIssueDetail(issueId);
    if (refreshed && !refreshed.error && refreshed.issue) {
      renderIssueDetail(refreshed.issue, refreshed.timeEntries, currentDetailMembers);
    }
  } catch (err) {
    showToast(`Couldn't post comment: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Post comment';
  }
}

async function submitTimelog() {
  if (!currentDetailIssueId) return;
  const hoursInput = document.getElementById('timelog-hours');
  const activitySelect = document.getElementById('timelog-activity');
  const commentInput = document.getElementById('timelog-comment');
  const btn = document.getElementById('timelog-submit-btn');

  const hours = parseFloat(hoursInput.value);
  const activityId = parseInt(activitySelect.value, 10);
  if (!hours || hours <= 0) {
    showToast('Enter hours to log', 'error');
    return;
  }
  if (!activityId) {
    showToast('No activity selected', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging…';
  try {
    const result = await window.reddieAPI.addTimelog(currentDetailIssueId, {
      hours,
      activityId,
      comment: commentInput.value.trim(),
    });
    if (result && result.error) {
      showToast(`Couldn't log time: ${result.error}`, 'error');
      return;
    }
    showToast('Time logged', 'success');
    const issueId = currentDetailIssueId;
    const refreshed = await window.reddieAPI.fetchIssueDetail(issueId);
    if (refreshed && !refreshed.error && refreshed.issue) {
      renderIssueDetail(refreshed.issue, refreshed.timeEntries, currentDetailMembers);
    }
  } catch (err) {
    showToast(`Couldn't log time: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Log time';
  }
}

// Settings
function openSettings() {
  document.getElementById('settings-modal').classList.add('show');
  window.reddieAPI.getConfig().then(config => {
    document.getElementById('redmine-base').value = config.redmineBaseUrl || 'https://redmine.nasctech.com';
    document.getElementById('redmine-api-key').value = config.redmineApiKey || '';
    document.getElementById('text-format').value = config.textFormat || 'auto';
  });
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('show');
}

// Column mapping
const COLUMN_LABELS = { backlog: 'Backlog', todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };

// Issue relation types (relates/duplicates/blocks/precedes/follows/
// copied_to, plus each one's inverse) - Redmine always reports relation_type
// from the issue_id ("from") side, so the inverse map is needed when
// rendering from the issue_to_id side (see subtasksHtml below).
const RELATION_LABELS = {
  relates: 'relates to',
  duplicates: 'duplicates',
  duplicated: 'duplicated by',
  blocks: 'blocks',
  blocked: 'blocked by',
  precedes: 'precedes',
  follows: 'follows',
  copied_to: 'copied to',
  copied_from: 'copied from',
};
const RELATION_LABELS_INVERSE = {
  relates: 'relates to',
  duplicates: 'duplicated by',
  duplicated: 'duplicates',
  blocks: 'blocked by',
  blocked: 'blocks',
  precedes: 'follows',
  follows: 'precedes',
  copied_to: 'copied from',
  copied_from: 'copied to',
};

// Full changelog (journal.details) support - Redmine ships old_value/
// new_value as raw IDs for reference fields, so anything reddie already has
// a name lookup for (status/priority/current project's members) gets
// resolved; everything else falls back to the raw value rather than
// dropping the entry.
const JOURNAL_FIELD_LABELS = {
  status_id: 'Status',
  priority_id: 'Priority',
  assigned_to_id: 'Assignee',
  tracker_id: 'Tracker',
  category_id: 'Category',
  parent_id: 'Parent',
  subject: 'Subject',
  description: 'Description',
  start_date: 'Start date',
  due_date: 'Due date',
  done_ratio: '% Done',
  estimated_hours: 'Estimation',
  is_private: 'Private',
  fixed_version_id: 'Target version',
};

function resolveJournalValue(name, value) {
  if (value == null || value === '') return '—';
  if (name === 'status_id') {
    const s = statuses.find(s => String(s.id) === String(value));
    return s ? s.name : `#${value}`;
  }
  if (name === 'priority_id') {
    const p = priorities.find(p => String(p.id) === String(value));
    return p ? p.name : `#${value}`;
  }
  if (name === 'assigned_to_id') {
    // Only resolves against the currently open issue's project members -
    // an old assignee who's since left the project falls back to the ID,
    // same tradeoff as the assignee dropdown elsewhere in this view.
    const m = currentDetailMembers.find(m => String(m.id) === String(value));
    return m ? m.name : `user #${value}`;
  }
  if (name === 'tracker_id') {
    const t = currentDetailTrackers.find(t => String(t.id) === String(value));
    return t ? t.name : `#${value}`;
  }
  if (name === 'category_id') {
    const c = currentDetailCategories.find(c => String(c.id) === String(value));
    return c ? c.name : `#${value}`;
  }
  if (name === 'fixed_version_id') {
    const v = currentDetailVersions.find(v => String(v.id) === String(value));
    return v ? v.name : `#${value}`;
  }
  if (name === 'is_private') return value === '1' || value === 'true' || value === true ? 'Yes' : 'No';
  return String(value);
}

// journal.details entries aren't all attribute changes (property can also
// be 'attachment', 'relation', or 'cf' for a custom field) - those don't
// have a human-friendly name lookup available client-side, so they render
// with their raw property name rather than being silently dropped.
function journalDetailLine(d) {
  const label = JOURNAL_FIELD_LABELS[d.name] || d.name;
  if (d.property !== 'attr') {
    return escapeHtml(`${label} changed`);
  }
  if (d.name === 'description') {
    return escapeHtml(`${label} updated`);
  }
  return `${escapeHtml(label)}: ${escapeHtml(resolveJournalValue(d.name, d.old_value))} → ${escapeHtml(resolveJournalValue(d.name, d.new_value))}`;
}

async function openColumnMapping() {
  document.getElementById('column-mapping-modal').classList.add('show');
  document.getElementById('column-mapping-body').innerHTML = '<div class="detail-loading">Loading…</div>';

  const [statusesResult, mapping] = await Promise.all([
    window.reddieAPI.fetchStatuses(),
    window.reddieAPI.getColumnMapping(),
  ]);
  const statuses = (statusesResult && statusesResult.items) || [];

  if (!statuses.length) {
    document.getElementById('column-mapping-body').innerHTML =
      '<div class="detail-empty">Connect to a Redmine instance first to load its statuses.</div>';
    return;
  }

  const rowsHtml = statuses
    .slice()
    .sort((a, b) => a.id - b.id)
    .map(status => {
      const current = (mapping && mapping.statusIdToColumn[status.id]) || 'backlog';
      const options = columns
        .map(col => `<option value="${col}" ${col === current ? 'selected' : ''}>${COLUMN_LABELS[col]}</option>`)
        .join('');
      return `
        <div class="mapping-row" data-status-id="${status.id}">
          <span class="mapping-status-name">${escapeHtml(status.name)}</span>
          <select class="mapping-select">${options}</select>
        </div>
      `;
    })
    .join('');

  document.getElementById('column-mapping-body').innerHTML = `<div class="mapping-list">${rowsHtml}</div>`;
}

function closeColumnMapping() {
  document.getElementById('column-mapping-modal').classList.remove('show');
}

async function openNewTicket() {
  document.getElementById('new-ticket-modal').classList.add('show');
  document.getElementById('new-ticket-subject').value = '';
  document.getElementById('new-ticket-description').value = '';

  const projectSelect = document.getElementById('new-ticket-project');
  projectSelect.innerHTML = '<option>Loading…</option>';
  const projectsResult = await window.reddieAPI.fetchProjects();
  const projects = (projectsResult && projectsResult.items) || [];
  if (!projects.length) {
    projectSelect.innerHTML = '<option>No projects available</option>';
    document.getElementById('new-ticket-tracker').innerHTML = '';
    return;
  }
  projectSelect.innerHTML = projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  await loadNewTicketTrackers();
}

async function loadNewTicketTrackers() {
  const projectId = document.getElementById('new-ticket-project').value;
  const trackerSelect = document.getElementById('new-ticket-tracker');
  trackerSelect.innerHTML = '<option>Loading…</option>';
  document.getElementById('new-ticket-custom-fields').innerHTML = '';
  if (!projectId) return;

  const result = await window.reddieAPI.fetchProjectTrackers(projectId);
  const trackers = (result && result.items) || [];
  trackerSelect.innerHTML = trackers.length
    ? trackers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
    : '<option>No trackers enabled on this project</option>';
  if (trackers.length) await loadNewTicketCustomFields();
}

async function loadNewTicketCustomFields() {
  const projectId = document.getElementById('new-ticket-project').value;
  const trackerId = document.getElementById('new-ticket-tracker').value;
  const container = document.getElementById('new-ticket-custom-fields');
  container.innerHTML = '';
  if (!projectId || !trackerId) return;

  // No admin-only /custom_fields.json access from a regular API key, so
  // this only knows a field exists (id/name) by finding it on a sample
  // existing issue of the same project+tracker - no format/required-ness/
  // possible_values, hence plain text inputs only. If nothing of this
  // pairing exists yet to sample, the form just won't offer any (Redmine's
  // own validation error still surfaces on submit if one was required).
  const result = await window.reddieAPI.fetchTrackerCustomFields(projectId, trackerId);
  const fields = (result && result.items) || [];
  container.innerHTML = fields.map(f => `
    <div class="form-group">
      <label>${escapeHtml(f.name)}</label>
      <input type="text" class="new-ticket-custom-field" data-field-id="${f.id}" placeholder="${escapeHtml(f.value || '')}">
    </div>
  `).join('');
}

function closeNewTicket() {
  document.getElementById('new-ticket-modal').classList.remove('show');
}

async function submitNewTicket() {
  const projectId = document.getElementById('new-ticket-project').value;
  const trackerId = document.getElementById('new-ticket-tracker').value;
  const subject = document.getElementById('new-ticket-subject').value.trim();
  const description = document.getElementById('new-ticket-description').value.trim();
  const btn = document.getElementById('new-ticket-submit-btn');

  if (!projectId || !trackerId) {
    showToast('Pick a project and tracker', 'error');
    return;
  }
  if (!subject) {
    showToast('Enter a subject', 'error');
    return;
  }

  const customFields = Array.from(document.querySelectorAll('.new-ticket-custom-field'))
    .filter(input => input.value.trim())
    .map(input => ({ id: Number(input.dataset.fieldId), value: input.value.trim() }));

  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const result = await window.reddieAPI.createIssue({ projectId, trackerId, subject, description, customFields });
    if (result && result.error) {
      throw new Error(result.error);
    }
    showToast(`#${result.issue.id} created`, 'success');
    closeNewTicket();
    await loadFromAPI();
  } catch (err) {
    showToast(`Couldn't create ticket: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create';
  }
}

async function saveColumnMappingOverrides() {
  const btn = document.getElementById('column-mapping-save-btn');
  const rows = document.querySelectorAll('#column-mapping-body .mapping-row');
  const overrides = {};
  rows.forEach(row => {
    const statusId = row.dataset.statusId;
    const select = row.querySelector('.mapping-select');
    overrides[statusId] = select.value;
  });

  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await window.reddieAPI.saveColumnOverrides(overrides);
    await loadColumnMapping();
    showToast('Column mapping saved', 'success');
    closeColumnMapping();
    await loadFromAPI();
  } catch (err) {
    showToast(`Couldn't save mapping: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save mapping';
  }
}

async function saveSettings() {
  const newConfig = {
    redmineBaseUrl: document.getElementById('redmine-base').value,
    redmineApiKey: document.getElementById('redmine-api-key').value,
    textFormat: document.getElementById('text-format').value
  };

  // Save to main process
  const result = await window.reddieAPI.saveConfig(newConfig);
  textFormatSetting = newConfig.textFormat || 'auto';

  if (result.error) {
    setConnectionStatus('error', result.error);
    alert('Error: ' + result.error);
  } else {
    setConnectionStatus('connected', 'Connected');
    // main.js persists this itself now (config-store.js, encrypted via
    // safeStorage) - no localStorage cache needed here.
    closeSettings();
    // Reload issues (column mapping/activities may differ on a different Redmine instance)
    await loadColumnMapping();
    await loadActivities();
    await loadPriorities();
    await loadStatuses();
    await loadRedmineBaseUrl();
    await loadFromAPI();
  }
}

function getColumnFromStatus(status) {
  if (!status) return 'backlog';
  const id = status.id;
  return columnMapping.statusIdToColumn[id] || 'backlog';
}

function getStatusId(column) {
  return columnMapping.columnToStatusId[column] || columnMapping.columnToStatusId.backlog;
}

let isDragging = false;

function initSortable() {
  columns.forEach(id => {
    const el = document.getElementById(`${id}-list`);
    new Sortable(el, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onStart: () => { isDragging = true; },
      onEnd: (evt) => {
        isDragging = false;
        const itemEl = evt.item;
        const newColumn = evt.to.id.replace('-list', '');
        const oldColumn = evt.from.id.replace('-list', '');

        if (newColumn !== oldColumn && itemEl.dataset.issueId) {
          const statusId = getStatusId(newColumn);
          const oldList = evt.from;
          const oldIndex = evt.oldIndex;
          window.reddieAPI.updateStatus(itemEl.dataset.issueId, statusId)
            .then((result) => {
              // apiRequest resolves with the parsed body regardless of HTTP
              // status, so a rejected transition (e.g. 400) lands here too,
              // not in .catch() - check for an error field explicitly.
              if (result && result.error) {
                throw new Error(result.error);
              }
              // Our own drag, not a remote move - update the tracker so the
              // next auto-refresh diff doesn't fire a false notification.
              const issueId = itemEl.dataset.issueId;
              const prevSubject = (knownIssueColumns[issueId] && knownIssueColumns[issueId].subject)
                || itemEl.querySelector('.task-content').innerText;
              knownIssueColumns[issueId] = { column: newColumn, subject: prevSubject };
              saveState();
            })
            .catch((err) => {
              // revert the card to where it was - the backend didn't apply
              // the move, so the board shouldn't claim it did
              const referenceNode = oldList.children[oldIndex] || null;
              oldList.insertBefore(itemEl, referenceNode);
              saveState();
              showToast(`Couldn't update status: ${err.message || err}`, 'error');
            });
        } else {
          saveState();
        }
      }
    });
  });
}

function createTaskCard(id, content, issueId = null) {
  const card = document.createElement('div');
  card.className = issueId ? 'task-card' : 'task-card local-card';
  card.id = `task-${id}`;
  if (issueId) card.dataset.issueId = issueId;
  // Real tickets' subject only edits from the ticket detail view now (goes
  // through updateSubject -> Redmine); editing it on the card used to be
  // purely cosmetic since loadFromAPI() overwrites it with the real value
  // on the very next refresh anyway. Local scratch cards have no detail
  // view at all, so inline editing stays their only way to rename.
  const contentAttrs = issueId ? '' : ' contenteditable="true" onblur="saveState()"';
  card.innerHTML = `
    ${issueId ? `<div class="task-id-badge" onclick="openIssueDetail('${issueId}')" title="View details">#${issueId}</div>` : ''}
    <div class="task-content"${contentAttrs}>${content}</div>
    <div class="task-actions">
      ${!issueId ? `<span class="local-badge" title="Personal card, not synced to Redmine">Local</span>` : ''}
      ${issueId ? `<button class="details-btn" onclick="openIssueDetail('${issueId}')">Details</button>` : ''}
      <button class="delete-task-btn" onclick="deleteTask('${id}')">Delete</button>
    </div>
  `;
  return card;
}

function filterBoard(query) {
  const term = query.trim().toLowerCase();
  document.querySelectorAll('.task-card').forEach(card => {
    const matches = !term || card.textContent.toLowerCase().includes(term);
    card.style.display = matches ? '' : 'none';
  });
}

function addTask(columnId) {
  const list = document.getElementById(`${columnId}-list`);
  const id = Date.now().toString();
  const card = createTaskCard(id, 'New Task');
  list.appendChild(card);
  
  const content = card.querySelector('.task-content');
  content.focus();
  const range = document.createRange();
  range.selectNodeContents(content);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  
  saveState();
}

function deleteTask(id) {
  const card = document.getElementById(`task-${id}`);
  if (!card) return;
  const label = card.querySelector('.task-content').innerText.trim() || 'this card';
  // Removing a real ticket's card only clears it from the board locally
  // (loadFromAPI() will just re-add it on the next refresh, since it's
  // still a real assigned issue in Redmine) - a local scratch card has no
  // such safety net, its only copy is this one. Confirm either way.
  if (!confirm(`Delete "${label}"?`)) return;
  card.remove();
  saveState();
}

function saveState() {
  const state = {};
  columns.forEach(id => {
    const list = document.getElementById(`${id}-list`);
    state[id] = Array.from(list.querySelectorAll('.task-card')).map(card => ({
      id: card.id.replace('task-', ''),
      content: card.querySelector('.task-content').innerText,
      issueId: card.dataset.issueId || null
    }));
  });
  localStorage.setItem(getStateKey(), JSON.stringify(state));
}

function getState() {
  const stateStr = localStorage.getItem(getStateKey());
  if (!stateStr) return null;
  try {
    return JSON.parse(stateStr);
  } catch {
    return null;
  }
}

function renderState(state) {
  columns.forEach(columnId => {
    const list = document.getElementById(`${columnId}-list`);
    list.innerHTML = '';
    (state[columnId] || []).forEach(task => {
      const card = createTaskCard(task.id, task.content, task.issueId);
      list.appendChild(card);
    });
  });
  // Re-apply any active search - a fresh render rebuilds every card node,
  // losing the previous filter's display:none state.
  const searchInput = document.getElementById('board-search');
  if (searchInput && searchInput.value) {
    filterBoard(searchInput.value);
  }
}

function loadState() {
  const state = getState();
  if (state) renderState(state);
}

// issueId -> { column, subject } as of the last fetch. Lets the
// auto-refresh tick tell "someone else moved this in Redmine" (or
// reassigned it away entirely) apart from a first load (nothing to
// compare against yet, map starts empty) or a config/mapping refresh
// (which also calls loadFromAPI but shouldn't treat a reclassification
// as a remote move - notifyChanges stays off).
let knownIssueColumns = {};

// Tray urgency classification lives in the pure, unit-tested reddieUrgency
// module (src/urgency.js, loaded as a <script> before this file) rather than
// inline here - it's the renderer's job to feed it the fetched issue list
// and the ordered `priorities` scale, since main.js has neither. See
// updateTrayAppearance() in main.js for how the result paints the tray.

// `apiState` is the same per-column card arrays loadFromAPI just built for
// the board itself - reused here rather than recomputed, so the popover's
// column bar always agrees with what's actually on screen.
function updateTrayStatus(unfinishedIssues, apiState) {
  // Most urgent first, so the tray menu's top few tickets are the ones
  // actually worth interrupting your day for - not just whatever the API
  // happened to return first.
  const topIssues = [...unfinishedIssues]
    .sort((a, b) => reddieUrgency.issueUrgencyRank(a, priorities) - reddieUrgency.issueUrgencyRank(b, priorities))
    .slice(0, 5)
    .map(i => ({ id: i.id, subject: i.subject || `Issue #${i.id}` }));

  const columnCounts = {};
  columns.forEach(col => { columnCounts[col] = (apiState[col] || []).length; });

  window.reddieAPI.updateTrayStatus({
    count: unfinishedIssues.length,
    urgency: reddieUrgency.classifyTrayUrgency(unfinishedIssues, priorities),
    issues: topIssues,
    columnCounts,
    connected: isConnected,
  });
}

function notifyRemoteChanges(nextIssueColumns) {
  if (typeof Notification === 'undefined') return;
  Object.entries(nextIssueColumns).forEach(([issueId, info]) => {
    const prev = knownIssueColumns[issueId];
    if (prev && prev.column !== info.column) {
      new Notification(`#${issueId} moved`, {
        body: `${info.subject}\n${COLUMN_LABELS[prev.column]} → ${COLUMN_LABELS[info.column]}`,
      });
    }
  });
  // listMyIssues() is filtered server-side to the current assignee - a
  // ticket that drops out of the fetch entirely (not just changed column)
  // means it was reassigned away (or otherwise left your visible list),
  // and the board would otherwise just lose the card with no explanation.
  Object.entries(knownIssueColumns).forEach(([issueId, info]) => {
    if (!(issueId in nextIssueColumns)) {
      new Notification(`#${issueId} left your board`, {
        body: `${info.subject}\nNo longer assigned to you in Redmine`,
      });
    }
  });
}

async function loadFromAPI({ notifyChanges = false } = {}) {
  try {
    const response = boardMode === 'authored'
      ? await window.reddieAPI.fetchAuthoredIssues()
      : await window.reddieAPI.fetchIssues();
    if (response.error) {
      console.error('API Error:', response.error);
      showToast(`Couldn't load issues: ${response.error}`, 'error');
      return;
    }

    const issues = response.items || [];
    // Instance-wide format guess for the 'auto' setting - the board list
    // already carries each issue's description, so re-detect on every refresh.
    detectedFormat = reddieTextFormat.detectTextFormat(issues.map((i) => i.description));
    const apiState = {};
    columns.forEach(id => { apiState[id] = []; });
    const nextIssueColumns = {};

    issues.forEach(issue => {
      const column = getColumnFromStatus(issue.status);
      const content = issue.subject || `Issue #${issue.id}`;
      apiState[column].push({
        id: `api-${issue.id}`,
        content: content,
        issueId: issue.id
      });
      nextIssueColumns[issue.id] = { column, subject: content };
    });

    if (notifyChanges) notifyRemoteChanges(nextIssueColumns);
    knownIssueColumns = nextIssueColumns;

    // Tray/popover only reflects "what's on my plate" (assigned mode) -
    // authored-but-reassigned tickets aren't work waiting on you, and
    // showing their columns there would be a different board's data
    // wearing this one's chrome. While viewing the authored board, leave
    // the tray on its last assigned snapshot rather than zeroing it out -
    // an unrelated view toggle shouldn't clear the pending-work badge.
    if (boardMode === 'assigned') {
      const unfinished = issues.filter(i => getColumnFromStatus(i.status) !== 'done');
      updateTrayStatus(unfinished, apiState);
    }

    // Merge with existing state instead of overwriting it: keep any
    // manually-added local card (no issueId) exactly where it was, and
    // replace all API-derived cards with the fresh fetch.
    const prevState = getState() || {};
    const mergedState = {};
    columns.forEach(id => {
      const localOnly = (prevState[id] || []).filter(task => !task.issueId);
      mergedState[id] = [...apiState[id], ...localOnly];
    });

    localStorage.setItem(getStateKey(), JSON.stringify(mergedState));
    renderState(mergedState);
  } catch (err) {
    console.error('Failed to load from API:', err);
  }
}

async function setBoardMode(mode) {
  if (mode === boardMode) return;
  boardMode = mode;
  // The two modes track entirely different ticket sets - diffing one
  // against the other's leftover tracker would misreport every ticket in
  // the newly-active mode as either "moved" or "left the board".
  knownIssueColumns = {};

  document.querySelectorAll('.board-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const cached = getState();
  if (cached) {
    renderState(cached);
  } else {
    columns.forEach(id => {
      document.getElementById(`${id}-list`).innerHTML = '<div class="detail-loading">Loading…</div>';
    });
  }
  await loadFromAPI();
}

// Global scope
window.addTask = addTask;
window.filterBoard = filterBoard;
window.deleteTask = deleteTask;
window.saveState = saveState;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.openColumnMapping = openColumnMapping;
window.closeColumnMapping = closeColumnMapping;
window.saveColumnMappingOverrides = saveColumnMappingOverrides;
window.saveSettings = saveSettings;
window.toggleTheme = toggleTheme;
window.toggleTransparency = toggleTransparency;
window.openIssueDetail = openIssueDetail;
window.closeIssueDetail = closeIssueDetail;
window.postComment = postComment;
window.submitTimelog = submitTimelog;
window.changeAssignee = changeAssignee;
window.changePriority = changePriority;
window.uploadAttachment = uploadAttachment;
window.saveSubjectEdit = saveSubjectEdit;
window.changeIssueField = changeIssueField;
window.editDescription = editDescription;
window.saveDescriptionEdit = saveDescriptionEdit;
window.setBoardMode = setBoardMode;
window.openNewTicket = openNewTicket;
window.closeNewTicket = closeNewTicket;
window.loadNewTicketTrackers = loadNewTicketTrackers;
window.loadNewTicketCustomFields = loadNewTicketCustomFields;
window.submitNewTicket = submitNewTicket;
window.checkForUpdates = checkForUpdates;
window.closeUpdateModal = closeUpdateModal;
window.openReleasesFromModal = openReleasesFromModal;
window.startTimerHere = startTimerHere;
window.pauseTimerHere = pauseTimerHere;
window.resetTimerHere = resetTimerHere;
window.cancelTimerHere = cancelTimerHere;
window.discardOtherTimerAndStartHere = discardOtherTimerAndStartHere;
window.completeTimerHere = completeTimerHere;

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  loadWindowTransparencySetting();
  initUpdateListener();
  window.reddieAPI.onShowSettings(() => openSettings());
  window.reddieAPI.onShowUpdater(() => checkForUpdates());
  window.reddieAPI.onOpenIssueFromTray((issueId) => openIssueDetail(issueId));
  document.body.classList.add(`platform-${window.reddieAPI.platform}`);

  // SHA-24: main.js owns the single active timer (survives window
  // hide-to-tray/reload) - pick up whatever's already running on launch, then
  // stay in sync via push. Only repaints the widget; harmless no-op when the
  // detail view isn't open (renderTimerWidget bails if #timer-widget isn't
  // in the DOM).
  currentTimerState = await window.reddieAPI.getTimerState();
  window.reddieAPI.onTimerStateChanged((state) => {
    currentTimerState = state;
    renderTimerWidget();
  });

  // main.js already resolved config precedence at startup (.env, else its
  // own encrypted persisted store - see config-store.js) before this
  // renderer even loads, so there's nothing to reconcile here anymore.

  loadState();
  // First launch, nothing cached yet - show a loading placeholder rather
  // than blank columns while the initial fetch is in flight.
  if (!getState()) {
    columns.forEach(id => {
      document.getElementById(`${id}-list`).innerHTML = '<div class="detail-loading">Loading…</div>';
    });
  }
  initSortable();
  await refreshConnectionStatus();
  await loadColumnMapping();
  await loadActivities();
  await loadPriorities();
  await loadStatuses();
  await loadRedmineBaseUrl();
  await loadTextFormatSetting();
  await loadFromAPI();

  // Auto-refresh: skip a tick rather than yank the board out from under an
  // in-progress drag or a card the user is actively viewing.
  setInterval(() => {
    if (isDragging) return;
    if (document.getElementById('issue-detail-modal').classList.contains('show')) return;
    loadFromAPI({ notifyChanges: true });
  }, AUTO_REFRESH_MS);
});