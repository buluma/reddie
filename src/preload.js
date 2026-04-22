// Tauri API bridge - loaded after Tauri initializes
let reddieAPI = null;

function initAPI() {
  if (window.__TAURI__) {
    const { invoke } = window.__TAURI__.core;
    reddieAPI = {
      getConfig: () => invoke('get_config_cmd'),
      saveConfig: (config) => invoke('save_config_cmd', { newConfig: config }),
      fetchIssues: (params) => invoke('fetch_issues_cmd', { params }),
      updateStatus: (issueId, statusId) => invoke('update_status_cmd', { issueId, statusId }),
      addComment: (issueId, comment) => invoke('add_comment_cmd', { issueId, comment }),
    };
  } else {
    // Fallback for dev mode without Tauri
    reddieAPI = {
      getConfig: () => Promise.resolve({ apiBase: '', redmineBaseUrl: '', redmineApiKey: '' }),
      saveConfig: () => Promise.resolve({ ok: true }),
      fetchIssues: () => Promise.resolve({ items: [], error: 'Not connected' }),
      updateStatus: () => Promise.resolve({}),
      addComment: () => Promise.resolve({}),
    };
  }
  window.reddieAPI = reddieAPI;
}

// Initialize immediately
initAPI();