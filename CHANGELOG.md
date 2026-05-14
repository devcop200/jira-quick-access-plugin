# Changelog

## [1.1.1] — 2026-05-14

### Fixed
- Ticket ID in the Time Tracking section was plain text instead of a clickable link — clicking the key now opens the issue in Jira

---

## [1.1.0] — 2026-05-13

### Added — Local Time Tracking
- Clock button (⏱) on every issue row to start or pause a timer
- **Time Tracking section** above My Issues showing all active timers; the running timer is always listed first
- **Navbar chip** displays the running timer in red with inline pause / stop / notes controls; additional timers collapse into a `+N` overflow panel
- Starting a new timer auto-pauses the currently running one — only one timer runs at a time
- **Session notes** with 500 ms debounce autosave, 5-second periodic autosave, and an explicit Save button
- **Session history** per ticket: every stopped session records duration, date, and notes
  - Notes are editable after the fact directly in the history panel
  - Individual sessions can be deleted; deletion updates the total time immediately
- Minimum session duration of 1 minute (stopping at < 60 s records 1 m)
- Live timer counters update every second via a shared `setInterval` tick
- All tracking data stored locally in `chrome.storage.local` — nothing sent to Jira

### Added — UI improvements
- Expand button restyled as a circle with blue background on active state (rotation animation preserved)
- Time chip next to ticket ID shows total tracked time with a tooltip
- Emoji variation selector applied to ▶️ ⏸️ ⏹️ for consistent rendering size across platforms

---

## [1.0.0] — 2026-05-12

### Added — Initial release
- **My Issues** tab: all assigned tickets filterable by status; only statuses with tickets appear
- **Search** tab: full-text JQL search across unresolved issues
- **Logged Work** tab: donut chart of time logged today / this week / this month / custom range; click any slice to open the ticket
- **Watching** tab: all watched issues with optional hiding of Done tickets
- **Notifications** tab: unified feed of Returned tickets (custom JQL), new Assignments, and Mentions; each dismissible individually
- **Issue detail panel**: inline expand showing description, meta grid, time-tracking bar, linked issues, labels, and epic
- **Background polling** every 5 minutes with desktop notifications and live badge count
- Mention notifications include author name: "Jane Smith mentioned you in PROJ-42"
- Per-notification-type toggles (Returned, Assignments, Mentions) in Settings
- Bearer PAT authentication — token stored only in local browser storage
- GitHub Actions workflow to publish to Chrome Web Store on version tag push
