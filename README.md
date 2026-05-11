# Jira Quick Access — Chrome Extension

A Chrome extension for fast, focused access to a self-hosted Jira instance (Server / Data Center). Built with vanilla JS, no build step required — just load the folder as an unpacked extension.

## Features

| Tab | Description |
|-----|-------------|
| **My Issues** | All tickets assigned to you, filterable by status with a sticky filter bar |
| **Search** | Full-text JQL search across unresolved issues |
| **Logged Work** | Donut chart of time logged today / this week / this month / custom range |
| **Watching** | Issues you are watching (optionally hiding Done tickets) |
| **Notifications** | Unified feed of Returned tickets, new Assignments, and Mentions — each dismissible |

### Background polling (every 5 min)
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
| Returned Tickets JQL | JQL filter polled every 5 min, e.g. `labels = my_label AND assignee = currentUser() AND status != Done` |
| Watching — exclude Done | Hides resolved tickets from the Watching tab |
| Notifications — Returned | Toggle desktop notifications for returned tickets |
| Notifications — Mentions | Toggle desktop notifications for new mentions |
| Notifications — Assignments | Toggle desktop notifications for new assignments |

## Authentication

The extension authenticates with a **Personal Access Token** sent as a `Bearer` header. Cookies are never sent (`credentials: omit`) to prevent Jira session invalidation.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Persist settings, dismissed notifications, and poll state |
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
