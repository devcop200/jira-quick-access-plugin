# Backlog

## Settings page

- [x] Layout the two cards side-by-side (CSS grid/flexbox), not stacked vertically; Connection card must come first (left)
- [x] Replace the example URL placeholder with `example.com`
- [x] Anonymise the Returned Tickets JQL placeholder — remove personal label name and username, use generic values
      e.g. `labels = my_watch_label AND assignee = currentUser() AND status != Done`


## Issue list

- [ ] Expand toggle button: replace current rectangular shape + rotation with a circle; on press change background color only, no rotation animation

## My Issues

- [ ] Status filter bar must be sticky (fixed position) so it doesn't scroll away with the issue list
- [ ] "Blocked" filter chip must have a red background/color to stand out
- [ ] Issue type badge colors must be distinct per type:
      S (Story) → green, T (Task) → blue, B (Bug) → red, E (Epic) → purple, Sub-task → light blue, etc.
      Currently all use `issueTypeColor()` in popup.js but the initials mapping ("S", "T") needs to be consistent

## Logged Work

      - [ ] Date picker (custom period) is too slow — replace month-by-month navigation with a faster control
            that jumps a full month per scroll/click (native `<input type="date">` is sluggish in the extension popup)
      - [ ] Pie chart hover — show a tooltip with the ticket ID (and ideally time) when hovering over a slice
