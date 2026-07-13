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
- **Sub-tasks** — parent (if any) and children (if any) shown as clickable links that jump straight to that ticket's own detail view; read-only, no assigning/creating a sub-task relationship from reddie
- **Custom fields** — non-empty ones shown read-only (most fields are blank on most tickets)

## Creating tickets

- "New Ticket…" (header) — pick a project, then a tracker (fetched per-project, since trackers are enabled per-project not globally), subject, description
- New tickets default-assign to you so they land on the board immediately
- **Custom fields** — rendered per project+tracker as plain text inputs, sniffed from a sample existing issue of that pairing (`/custom_fields.json`, the endpoint with real field format/options/required-ness, is admin-only and 403s for a regular API key — no dropdowns/checkboxes possible, just text; Redmine's own validation error catches a bad value on submit)

## Configuration

- Redmine URL + API key via `.env` or Settings — no other backend required, ever
- API key encrypted at rest via Electron's `safeStorage` (Keychain/DPAPI/libsecret), not plaintext
- Per-status column mapping overrides (see Board, above)

## Distribution & updates

- Cross-platform builds: macOS (`.dmg`), Windows (`.exe`/NSIS), Linux (`.AppImage`/`.deb`)
- GitHub Actions CI: 3-platform matrix build on tag push, auto-publishes a real GitHub Release once every platform succeeds
- In-app update checker (`electron-updater`) — checks on launch (packaged builds only) and via a manual "Check for Updates…" in Settings, shown in a modal with current/new version and a one-click "Open GitHub Releases" button. **Does not auto-download/auto-install** — macOS's Squirrel.Mac refuses to apply an update without a stable code-signing identity, which ad-hoc/unsigned builds don't have (needs a paid Apple Developer account, same blocker as notarization below). Grab new versions from GitHub Releases manually.

## Tray

- Menu bar icon, colored by urgency of your unfinished assigned issues (gray = none, green/orange/red = low/medium/high priority present) — computed client-side from priority name, pushed to the tray on every board refresh
- macOS dock/Linux(Unity) badge count mirrors the same unfinished-issue count (no-ops silently on Windows, which has no equivalent without per-window overlay icons)
- **Left-click**: quick-glance popover (positioned under the tray icon, like a native menu-bar app) — connection dot, a stacked bar + legend of column counts (Backlog/To Do/In Progress/Done), and up to 5 of your most urgent unfinished tickets (click one to jump straight to its detail view), plus Settings/Updates/Quit buttons. Closes on losing focus, like any other menu-bar popover.
- **Right-click**: the fuller native menu (same ticket list, plus Show Reddie/Settings…/Check for Updates…/Quit) — kept as a second path since it's the Windows convention and doesn't depend on the popover's window-positioning logic
- Closing the window hides it to the tray instead of quitting, on every platform (previously only true on macOS by Electron's default) — the tray's Quit item (or Cmd/Ctrl+Q) is the only real exit now

## Rendering

- Description and comments render with `DOMPurify` sanitization as either **Markdown** (`marked`) or **Textile** (`textile-js`) — Redmine's `text_formatting` is an instance-wide setting the REST API doesn't expose (`/settings.json` is admin-only), so Settings → Text format picks it: Auto (guessed from the loaded bodies' markup), Markdown, or Textile. Auto keeps a plain-Markdown instance working while correctly rendering a Textile instance's headings/bold/lists.
- Images embedded in a rendered body that point at the configured Redmine instance are fetched with the same API-key auth as everything else and swapped in as data URLs (a plain `<img>` can't send that header) — cached per session (bounded LRU). Inline references by filename (Markdown `![](name)` or Textile `!name!`) are resolved against the issue's attachments to the real `content_url` first. Images pointing elsewhere are left alone, unauthenticated, so the API key never gets sent to a third-party host.

## Not yet supported

- **Creating/assigning sub-task relationships** — reddie can display parent/children (see Ticket detail view, above) but can't set a parent when creating a ticket or turn an existing one into a child of another
- **macOS notarization / Windows code signing** — needs paid developer accounts, not attempted; builds are ad-hoc signed (macOS Gatekeeper warning) / unsigned (Windows SmartScreen warning)
