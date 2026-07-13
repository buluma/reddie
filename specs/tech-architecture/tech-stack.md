# reddie tech stack

## Runtime
- Electron (Chromium + Node.js)
- contextIsolation: true, nodeIntegration: false

## Language
- JavaScript (no TypeScript, no transpilation)

## UI
- Vanilla DOM manipulation (no framework)
- HTML + CSS (no preprocessors)
- Direct `window.foo = foo` for inline handlers

## Backend
- `src/main.js` — single-file backend, module-level state
- `src/redmine-client.js` — Redmine REST API client (raw http/https)
- `src/config-store.js` — encrypted settings via safeStorage

## Build
- electron-builder (matrix builds: macOS/Windows/Linux)
- GitHub Actions CI

## Testing
- vitest (single test file: redmine-client.test.js)
- Tests grounded in real Redmine API response shapes

## Distribution
- macOS: .dmg
- Windows: .exe (NSIS)
- Linux: .AppImage / .deb
- GitHub Releases (auto-published on tag push)
