# Features

Living list of what reddie currently supports, kept in sync with SHA-18 in Linear. Update this alongside any feature-level change.

## Board

- Drag-and-drop Kanban (Backlog / To Do / In Progress / Done), auto-mapped from the connected instance's real `issue_statuses` (name/`is_closed` heuristic) — works against any instance's custom workflow, not just one specific setup
- Per-status column overrides (Settings → Column Mapping…) when the automatic classification gets one wrong for your instance
- Personal scratch cards (no ticket number) — local-only, `localStorage`, never synced to Redmine, visually distinguished with a "Local" badge
- Board search/filter, dark/light theme, 60s auto-refresh (paused during an active drag or while the detail view is open)
- Desktop notification when a ticket's column changes remotely (someone else moved it) or it's reassigned away from you entirely (drops out of `assigned_to_id=me`) — both are diffed against the previous poll, not fired on first load or your own actions
- Each card always shows its ticket id (`#12345`), not just on hover
- Deleting a card confirms first — a local scratch card's delete is permanent, there's no backend copy to fall back to
- A real ticket's card is not text-editable — that only ever changed the display locally and got overwritten by the next refresh anyway; edit the subject from the detail view instead. Local scratch cards stay inline-editable (no detail view exists for them)

## Ticket detail view

- Full ticket: description, project, author, due date, GitHub-style activity/comment history, time entries
- **Subject** — click the title to edit, PUTs `subject` on blur (no-op if unchanged)
- **Assignee** — dropdown of the project's members, PUTs `assigned_to_id`
- **Priority** — dropdown of the instance's `issue_priorities`, PUTs `priority_id`
- **Status** — via drag on the board (not the detail view)
- **Comments** — post directly from the detail view
- **Time tracking** — log hours against any of the instance's active time-entry activities
- **Attachments** — view existing ones, upload new files (Redmine's two-step upload-then-attach flow)

## Creating tickets

- "New Ticket…" (header) — pick a project, then a tracker (fetched per-project, since trackers are enabled per-project not globally), subject, description
- New tickets default-assign to you so they land on the board immediately

## Configuration

- Redmine URL + API key via `.env` or Settings — no other backend required, ever
- API key encrypted at rest via Electron's `safeStorage` (Keychain/DPAPI/libsecret), not plaintext
- Per-status column mapping overrides (see Board, above)

## Distribution & updates

- Cross-platform builds: macOS (`.dmg`), Windows (`.exe`/NSIS), Linux (`.AppImage`/`.deb`)
- GitHub Actions CI: 3-platform matrix build on tag push, auto-publishes a real GitHub Release once every platform succeeds
- In-app update checker (`electron-updater`) — checks on launch (packaged builds only) and via a manual "Check for Updates…" in Settings, notifies with the new version and a link to GitHub Releases. **Does not auto-download/auto-install** — macOS's Squirrel.Mac refuses to apply an update without a stable code-signing identity, which ad-hoc/unsigned builds don't have (needs a paid Apple Developer account, same blocker as notarization below). Grab new versions from GitHub Releases manually.

## Not yet supported

- **Sub-tasks** (parent/child issue relationships) — no plan drafted yet
- **Custom fields** — arbitrary per-tracker fields (some Redmine projects require these to create an issue at all; reddie's "New Ticket" flow will surface Redmine's validation error if a project needs one it doesn't ask for)
- **macOS notarization / Windows code signing** — needs paid developer accounts, not attempted; builds are ad-hoc signed (macOS Gatekeeper warning) / unsigned (Windows SmartScreen warning)
