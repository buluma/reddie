# Reddie

A small desktop Kanban board for [Redmine](https://www.redmine.org/), built with Electron. Talks directly to Redmine's own REST API — no server, no other backend, just Redmine plus this app.

## Features

- Drag-and-drop Kanban board (Backlog / To Do / In Progress / Done), auto-mapped from your Redmine instance's real statuses — works against any instance's custom workflow, not just one specific setup
- Click a card for the full ticket: description, project/assignee/author/due date, attachments, GitHub-style activity/comment history
- Post comments and log time straight from the detail view
- Personal scratch cards alongside real tickets — add your own to-dos to the board, stored locally, never synced anywhere
- Board search, auto-refresh, dark/light theme

## Setup

You need a Redmine instance and a personal API key (Redmine → My account → API access key).

```bash
npm install
cp .env.example .env
# edit .env with your Redmine URL and API key
npm start
```

Or skip `.env` entirely and enter your Redmine URL + API key in the app's Settings (gear icon) after launch — either way works, `.env` just saves you re-entering it.

## Development

```bash
npm start   # run from source
npm test    # vitest
```

## Building

```bash
npm run build
```

Builds for whatever platform you're running on (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`/`.deb`) via [electron-builder](https://www.electron.build/). Output lands in `dist/`.

Builds are unsigned/ad-hoc — no Apple Developer or Windows code-signing certificate is configured. macOS will show a Gatekeeper warning on first launch (right-click → Open to bypass); Windows shows a SmartScreen warning (More info → Run anyway).

## CI builds

`.github/workflows/build.yml` builds all three platforms via GitHub Actions:

- **Manually**: Actions tab → Build → Run workflow
- **On release**: push a version tag (see below)

Each platform builds natively on its own runner (no cross-compilation), and artifacts are attached to the workflow run.

## Cutting a release

```bash
npm run release:patch   # 1.0.0 -> 1.0.1
npm run release:minor   # 1.0.0 -> 1.1.0
npm run release:major   # 1.0.0 -> 2.0.0
```

Each bumps `package.json`'s version, commits, tags (`vX.Y.Z`), and pushes — which triggers the CI build for all three platforms with that version baked into the artifact names.

## What's local-only vs. synced

- **Board position** (which column a *real* Redmine ticket is in) comes from the ticket's actual status in Redmine — dragging a card updates Redmine directly.
- **Personal scratch cards** (added via the `+` button, no ticket number) live only in this app's local storage. They're yours, not Redmine's — nothing else will ever see them.

## Architecture

- `src/main.js` — Electron main process, window + IPC
- `src/redmine-client.js` — the actual Redmine REST API client (issues, statuses, comments, time entries)
- `src/renderer.js` / `src/index.html` / `src/styles.css` — the UI
- `src/preload.js` — the only bridge between them (`contextIsolation` on, `nodeIntegration` off)
