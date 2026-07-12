const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reddieAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  checkConnection: () => ipcRenderer.invoke('check-connection'),
  fetchIssues: (params) => ipcRenderer.invoke('fetch-issues', params),
  updateStatus: (issueId, statusId) => ipcRenderer.invoke('update-status', { issueId, statusId }),
  addComment: (issueId, comment) => ipcRenderer.invoke('add-comment', { issueId, comment }),
});