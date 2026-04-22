const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

// Default config
const DEFAULT_API_BASE = 'http://100.110.136.4:3001';
const DEFAULT_REDMINE_BASE_URL = 'https://redmine.nasctech.com';

// Session cookie storage
let sessionCookie = '';
let config = {
  apiBase: DEFAULT_API_BASE,
  redmineBaseUrl: DEFAULT_REDMINE_BASE_URL,
  redmineApiKey: ''
};

function apiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = `${config.apiBase}${endpoint}`;
    const uri = new URL(url);
    
    const headers = {
      'Content-Type': 'application/json',
      'X-Redmine-API-Key': config.redmineApiKey,
      'X-Redmine-Base-Url': config.redmineBaseUrl
    };
    
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
    }

    const options = {
      hostname: uri.hostname,
      port: uri.port,
      path: uri.pathname + uri.search,
      method: method,
      headers: headers
    };

    const req = http.request(options, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        sessionCookie = setCookie[0].split(';')[0];
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function connect() {
  if (!config.redmineApiKey) {
    return { error: 'No API key configured' };
  }
  try {
    const result = await apiRequest('/api/redmine/connect', 'POST', {
      baseUrl: config.redmineBaseUrl,
      apiKey: config.redmineApiKey
    });
    console.log('Connect result:', result);
    return result;
  } catch (err) {
    console.error('Connect failed:', err.message);
    return { error: err.message };
  }
}

async function fetchIssues(params = {}) {
  try {
    const query = new URLSearchParams(params).toString();
    return await apiRequest(`/api/issues?${query}`);
  } catch (err) {
    console.error('Fetch issues failed:', err.message);
    return { items: [], error: err.message };
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  createWindow();
  
  if (config.redmineApiKey) {
    await connect();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('get-config', async () => {
  return config;
});

ipcMain.handle('save-config', async (event, newConfig) => {
  config = { ...config, ...newConfig };
  console.log('Config saved:', config);
  const result = await connect();
  return result;
});

ipcMain.handle('fetch-issues', async (event, params) => {
  return await fetchIssues(params);
});

ipcMain.handle('update-status', async (event, { issueId, statusId }) => {
  return await apiRequest(`/api/issues/${issueId}/status`, 'POST', { statusId });
});

ipcMain.handle('add-comment', async (event, { issueId, comment }) => {
  return await apiRequest(`/api/issues/${issueId}/comment`, 'POST', { comment });
});