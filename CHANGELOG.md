# Changelog

## [1.5.1] — 2026-05-14

### Fixed
- **Log to Jira** button in session history is now the same size as the **▾ Notes** toggle (`font-size: 10px`, `padding: 1px 6px`, 1px border) — previously it was visually larger

---

## [1.5.0] — 2026-05-14

### Added
- **Log Work to Jira** — every completed session in the session history now has a **Log to Jira** button. Clicking it posts the session duration and notes (as a worklog comment) directly to Jira via `POST /rest/api/2/issue/{key}/worklog`. Once logged the button turns into a green **✓ Logged** badge so it cannot be double-submitted. Works from both the TT section (notes panel) and the issue detail panel (Local Time Tracking section).

---

## [1.4.0] — 2026-05-14

### Added
- **Dark mode** — full dark theme across popup and settings; every component adapts; toggle with the 🌙 / ☀️ button in the popup navbar; preference persists across sessions
- **Extension icon in navbar** — the blue "J" placeholder is replaced with the actual extension icon (`icon48.png` scaled to 22×22 px)
- **Pie chart hover tooltips** — hovering a donut segment shows a native SVG tooltip with the issue key and logged time (e.g. `PROJ-42 — 2h 30m`)

---

## [1.3.1] — 2026-05-14

### Changed
- Pin button now matches the timer button exactly in size and box style (`font-size: 16px`, `padding: 3px 7px`, same border/radius)
- Timer and pin buttons are stacked vertically in a shared column group on each issue card
- Expand (›) button remains on the far right but is now vertically centred on the imaginary midpoint between the timer and pin buttons

---

## [1.3.0] — 2026-05-14

### Added
- **Pinned Tasks** — pin any task in My Issues with the 📌 button (gray = unpinned, full-color = pinned). Pinned tasks appear in a dedicated **Pinned** section between the Time Tracking section and My Tasks. Starting a timer on a pinned task moves it to Time Tracking; stopping the timer returns it to Pinned. Pins persist across popup close/reopen via `chrome.storage.local`.
- **Local search in My Issues** — real-time search input below the filter chips filters tasks by ID and summary on every keystroke; case-insensitive, works with special characters (`[`, `]`, `*`, etc.); layered on top of the active status filter tab.

### Fixed
- Issue type badge colours — Sub-task check was being swallowed by the Task check; Sub-task now correctly shows light blue (`Sb`) and Task shows blue (`T`)
- **Blocked** filter chip now has a red background/border to stand out from other status chips
- Filter chips bar is now sticky — only the issue list scrolls; filter chips, search input, and Time Tracking section stay fixed at the top
- Settings page description texts now reference the correct **1-minute** poll interval instead of "5 minutes"

---

## [1.2.1] — 2026-05-14

### Changed
- Background polling interval reduced from 5 minutes to **1 minute** — assignments, mentions, and returned tickets are now detected much faster

---

## [1.2.0] — 2026-05-14

### Added — Create Issue
- **+ button** in the blue navbar opens a slide-in Create Issue form (white panel)
- **Project** dropdown — all projects fetched from Jira, sorted alphabetically
- **Issue Type** dropdown — populated per selected project; Task pre-selected by default
- **Labels** tag-chip input — autocomplete from existing Jira labels while typing; press Enter or comma to confirm; new labels are created on submit if they don't exist
- **Assignee** field — pre-filled with the current user; typeahead search to change assignee
- **Summary** and **Description** fields
- **Advanced** collapsible section:
  - Estimate and Remaining Estimate (Jira time format, e.g. `2h 30m`)
  - Linked Issues — one or more rows each with a link type dropdown (relates to / blocks / is blocked by / clones / is cloned by / duplicates / is duplicated by — all link types fetched live from Jira) and a predictive issue search input
- On success, button turns green showing the new issue key; panel closes and My Issues refreshes after 1.8 s
- Escape key closes the panel; Cancel button also closes it
- **Default Project** setting in the Settings page — choose a project that is pre-selected every time the Create Issue form opens; changeable per issue from the dropdown

---

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
