const columns = ['backlog', 'todo', 'in-progress', 'done'];
const AUTO_REFRESH_MS = 60000;

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
        // Auto-install isn't possible on an unsigned/ad-hoc-signed build
        // (macOS refuses to apply an update without a matching stable
        // code-signing identity, which needs a paid Apple Developer
        // account) - point at the manual download instead of implying
        // it'll just handle itself.
        showToast(`Update v${data.version} available - download it from github.com/buluma/reddie/releases`, 'info');
        break;
      case 'error':
        showToast(`Update error: ${data.message}`, 'error');
        break;
      // 'checking' and 'not-available' are routine background noise - not
      // worth a toast.
    }
  });
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
function setConnectionStatus(state, text) {
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
  document.getElementById('detail-subject').textContent = issue.subject || `Issue #${issue.id}`;

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
    .filter(j => j.notes)
    .map(j => `
      <div class="journal-entry">
        <div class="journal-meta">
          <strong>${escapeHtml((j.user && j.user.name) || 'Unknown')}</strong>
          <span class="journal-date">${formatDateTime(j.created_on)}</span>
        </div>
        <div class="journal-notes">${escapeHtml(j.notes)}</div>
      </div>
    `).join('') || '<div class="detail-empty">No comments yet.</div>';

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

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-badges">
      <span class="detail-badge">${escapeHtml((issue.status && issue.status.name) || '—')}</span>
      ${issue.tracker ? `<span class="detail-badge">${escapeHtml(issue.tracker.name)}</span>` : ''}
    </div>
    <div class="detail-meta">
      <div><strong>Project</strong> ${escapeHtml((issue.project && issue.project.name) || '—')}</div>
      <div><strong>Assignee</strong> <select id="assignee-select" class="assignee-select" onchange="changeAssignee(this.value)">${assigneeOptionsHtml}</select></div>
      <div><strong>Priority</strong> <select id="priority-select" class="assignee-select" onchange="changePriority(this.value)">${priorityOptionsHtml}</select></div>
      <div><strong>Author</strong> ${escapeHtml((issue.author && issue.author.name) || '—')}</div>
      <div><strong>Due</strong> ${formatDate(issue.due_date)}</div>
    </div>
    <div class="detail-section">
      <h3>Description</h3>
      <div class="detail-description">${issue.description ? escapeHtml(issue.description) : '<span class="detail-empty">No description.</span>'}</div>
    </div>
    <div class="detail-section">
      <h3>Time logged${totalHours ? ` — ${totalHours}h total` : ''}</h3>
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
}

let currentDetailIssueId = null;
// Cached alongside the open issue so comment/timelog refreshes don't need
// to re-fetch the project's member list just to re-render the same
// assignee dropdown.
let currentDetailMembers = [];

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
  const membersResult = projectId ? await window.reddieAPI.fetchProjectMembers(projectId) : { items: [] };
  currentDetailMembers = (membersResult && membersResult.items) || [];
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
  });
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('show');
}

// Column mapping
const COLUMN_LABELS = { backlog: 'Backlog', todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };

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
  if (!projectId) return;

  const result = await window.reddieAPI.fetchProjectTrackers(projectId);
  const trackers = (result && result.items) || [];
  trackerSelect.innerHTML = trackers.length
    ? trackers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
    : '<option>No trackers enabled on this project</option>';
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

  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const result = await window.reddieAPI.createIssue({ projectId, trackerId, subject, description });
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
    redmineApiKey: document.getElementById('redmine-api-key').value
  };

  // Save to main process
  const result = await window.reddieAPI.saveConfig(newConfig);

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
  card.innerHTML = `
    <div class="task-content" contenteditable="true" onblur="saveState()">${content}</div>
    <div class="task-actions">
      ${!issueId ? `<span class="local-badge" title="Personal card, not synced to Redmine">Local</span>` : ''}
      ${issueId ? `<span class="issue-id" onclick="openIssueDetail('${issueId}')" title="View details">#${issueId}</span>` : ''}
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
  if (card) {
    card.remove();
    saveState();
  }
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
  localStorage.setItem('kanban-state', JSON.stringify(state));
}

function getState() {
  const stateStr = localStorage.getItem('kanban-state');
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
    const response = await window.reddieAPI.fetchIssues();
    if (response.error) {
      console.error('API Error:', response.error);
      showToast(`Couldn't load issues: ${response.error}`, 'error');
      return;
    }

    const issues = response.items || [];
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

    // Merge with existing state instead of overwriting it: keep any
    // manually-added local card (no issueId) exactly where it was, and
    // replace all API-derived cards with the fresh fetch.
    const prevState = getState() || {};
    const mergedState = {};
    columns.forEach(id => {
      const localOnly = (prevState[id] || []).filter(task => !task.issueId);
      mergedState[id] = [...apiState[id], ...localOnly];
    });

    localStorage.setItem('kanban-state', JSON.stringify(mergedState));
    renderState(mergedState);
  } catch (err) {
    console.error('Failed to load from API:', err);
  }
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
window.openIssueDetail = openIssueDetail;
window.closeIssueDetail = closeIssueDetail;
window.postComment = postComment;
window.submitTimelog = submitTimelog;
window.changeAssignee = changeAssignee;
window.changePriority = changePriority;
window.uploadAttachment = uploadAttachment;
window.openNewTicket = openNewTicket;
window.closeNewTicket = closeNewTicket;
window.loadNewTicketTrackers = loadNewTicketTrackers;
window.submitNewTicket = submitNewTicket;
window.checkForUpdates = checkForUpdates;

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initUpdateListener();
  document.body.classList.add(`platform-${window.reddieAPI.platform}`);

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
  await loadFromAPI();

  // Auto-refresh: skip a tick rather than yank the board out from under an
  // in-progress drag or a card the user is actively viewing.
  setInterval(() => {
    if (isDragging) return;
    if (document.getElementById('issue-detail-modal').classList.contains('show')) return;
    loadFromAPI({ notifyChanges: true });
  }, AUTO_REFRESH_MS);
});