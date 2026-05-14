# Backlog

## Settings page

- [x] Layout the two cards side-by-side (CSS grid/flexbox), not stacked vertically; Connection card must come first (left)
- [x] Replace the example URL placeholder with `example.com`
- [x] Anonymise the Returned Tickets JQL placeholder — remove personal label name and username, use generic values
      e.g. `labels = my_watch_label AND assignee = currentUser() AND status != Done`


## Issue list

- [x] Expand toggle button: replace current rectangular shape + rotation with a circle; on press change background color only, no rotation animation

## My Issues

- [x] **Pinned Tasks** — add a pin button to each task card in My Issues.
      - Pin button appearance: gray when unpinned, red when pinned; clicking again unpins (red → gray).
      - Pinned tasks move into a new **Pinned Tasks** section above the regular My Tasks list.
      - Section order (top → bottom): Time Tracking (if active) → Pinned Tasks (if any) → My Tasks.
      - Starting the timer on a *pinned* task moves it into Time Tracking; if no other pins remain, Pinned Tasks section disappears.
      - Starting the timer on a *non-pinned* task moves it into Time Tracking; Pinned Tasks section stays.
      - Stopping the timer returns the task to Pinned Tasks if it was pinned before tracking, otherwise to My Tasks.
      - Persist pinned IDs in `chrome.storage.local` (key `pinnedTaskIds: string[]`) so pins survive popup close/reopen.
      - Track a `wasPinnedBeforeTracking` flag per task so stop-timer returns it to the correct section.

- [x] **Local search in My Issues** — add a search input below the filter tabs, above the task list.
      - Placeholder: `Search by ID or summary…`
      - Fires on every keystroke (real-time, no submit button).
      - Case-insensitive, partial-match on both task ID (e.g. `PROJ-11111`) and summary text.
      - Special characters treated as literals (use `String.includes` or escape input before `RegExp`).
      - Search is a *secondary* filter layered on top of the active tab filter:
        - "All" tab + search "11111" → searches all issues for "11111"
        - "Blocked" tab + search "up" → searches only within already-blocked issues
      - Switching filter tabs keeps the search text and re-applies it to the new tab's results.
      - Pinned Tasks and My Tasks sub-sections each filter independently.
      - No new Jira API calls — operates purely on the already-fetched in-memory task list.
      - Examples: typing "up"/"UP"/"Up" matches summary "Update Rancher version"; typing "[D" matches "[DevOps] Deploy pipeline".

- [x] Status filter bar must be sticky (fixed position) so it doesn't scroll away with the issue list
- [x] "Blocked" filter chip must have a red background/color to stand out
- [x] Issue type badge colors must be distinct per type:
      S (Story) → green, T (Task) → blue, B (Bug) → red, E (Epic) → purple, Sub-task → light blue, etc.
      Currently all use `issueTypeColor()` in popup.js but the initials mapping ("S", "T") needs to be consistent

## Notifications / Returned

- [ ] Document recommended watch JQL for "returned from stage" use cases, e.g.
      `status changed to "In Progress" FROM "Code Review" AND assignee = currentUser()`
      The plugin only knows the current ticket status — it cannot show which stage a ticket was returned from
      unless the JQL itself encodes the transition.

## UI / Branding

- [ ] Add extension icon to the blue header navbar in the popup (next to the "Jira" title)
- [ ] Dark mode — honour `prefers-color-scheme: dark`; define a dark palette for the popup and options page

## Logged Work

      - [ ] Date picker (custom period) is too slow — replace month-by-month navigation with a faster control
            that jumps a full month per scroll/click (native `<input type="date">` is sluggish in the extension popup)
      - [ ] Pie chart hover — show a tooltip with the ticket ID (and ideally time) when hovering over a slice
