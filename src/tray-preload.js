const { contextBridge, ipcRenderer } = require('electron');

// Deliberately smaller surface than the main window's preload.js - the
// popover only ever needs to receive a status snapshot and fire one of a
// handful of fixed actions, not the full Redmine API.
contextBridge.exposeInMainWorld('trayAPI', {
  onTrayData: (callback) => {
    ipcRenderer.on('tray-data', (event, data) => callback(data));
  },
  openIssue: (issueId) => ipcRenderer.send('tray-popover-open-issue', issueId),
  resize: (contentHeight) => ipcRenderer.send('tray-popover-resize', contentHeight),
  openSettings: () => ipcRenderer.send('tray-popover-open-settings'),
  checkForUpdates: () => ipcRenderer.send('tray-popover-check-updates'),
  quit: () => ipcRenderer.send('tray-popover-quit'),
});
