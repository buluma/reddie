const columns = ['backlog', 'todo', 'in-progress', 'done'];

// Populated from the connected Redmine instance's real issue_statuses via
// getColumnMapping() - no hardcoded status ids, this varies per instance.
let columnMapping = { statusIdToColumn: {}, columnToStatusId: {} };

async function loadColumnMapping() {
  columnMapping = await window.reddieAPI.getColumnMapping();
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

function renderIssueDetail(issue, timeEntries) {
  document.getElementById('detail-subject').textContent = issue.subject || `Issue #${issue.id}`;

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

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-badges">
      <span class="detail-badge">${escapeHtml((issue.status && issue.status.name) || '—')}</span>
      ${issue.priority ? `<span class="detail-badge">${escapeHtml(issue.priority.name)}</span>` : ''}
      ${issue.tracker ? `<span class="detail-badge">${escapeHtml(issue.tracker.name)}</span>` : ''}
    </div>
    <div class="detail-meta">
      <div><strong>Project</strong> ${escapeHtml((issue.project && issue.project.name) || '—')}</div>
      <div><strong>Assignee</strong> ${escapeHtml((issue.assigned_to && issue.assigned_to.name) || 'Unassigned')}</div>
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
    </div>
    <div class="detail-section">
      <h3>Attachments</h3>
      ${attachmentsHtml}
    </div>
    <div class="detail-section">
      <h3>Activity</h3>
      ${journalsHtml}
    </div>
  `;
}

async function openIssueDetail(issueId) {
  document.getElementById('issue-detail-modal').classList.add('show');
  document.getElementById('detail-subject').textContent = 'Loading…';
  document.getElementById('detail-body').innerHTML = '<div class="detail-loading">Loading…</div>';

  const result = await window.reddieAPI.fetchIssueDetail(issueId);
  if (!result || result.error || !result.issue) {
    document.getElementById('detail-subject').textContent = 'Error';
    document.getElementById('detail-body').innerHTML = `<div class="detail-empty">${escapeHtml((result && result.error) || 'Failed to load issue.')}</div>`;
    return;
  }
  renderIssueDetail(result.issue, result.timeEntries);
}

function closeIssueDetail() {
  document.getElementById('issue-detail-modal').classList.remove('show');
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
    // Save to localStorage as backup
    localStorage.setItem('reddie-config', JSON.stringify(newConfig));
    closeSettings();
    // Reload issues (column mapping may have changed on a different Redmine instance)
    await loadColumnMapping();
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

function initSortable() {
  columns.forEach(id => {
    const el = document.getElementById(`${id}-list`);
    new Sortable(el, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: (evt) => {
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
  card.className = 'task-card';
  card.id = `task-${id}`;
  if (issueId) card.dataset.issueId = issueId;
  card.innerHTML = `
    <div class="task-content" contenteditable="true" onblur="saveState()">${content}</div>
    <div class="task-actions">
      ${issueId ? `<span class="issue-id" onclick="openIssueDetail('${issueId}')" title="View details">#${issueId}</span>` : ''}
      ${issueId ? `<button class="details-btn" onclick="openIssueDetail('${issueId}')">Details</button>` : ''}
      <button class="delete-task-btn" onclick="deleteTask('${id}')">Delete</button>
    </div>
  `;
  return card;
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
}

function loadState() {
  const state = getState();
  if (state) renderState(state);
}

async function loadFromAPI() {
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

    issues.forEach(issue => {
      const column = getColumnFromStatus(issue.status);
      const content = issue.subject || `Issue #${issue.id}`;
      apiState[column].push({
        id: `api-${issue.id}`,
        content: content,
        issueId: issue.id
      });
    });

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
window.deleteTask = deleteTask;
window.saveState = saveState;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.toggleTheme = toggleTheme;
window.openIssueDetail = openIssueDetail;
window.closeIssueDetail = closeIssueDetail;

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // main.js seeds config from .env at startup. Only fall back to the
  // localStorage cache (set by a previous Settings save) if that env
  // config didn't already supply an API key - otherwise a stale cached
  // key from an earlier session silently overrides a fresh .env value
  // on every launch.
  const currentConfig = await window.reddieAPI.getConfig();
  if (!currentConfig.redmineApiKey) {
    const savedConfig = localStorage.getItem('reddie-config');
    if (savedConfig) {
      try {
        await window.reddieAPI.saveConfig(JSON.parse(savedConfig));
      } catch(e) {}
    }
  }

  loadState();
  initSortable();
  await refreshConnectionStatus();
  await loadColumnMapping();
  await loadFromAPI();
});