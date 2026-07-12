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
  addComment: (issueId, comment) => ipcRenderer.invoke('add-comment', { issueId, comment }),
  fetchActivities: () => ipcRenderer.invoke('fetch-activities'),
  addTimelog: (issueId, entry) => ipcRenderer.invoke('add-timelog', { issueId, ...entry }),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },
});
