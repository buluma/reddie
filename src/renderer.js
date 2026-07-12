const columns = ['backlog', 'todo', 'in-progress', 'done'];
const statusMap = {
  'New': 'backlog',
  'In Progress': 'in-progress',
  'Resolved': 'done',
  'Feedback': 'todo',
  'Closed': 'done',
  'Hold': 'todo',
  'Testing': 'in-progress',
  1: 'backlog',
  2: 'in-progress',
  3: 'done',
  4: 'todo',
  5: 'done',
  6: 'todo',
  10: 'in-progress',
  11: 'todo',
  12: 'done',
  13: 'todo',
  14: 'todo',
  15: 'todo',
  16: 'todo',
  19: 'todo',
  26: 'todo'
};

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

function renderIssueDetail(issue) {
  document.getElementById('detail-subject').textContent = issue.subject || `Issue #${issue.redmineIssueId}`;

  const journalsHtml = (issue.journals || [])
    .filter(j => j.notes)
    .map(j => `
      <div class="journal-entry">
        <div class="journal-meta">
          <strong>${escapeHtml(j.author || 'Unknown')}</strong>
          <span class="journal-date">${formatDateTime(j.createdOnRemote)}</span>
        </div>
        <div class="journal-notes">${escapeHtml(j.notes)}</div>
      </div>
    `).join('') || '<div class="detail-empty">No comments yet.</div>';

  const timeEntriesHtml = (issue.timeEntries || [])
    .map(t => `
      <div class="time-entry-row">
        <span>${t.hours}h — ${escapeHtml(t.activityName || 'Activity')}</span>
        <span class="journal-date">${formatDate(t.spentOn)}${t.authorName ? ' · ' + escapeHtml(t.authorName) : ''}</span>
      </div>
    `).join('') || '<div class="detail-empty">No time logged.</div>';
  const totalHours = (issue.timeEntries || []).reduce((sum, t) => sum + (t.hours || 0), 0);

  const attachmentsHtml = (issue.attachments || [])
    .map(a => `<div class="attachment-row">📎 ${escapeHtml(a.filename)} <span class="journal-date">(${Math.round((a.filesize || 0) / 1024)} KB)</span></div>`)
    .join('') || '<div class="detail-empty">No attachments.</div>';

  const githubLinksHtml = (issue.githubLinks || [])
    .map(g => `<div class="attachment-row">🔗 ${escapeHtml(g.repositoryFullName)}${g.githubPrNumber ? ' #' + g.githubPrNumber : g.githubIssueNumber ? ' #' + g.githubIssueNumber : ''}</div>`)
    .join('');

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-badges">
      <span class="detail-badge">${escapeHtml(issue.statusName || '—')}</span>
      ${issue.priority ? `<span class="detail-badge">${escapeHtml(issue.priority)}</span>` : ''}
      ${issue.tracker ? `<span class="detail-badge">${escapeHtml(issue.tracker)}</span>` : ''}
    </div>
    <div class="detail-meta">
      <div><strong>Project</strong> ${escapeHtml(issue.projectName || '—')}</div>
      <div><strong>Assignee</strong> ${escapeHtml(issue.assignedToName || 'Unassigned')}</div>
      <div><strong>Author</strong> ${escapeHtml(issue.authorName || '—')}</div>
      <div><strong>Due</strong> ${formatDate(issue.dueDate)}</div>
    </div>
    <div class="detail-section">
      <h3>Description</h3>
      <div class="detail-description">${issue.description ? escapeHtml(issue.description) : '<span class="detail-empty">No description.</span>'}</div>
    </div>
    ${githubLinksHtml ? `<div class="detail-section"><h3>GitHub</h3>${githubLinksHtml}</div>` : ''}
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
  renderIssueDetail(result.issue);
}

function closeIssueDetail() {
  document.getElementById('issue-detail-modal').classList.remove('show');
}

// Settings
function openSettings() {
  document.getElementById('settings-modal').classList.add('show');
  window.reddieAPI.getConfig().then(config => {
    document.getElementById('api-base').value = config.apiBase || 'http://100.110.136.4:3001';
    document.getElementById('redmine-base').value = config.redmineBaseUrl || 'https://redmine.nasctech.com';
    document.getElementById('redmine-api-key').value = config.redmineApiKey || '';
  });
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('show');
}

async function saveSettings() {
  const newConfig = {
    apiBase: document.getElementById('api-base').value,
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
    // Reload issues
    await loadFromAPI();
  }
}

function getColumnFromStatus(status) {
  if (!status) return 'backlog';
  const id = typeof status === 'number' ? status : status.id;
  const name = typeof status === 'string' ? status : status.name || 'New';
  return statusMap[name] || statusMap[id] || 'backlog';
}

function getStatusId(column) {
  // Converge's /api/issues/[id]/status expects a numeric statusId
  // (StatusCatalog id), not a status name string.
  const reverseMap = {
    'backlog': 1,       // New
    'todo': 4,          // Feedback
    'in-progress': 2,   // In Progress
    'done': 3           // Resolved
  };
  return reverseMap[column] || 1;
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
    const response = await window.reddieAPI.fetchIssues({ pageSize: 100 });
    if (response.error) {
      console.error('API Error:', response.error);
      return;
    }

    const issues = response.items || [];
    const apiState = {};
    columns.forEach(id => { apiState[id] = []; });

    issues.forEach(issue => {
      const column = getColumnFromStatus(issue.status);
      const content = issue.subject || `Issue #${issue.id}`;
      apiState[column].push({
        id: `api-${issue.redmineIssueId || issue.id}`,
        content: content,
        issueId: issue.redmineIssueId || null
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
  await loadFromAPI();
});