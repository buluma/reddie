# Reddie

![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Release](https://img.shields.io/github/v/release/buluma/reddie)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)

> A desktop Kanban board for Redmine. No server, no backend — just Redmine plus this app.

## What It Does

Reddie connects directly to any Redmine instance's REST API and gives you a drag-and-drop Kanban board. Move a card, Redmine updates. No middleman.

It's for teams already using Redmine who want a visual workflow without installing plugins or running extra services. Works against any instance's custom statuses — it auto-maps them into Backlog / To Do / In Progress / Done columns.

Personal scratch cards (local to-dos with no ticket number) sit alongside real tickets on the same board.

## Prerequisites

- **Redmine instance** with REST API enabled
- **Personal API key** (Redmine → My Account → API access key)
- **Node.js v18+** (for building from source)

## Installation

### From GitHub Releases (recommended)

Download the latest build for your platform from [Releases](https://github.com/buluma/reddie/releases):

| Platform | Format |
|----------|--------|
| macOS | `.dmg` |
| Windows | `.exe` (NSIS installer) |
| Linux | `.AppImage` or `.deb` |

### From source

```bash
git clone https://github.com/buluma/reddie.git
cd reddie
npm install
```

## Setup

### Option 1: Environment file

```bash
cp .env.example .env
# Edit .env with your Redmine URL and API key
npm start
```

### Option 2: In-app Settings

Launch the app, click the gear icon, and enter your Redmine URL + API key. Encrypted at rest via Electron's `safeStorage`.

## Usage

```bash
npm start        # run from source
```

- **Board** — Drag cards between columns. Real tickets update Redmine directly.
- **Detail view** — Click any card for description, comments, time tracking, attachments, sub-tasks.
- **New ticket** — Click "New Ticket…" in the header, pick a project and tracker.
- **Timer** — Start/Pause/Resume/Complete on any ticket. Completing logs time to Redmine.
- **Settings** — Column mapping overrides, Redmine connection, theme.

## Features

- **Auto-mapped Kanban** — Statuses classified dynamically from your Redmine instance via `classifyStatus` (name + `is_closed` heuristic), not hardcoded
- **Column overrides** — Settings → Column Mapping forces a status into a different column when the heuristic gets it wrong
- **Full ticket detail** — Description, activity/comment history, time entries, attachments, sub-tasks, custom fields (read-only)
- **Time tracking** — Log hours manually or run a live timer with start/pause/complete. One active timer app-wide.
- **Scratch cards** — Personal to-dos alongside real tickets, stored locally, never synced
- **Cross-platform** — macOS, Windows, Linux builds from a single CI pipeline
- **Auto-update checker** — Detects new releases on launch, links to GitHub Releases (no auto-download without a code-signing cert)

## Configuration

| Setting | Source | Description |
|---------|--------|-------------|
| `REDMINE_URL` | `.env` or Settings | Redmine instance URL |
| `REDMINE_API_KEY` | `.env` or Settings | Personal API key (encrypted at rest) |
| `columnOverrides` | Settings | Per-status column mapping overrides |

## Development

```bash
npm start              # run from source
npm test               # vitest (single suite: redmine-client.test.js)
npm run build          # electron-builder, output in dist/
```

### Test strategy

Tests are grounded in real Redmine API response shapes from `redmine.nasctech.com`, not invented fixtures. Pure-logic functions (`buildColumnMapping`, `classifyStatus`) get unit tests. IPC/HTTP glue is verified by launching the app and checking for console errors.

```bash
npx vitest run src/__tests__/redmine-client.test.js   # single file
```

## Building

```bash
npm run build
```

Builds for the current platform via [electron-builder](https://www.electron.build/). Output in `dist/`.

| Platform | Output |
|----------|--------|
| macOS | `.dmg` |
| Windows | `.exe` (NSIS) |
| Linux | `.AppImage`, `.deb` |

Builds are unsigned/ad-hoc. macOS shows a Gatekeeper warning (right-click → Open). Windows shows SmartScreen (More info → Run anyway).

## CI/CD

`.github/workflows/build.yml` runs a 3-platform matrix on tag push:

- Each platform builds natively on its own runner (no cross-compilation)
- Artifacts attach to the workflow run
- A `publish-release` job un-drafts the GitHub Release once all platforms succeed

**Never manually flip draft state while matrix jobs are queued** — it breaks the publish type and requires a follow-up patch release.

## Releasing

```bash
npm run release:patch   # 1.0.0 → 1.0.1
npm run release:minor   # 1.0.0 → 1.1.0
npm run release:major   # 1.0.0 → 2.0.0
```

Bumps version, commits, tags (`vX.Y.Z`), pushes — triggers CI build for all platforms.

## Contributing

1. Fork the repo.
2. Create a feature branch (`git checkout -b feature/my-thing`).
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).
4. Push (`git push origin feature/my-thing`).
5. Open a Pull Request. CI must be green.

See [CONVENTIONS.md](docs/CONVENTIONS.md) for agent and human coding rules.

## Changelog

See [Releases](https://github.com/buluma/reddie/releases) for version history.

## Architecture

```
src/
├── main.js            # Electron main process — backend, IPC, state
├── redmine-client.js  # Redmine REST API client (raw http/https)
├── config-store.js    # Encrypted settings via safeStorage
├── preload.js         # IPC bridge (contextIsolation on)
├── renderer.js        # UI logic (vanilla DOM, no framework)
├── index.html         # Board + detail view
└── styles.css         # Theme + layout
```

Three processes, standard Electron split: `contextIsolation: true`, `nodeIntegration: false`. No separate server — `main.js` is the backend.

## License

MIT — see [LICENSE](LICENSE) for details.
