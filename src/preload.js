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
  fetchIssueDetail: (issueId) => ipcRenderer.invoke('fetch-issue-detail', issueId),
  updateStatus: (issueId, statusId) => ipcRenderer.invoke('update-status', { issueId, statusId }),
  fetchProjectMembers: (projectId) => ipcRenderer.invoke('fetch-project-members', projectId),
  updateAssignee: (issueId, userId) => ipcRenderer.invoke('update-assignee', { issueId, userId }),
  fetchProjects: () => ipcRenderer.invoke('fetch-projects'),
  fetchProjectTrackers: (projectId) => ipcRenderer.invoke('fetch-project-trackers', projectId),
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
});
