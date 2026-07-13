const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reddieAPI', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  checkConnection: () => ipcRenderer.invoke('check-connection'),
  getColumnMapping: () => ipcRenderer.invoke('get-column-mapping'),
  fetchStatuses: () => ipcRenderer.invoke('fetch-statuses'),
  saveColumnOverrides: (overrides) => ipcRenderer.invoke('save-column-overrides', overrides),
  fetchIssues: (params) => ipcRenderer.invoke('fetch-issues', params),
  fetchAuthoredIssues: () => ipcRenderer.invoke('fetch-authored-issues'),
  fetchIssueDetail: (issueId) => ipcRenderer.invoke('fetch-issue-detail', issueId),
  updateStatus: (issueId, statusId) => ipcRenderer.invoke('update-status', { issueId, statusId }),
  fetchProjectMembers: (projectId) => ipcRenderer.invoke('fetch-project-members', projectId),
  updateAssignee: (issueId, userId) => ipcRenderer.invoke('update-assignee', { issueId, userId }),
  fetchProjects: () => ipcRenderer.invoke('fetch-projects'),
  fetchProjectTrackers: (projectId) => ipcRenderer.invoke('fetch-project-trackers', projectId),
  fetchTrackerCustomFields: (projectId, trackerId) => ipcRenderer.invoke('fetch-tracker-custom-fields', { projectId, trackerId }),
  createIssue: (data) => ipcRenderer.invoke('create-issue', data),
  addComment: (issueId, comment) => ipcRenderer.invoke('add-comment', { issueId, comment }),
  fetchActivities: () => ipcRenderer.invoke('fetch-activities'),
  fetchPriorities: () => ipcRenderer.invoke('fetch-priorities'),
  updatePriority: (issueId, priorityId) => ipcRenderer.invoke('update-priority', { issueId, priorityId }),
  updateSubject: (issueId, subject) => ipcRenderer.invoke('update-subject', { issueId, subject }),
  uploadAttachment: (issueId) => ipcRenderer.invoke('upload-attachment', issueId),
  addTimelog: (issueId, entry) => ipcRenderer.invoke('add-timelog', { issueId, ...entry }),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },
  openReleasesPage: () => ipcRenderer.invoke('open-releases-page'),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  updateTrayStatus: (status) => ipcRenderer.send('update-tray-status', status),
  onShowSettings: (callback) => {
    ipcRenderer.on('show-settings', () => callback());
  },
  onShowUpdater: (callback) => {
    ipcRenderer.on('show-updater', () => callback());
  },
  onOpenIssueFromTray: (callback) => {
    ipcRenderer.on('open-issue-detail-from-tray', (event, issueId) => callback(issueId));
  },
  getTimerState: () => ipcRenderer.invoke('timer-get-state'),
  startTimer: (ticketId, subject) => ipcRenderer.invoke('timer-start', { ticketId, subject }),
  pauseTimer: () => ipcRenderer.invoke('timer-pause'),
  resetTimer: () => ipcRenderer.invoke('timer-reset'),
  cancelTimer: () => ipcRenderer.invoke('timer-cancel'),
  completeTimer: (activityId, comment) => ipcRenderer.invoke('timer-complete', { activityId, comment }),
  onTimerStateChanged: (callback) => {
    ipcRenderer.on('timer-state-changed', (event, state) => callback(state));
  },
});
