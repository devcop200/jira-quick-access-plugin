# CLAUDE.md — Jira Quick Access Chrome Extension

## Project overview

Chrome Manifest V3 extension for any **self-hosted Jira instance** (Server / Data Center).
Vanilla JS, no build step, no framework, no dependencies. Load the folder as an unpacked extension in Chrome.

Authentication: Bearer PAT (Personal Access Token). Cookies are never sent (`credentials: omit`) to avoid invalidating the user's browser Jira session — this is a hard requirement, do not change it.

## File map

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest — permissions, optional_host_permissions, background SW, options_ui |
| `api.js` | `JiraAPI` object — all Jira REST API v2 calls, loaded in popup and options pages |
| `background.js` | Service worker — 5-min alarm, polling, badge, desktop notifications |
| `popup.html/css/js` | Main 560 px popup — 5 tabs, issue lists, detail panels, notifications |
| `options.html/css/js` | Settings page — 2 × 2 card grid, loaded in a full tab |
| `icon.svg` | Extension icon drawn on an OffscreenCanvas at runtime |

## Architecture

### Background service worker (`background.js`)
Wakes up every 5 minutes via `chrome.alarms`. Runs three pollers in parallel:

- **`pollWatchFilter()`** — JQL from `watchJql` storage key; compares with `watchCount`; fires notification on increase; updates `watchCount`.
- **`pollMentions()`** — JQL `comment ~ "${jiraUsername}"`; compares with `mentionSeenKeys`; for a single new mention fetches comments to get the author name for the notification title (`"John Doe mentioned you in PROJ-123"`); updates `mentionSeenKeys`.
- **`pollAssignments()`** — JQL `assignee = currentUser() AND resolution = Unresolved`; compares with `assignedSeenKeys`; adds new keys to `pendingAssignments`; fires notification.

After all three pollers finish, **`refreshBadge()`** reads `watchCount`, `dismissedReturned`, `pendingAssignments`, and `mentionCount` from storage and sets the extension icon badge to the combined total. A `chrome.storage.onChanged` listener also calls `refreshBadge()` whenever the popup changes those keys (e.g. after dismissing a notification).

`bgFetch(jiraUrl, jiraPat, path)` is the shared fetch helper in the background — always add `credentials: 'omit'` and `X-Atlassian-Token: no-check`.

### API layer (`api.js`)
`JiraAPI` object with async methods. `JiraAPI.request(path, options)` is the base — adds auth headers, checks for 401/non-OK. All other methods call it.

Key methods:
- `getCurrentUser()` — cached in `_currentUser`; also persists `jiraUsername` to storage for the background worker.
- `_sameUser(author, me)` — compares by `accountId`, `name`, or `key` (handles both Jira Server and DC).
- `getMentions()` — fetches comments per issue, finds `[~username]` occurrences, skips dismissed and auto-hides if the user already replied after the mention.
- `getReturnedNotifications()` — reads `watchJql` + `dismissedReturned`; calls `getWatchedIssues`.
- `getAssignmentNotifications()` — reads `pendingAssignments`; verifies each is still assigned to the current user; cleans stale keys.

### Popup (`popup.js`)
Five tabs: My Issues | Search | Logged Work | Watching | Notifications.

Each lazy-loads on first click (flags: `workLoaded`, `watchingLoaded`, `notificationsLoaded`). The refresh button (↻) resets the flag for the active tab and reloads.

**Issue detail panel** — `toggleDetail(key, container)` accordion; lazy-fetches `getIssueDetails`; caches in `detailCache` Map. `buildDetailPanel(data)` renders description (uses `renderedFields` HTML from Jira), meta grid, time-tracking bar, linked issues, labels, epic.

**Notifications tab** — `loadNotifications()` runs three API calls in parallel, renders three sections (Returned · Assignments · Mentions) each with sticky section headers and dismiss buttons. `updateAfterDismiss()` removes empty section headers, updates the in-tab badge, and writes `mentionCount` back to storage so the extension icon badge stays in sync.

## Storage keys

| Key | Written by | Read by | Purpose |
|-----|-----------|---------|---------|
| `jiraUrl` | options.js | api.js, background.js | Jira base URL |
| `jiraPat` | options.js | api.js, background.js | Personal Access Token |
| `jiraUsername` | api.js (`getCurrentUser`) | background.js | Username for mention pattern matching |
| `watchJql` | options.js | background.js, api.js | JQL for Returned tickets polling |
| `watchingExcludeDone` | options.js | popup.js | Toggle for Watching tab filter |
| `watchCount` | background.js | popup.js (init badge seed) | Last returned tickets count |
| `mentionSeenKeys` | background.js | background.js | Issue keys seen in last mention poll |
| `mentionCount` | popup.js | background.js (badge) | Accurate filtered mention count |
| `dismissedMentions` | popup.js | api.js | `"PROJ-123:commentId"` keys dismissed by user |
| `pendingAssignments` | background.js (add), popup.js (remove on dismiss) | api.js, background.js | Issue keys needing acknowledgment |
| `assignedSeenKeys` | background.js | background.js | Issue keys seen in last assignment poll |
| `dismissedReturned` | popup.js | api.js, background.js | Issue keys dismissed from Returned section |
| `notifyReturned` | options.js | background.js | Desktop notification toggle |
| `notifyMentions` | options.js | background.js | Desktop notification toggle |
| `notifyAssignments` | options.js | background.js | Desktop notification toggle |

## Key constraints

- **Never send cookies** — all fetches must include `credentials: 'omit'` and `'X-Atlassian-Token': 'no-check'`. Removing these logs the user out of Jira.
- **Host permission is optional** — declared as `optional_host_permissions: ["https://*/*"]` in the manifest. `options.js` calls `chrome.permissions.request({ origins: [url + '/*'] })` when the user saves or tests their URL. `popup.js init()` checks `chrome.permissions.contains()` and shows a re-configure prompt if permission is missing.
- **Jira Server API v2** — use `/rest/api/2/` paths. The instance is self-hosted Server/Data Center, not Jira Cloud.
- **No build step** — no npm, no bundler. Plain ES2020 JS that Chrome runs directly.
- **No external libraries** — no React, no jQuery, no lodash. Use native DOM APIs.
- **Popup width is 560 px**, max-height 580 px. The 5 tabs fit with `padding: 9px 10px`.
- **`escHtml()`** must wrap all user-controlled strings before inserting into innerHTML.
- **`_sameUser(author, me)`** must be used instead of direct `author.name === username` comparisons — Jira Server uses `name`, DC uses `accountId`.

## Jira mention format
On self-hosted Jira Server, mentions in comment wiki markup are `[~username]`. The JQL to find issues containing mentions is `comment ~ "username"` (without brackets/tilde — the `~` prefix in the search value causes a 400 error). After fetching comments, filter by `body.includes('[~username]')` for exact matching.

## CSS conventions
- BEM-like class names per component: `.issue-*`, `.notif-*`, `.dp-*` (detail panel), `.legend-*`
- `.hidden` utility: `display: none !important`
- Status badge colours: `.status-todo` (grey), `.status-inprog` (blue), `.status-done` (green)
- Notification type badges: `.notif-type-returned` (red), `.notif-type-assigned` (green), `.notif-type-mention` (blue)

## TODO (deferred features)
See `TODO.md` for the full backlog. Currently open items:
- Issue expand button: change to circle shape, background-colour-only press state (no rotation)
- My Issues: sticky status filter bar
- My Issues: "Blocked" chip red, distinct issue-type badge colours per type
- Logged Work: faster date picker (replace native `<input type="date">`)
- Logged Work: pie chart slice hover tooltip
