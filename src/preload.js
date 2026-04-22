// Tauri API bridge
const { invoke } = window.__TAURI__.core;

window.reddieAPI = {
  getConfig: () => invoke('get_config_cmd'),
  saveConfig: (config) => invoke('save_config_cmd', { newConfig: config }),
  fetchIssues: (params) => invoke('fetch_issues_cmd', { params }),
  updateStatus: (issueId, statusId) => invoke('update_status_cmd', { issueId, statusId }),
  addComment: (issueId, comment) => invoke('add_comment_cmd', { issueId, comment }),
};