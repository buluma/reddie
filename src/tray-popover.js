const COLUMN_META = [
  { key: 'backlog', label: 'Backlog', color: '#808080' },
  { key: 'todo', label: 'To Do', color: '#5ac8fa' },
  { key: 'in-progress', label: 'In Progress', color: '#ff9f0a' },
  { key: 'done', label: 'Done', color: '#30d158' },
];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderColumns(columnCounts) {
  const total = COLUMN_META.reduce((sum, c) => sum + (columnCounts[c.key] || 0), 0);
  const barHtml = total
    ? COLUMN_META.map(c => `<div style="width:${((columnCounts[c.key] || 0) / total) * 100}%; background:${c.color}"></div>`).join('')
    : '';
  const legendHtml = COLUMN_META.map(c => `
    <div class="legend-item"><span class="legend-dot" style="background:${c.color}"></span>${c.label} ${columnCounts[c.key] || 0}</div>
  `).join('');
  document.getElementById('columns').innerHTML = `<div class="stacked-bar">${barHtml}</div><div class="legend">${legendHtml}</div>`;
}

function renderTickets(issues) {
  const el = document.getElementById('tickets');
  if (!issues || !issues.length) {
    el.innerHTML = '<div class="empty">Nothing urgent</div>';
    return;
  }
  el.innerHTML = issues.map(issue => `
    <div class="ticket-row" onclick="trayAPI.openIssue(${issue.id})">
      <span class="ticket-id">#${issue.id}</span>${escapeHtml(issue.subject)}
    </div>
  `).join('');
}

// SHA-24: the active-timer row ticks locally on its own 1s interval rather
// than waiting for main.js to push a new frame every second - main.js only
// pushes on a real state transition (start/pause/reset/cancel/complete), so
// without a local tick the elapsed number would sit frozen between pushes.
let timerTickInterval = null;

function renderActiveTimer(activeTimer) {
  const el = document.getElementById('active-timer');
  if (timerTickInterval) {
    clearInterval(timerTickInterval);
    timerTickInterval = null;
  }
  if (!activeTimer) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const paint = () => {
    const elapsed = reddieTimer.formatElapsed(reddieTimer.elapsedMs(activeTimer, Date.now()));
    const paused = activeTimer.status === 'paused';
    el.innerHTML = `
      <div class="timer-row" onclick="trayAPI.openIssue(${activeTimer.ticketId})">
        <span class="timer-dot${paused ? '' : ' running'}"></span>
        <span class="timer-elapsed">${elapsed}</span>
        <span class="timer-subject">#${activeTimer.ticketId} ${escapeHtml(activeTimer.subject || '')}${paused ? ' (paused)' : ''}</span>
      </div>`;
  };
  paint();
  if (activeTimer.status === 'running') {
    timerTickInterval = setInterval(paint, 1000);
  }
}

trayAPI.onTrayData((data) => {
  document.getElementById('conn-dot').className = 'conn-dot' + (data.connected ? ' connected' : '');
  renderActiveTimer(data.activeTimer || null);
  renderColumns(data.columnCounts || {});
  renderTickets(data.issues || []);
  // Fixed window height left dead space below the footer whenever there
  // were fewer than 5 tickets - measure actual content after layout
  // settles and let main.js resize the window to match.
  requestAnimationFrame(() => trayAPI.resize(document.body.scrollHeight));
});
