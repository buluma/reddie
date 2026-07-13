const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

// Persists Settings (Redmine URL + API key) to disk in the OS-appropriate
// userData directory. The API key is encrypted at rest via Electron's
// safeStorage (macOS Keychain / Windows DPAPI / Linux libsecret) rather
// than the previous approach of caching it in the renderer's localStorage,
// which is an unencrypted file on disk.

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadPersistedConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('Failed to read persisted config:', err.message);
    return {};
  }

  let redmineApiKey = '';
  if (raw.redmineApiKeyEncrypted) {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        redmineApiKey = safeStorage.decryptString(Buffer.from(raw.redmineApiKeyEncrypted, 'base64'));
      } catch (err) {
        console.error('Failed to decrypt stored API key:', err.message);
      }
    } else {
      console.warn('OS-level encryption unavailable - cannot read the stored API key. Re-enter it in Settings.');
    }
  } else if (raw.redmineApiKeyPlaintext) {
    // Only ever written when safeStorage wasn't available at save time.
    redmineApiKey = raw.redmineApiKeyPlaintext;
  }

  return {
    redmineBaseUrl: raw.redmineBaseUrl || '',
    redmineApiKey,
    // { [statusId]: columnName } - a user's manual status->column remap
    // from Settings > Column Mapping, layered over the automatic
    // classification in redmine-client.js. Not sensitive, stored plain.
    columnOverrides: raw.columnOverrides || {},
    // 'auto' | 'markdown' | 'textile' - how to render bodies (see
    // text-format.js). Not sensitive, stored plain. Defaults to 'auto' so a
    // spread merge in main.js never overwrites the default with undefined.
    textFormat: raw.textFormat || 'auto',
  };
}

function persistConfig({ redmineBaseUrl, redmineApiKey, columnOverrides, textFormat }) {
  const out = { redmineBaseUrl, columnOverrides: columnOverrides || {} };
  if (textFormat) out.textFormat = textFormat;
  if (redmineApiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      out.redmineApiKeyEncrypted = safeStorage.encryptString(redmineApiKey).toString('base64');
    } else {
      console.warn('OS-level encryption unavailable - storing the API key in plaintext as a fallback.');
      out.redmineApiKeyPlaintext = redmineApiKey;
    }
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
}

module.exports = { loadPersistedConfig, persistConfig };
