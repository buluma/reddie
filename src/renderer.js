const columns = ['backlog', 'todo', 'in-progress', 'done'];

function initSortable() {
  columns.forEach(id => {
    const el = document.getElementById(`${id}-list`);
    new Sortable(el, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: () => {
        saveState();
      }
    });
  });
}

function createTaskCard(id, content) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.id = `task-${id}`;
  card.innerHTML = `
    <div class="task-content" contenteditable="true" onblur="saveState()">${content}</div>
    <div class="task-actions">
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
  
  // Focus on the content of the new card
  const content = card.querySelector('.task-content');
  content.focus();
  // Select all text
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
      content: card.querySelector('.task-content').innerText
    }));
  });
  localStorage.setItem('kanban-state', JSON.stringify(state));
}

function loadState() {
  const stateStr = localStorage.getItem('kanban-state');
  if (stateStr) {
    const state = JSON.parse(stateStr);
    Object.keys(state).forEach(columnId => {
      const list = document.getElementById(`${columnId}-list`);
      state[columnId].forEach(task => {
        const card = createTaskCard(task.id, task.content);
        list.appendChild(card);
      });
    });
  } else {
    // Add a placeholder task if empty
    addTask('backlog');
  }
}

// Global scope for onclick handlers in HTML
window.addTask = addTask;
window.deleteTask = deleteTask;
window.saveState = saveState;

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initSortable();
});
