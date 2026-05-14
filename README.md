# Jira Quick Access — Chrome Extension

A Chrome extension for fast, focused access to a self-hosted Jira instance (Server / Data Center). Built with vanilla JS, no build step required — just load the folder as an unpacked extension.

## Features

| Tab | Description |
|-----|-------------|
| **My Issues** | All tickets assigned to you, filterable by status, searchable by ID or summary, with pinned tasks support |
| **Search** | Full-text JQL search across unresolved issues |
| **Logged Work** | Donut chart of time logged today / this week / this month / custom range |
| **Watching** | Issues you are watching (optionally hiding Done tickets) |
| **Notifications** | Unified feed of Returned tickets, new Assignments, and Mentions — each dismissible |

### Create Issue
Click the **+** button in the navbar to open the Create Issue form:

- **Project** dropdown (all projects, alphabetically sorted)
- **Issue Type** dropdown (per-project, Task pre-selected)
- **Labels** — tag-chip input with autocomplete against existing labels; new labels are created on submit
- **Assignee** — pre-filled with you; typeahead search to change
- **Summary** and **Description**
- **Advanced** section (collapsible): Estimate, Remaining Estimate, and Linked Issues with live link-type dropdown and predictive issue search

### My Issues

- **Status filter chips** — sticky bar at the top lets you filter by Jira status (All / In Progress / Blocked / etc.); the Blocked chip is highlighted red
- **Local search** — search box below the filter chips filters by task ID or summary on every keystroke; case-insensitive and special-character safe; layered on top of the active status filter
- **Pinned tasks** — click the 📌 button on any task card to pin it; pinned tasks appear in a **Pinned** section above My Tasks, below the Time Tracking section; pins persist across popup open/close; unpinning or starting a timer moves the task to the appropriate section automatically

### Local time tracking
Track time spent on any ticket directly from the popup — no Jira access required:

- **Clock button** on every issue row starts or pauses a timer
- **Time Tracking section** appears above My Issues showing all active timers; the running one is always first
- **Navbar chip** shows the running timer in red with inline pause / stop / notes controls; additional timers collapse into a `+N` overflow menu
- Starting a new timer **auto-pauses** the currently running one — only one timer runs at a time
- **Session notes** — write notes per session with auto-save every 5 seconds and an explicit Save button
- **Session history** — every stopped session is saved with its duration, date, and notes; notes are editable after the fact; individual sessions can be deleted
- Minimum session duration of **1 minute** (stopping at 45 s records 1 m)
- All data is stored locally in `chrome.storage.local` — nothing is sent to Jira

### Background polling (every 1 min)
- Checks your **Returned Tickets** JQL filter and notifies when the count rises
- Detects new **Assignments** and fires a desktop notification
- Detects new comment **Mentions** (`[~username]`) and fires `"John Doe mentioned you in PROJ-123"`
- Keeps the **extension icon badge** updated with the total notification count

### Issue detail panel
Every issue row has an expand button (`›`) that shows an inline detail panel with description, meta grid, time-tracking bar, linked issues, labels, and epic — without leaving the popup.

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder
5. Open **Settings** (⚙ in the popup) and enter your Jira URL and Personal Access Token

> **VPN required** — the extension talks directly to your self-hosted Jira instance.

## Configuration

All settings are in the **Settings** page (⚙ button):

| Setting | Description |
|---------|-------------|
| Jira URL | Base URL of your instance, e.g. `https://jira.example.com` |
| Personal Access Token | Generated at Jira → Profile → Personal Access Tokens |
| Returned Tickets JQL | JQL filter polled every 1 min, e.g. `labels = my_label AND assignee = currentUser() AND status != Done` |
| Watching — exclude Done | Hides resolved tickets from the Watching tab |
| Notifications — Returned | Toggle desktop notifications for returned tickets |
| Notifications — Mentions | Toggle desktop notifications for new mentions |
| Notifications — Assignments | Toggle desktop notifications for new assignments |

## Authentication

The extension authenticates with a **Personal Access Token** sent as a `Bearer` header. Cookies are never sent (`credentials: omit`) to prevent Jira session invalidation.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Persist settings, dismissed notifications, poll state, and local time tracking data |
| `alarms` | Schedule the 5-minute background poll |
| `notifications` | Show desktop notifications |
| `host_permissions` for your Jira URL | Make authenticated API calls to the REST API |

## Development

No build step. Edit the source files and click **Reload** on the extension card in `chrome://extensions/`.

```
.
├── manifest.json       # MV3 manifest
├── background.js       # Service worker — polling, badge, notifications
├── api.js              # JiraAPI object — all REST API calls
├── popup.html/css/js   # Main popup UI
├── options.html/css/js # Settings page
└── icon.svg            # Extension icon
```

## License

MIT — see [LICENSE](LICENSE)
