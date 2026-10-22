# CONVENTIONS.md

Rules all AI agents must follow in this project.

## Always Green / Shift Left

- **Preflight** (`bun run test && bun run build`) must be green before forward work.
- **CI** (`gh pr checks`) must be green before merging.
- 1-10-100 rationale: fixing a convention violation at authoring costs 1; after commit costs 10; after merge costs 100.
- Reproducible gate failures require **fix-or-log** (fix it now, or log it as a tracked task). Never ignore a red gate.

## Discovered Defects

When a bug is found during development (not the original task):

1. **Quick-fix** if trivial (<= 5 min, pure data, no logic risk) — separate commit, conventional commit message.
2. **Fix-bug** if non-trivial — log it as its own task, plan the fix, separate branch.
3. Never fold a discovered fix into the feature commit — it obscures blame and makes rollback harder.

## Banned Dismissive Phrases

Never use these to skip a gate failure:

| Phrase | Why it's banned |
|--------|----------------|
| "pre-existing" | A failure in baseline is still a failure — fix or log it |
| "unrelated to my session" | If you saw it, you own triage |
| "not introduced by my changes" | Irrelevant — the gate is red, work stops |
| "out of scope" | Nothing is out of scope when the gate is red |
| "already broken" | Same as pre-existing — fix or log |

## Defensive Code

- **Retry**: `withRetry` in `src/redmine-client.js` retries transient GET failures (network errors, timeouts, interrupted or malformed responses, 5xx) up to 2 times with linear backoff. Writes (PUT/POST) are never retried.

## Testing

- Tests are grounded in real Redmine API response shapes, not invented fixtures.
- Pure-logic functions (`buildColumnMapping`, `classifyStatus`) get unit tests.
- IPC/HTTP glue is verified by launching the app and confirming no console errors.
- After changes touching packaged-app paths, test the built artifact in `dist/`.

## Git & Commits

- Conventional Commits format: `type(scope): description`
- Tag pushes trigger CI release (`electron-builder --publish always`)
- `workflow_dispatch` runs stay `--publish never`
- Never manually flip GitHub Release draft state during matrix builds

## Code Style

- No framework, no build step for UI — vanilla JS, direct DOM manipulation.
- No inline `on*="..."` handlers: the CSP's `script-src 'self'` blocks them. Wire UI with `data-click` / `data-change` / `data-input` / `data-blur="<action>"` (plus `data-arg` when needed) and add the action to `UI_ACTIONS` in `renderer.js`; the tray popover uses `data-tray-action` / `data-issue-id` in `tray-popover.js`.
- Module-level state in `main.js` (no separate server process).
- `contextIsolation: true` / `nodeIntegration: false` — preload bridge only.
