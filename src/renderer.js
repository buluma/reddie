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
    alert('Error: ' + result.error);
  } else {
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
          window.reddieAPI.updateStatus(itemEl.dataset.issueId, statusId)
            .then(() => saveState())
            .catch(console.error);
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
      ${issueId ? `<span class="issue-id">#${issueId}</span>` : ''}
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

document.addEventListener('DOMContentLoaded', async () => {
  // Try to load API config from localStorage first
  const savedConfig = localStorage.getItem('reddie-config');
  if (savedConfig) {
    try {
      await window.reddieAPI.saveConfig(JSON.parse(savedConfig));
    } catch(e) {}
  }
  
  loadState();
  initSortable();
  await loadFromAPI();
});