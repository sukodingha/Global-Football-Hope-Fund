# Implementation TODOs: Expandable Slips, Leaderboard Visibility, 3-Day Expiry & 3/Day Limit

## All Steps Completed ✅

- [x] Analyzed existing codebase (predictions.js, predictions.html, style.css)
- [x] Created implementation plan
- [x] Plan approved
- [x] **CSS styles added** — New styles in `css/style.css`:
  - Expandable slip styles (`.slip-history-item`, `.slip-toggle-btn`, `.slip-expanded-content`, `.slip-pick-row`, etc.)
  - Daily limit counter (`.daily-limit-counter`, `.daily-limit-counter.limit-reached`)
  - Winning slip modal styles (`.winning-slip-modal-body`, `.winning-slip-pick`, `.winning-slip-badge`, etc.)
  - Leaderboard view button (`.leaderboard-view-btn`)
- [x] **predictions.html updated** — Added `#dailyLimitCounter` span in the slip banner
- [x] **Feature 1: Expandable History** — `loadSlipHistory()` renders slips with toggle buttons; `toggleSlipExpand()` handles expand/collapse; each pick shows Home vs Away + formatted pick value
- [x] **Feature 2: Winning Slips on Leaderboard** — `loadLeaderboard()` adds "🏆 View" button in 5th column; `openWinningSlipModal()` creates modal with full 7-pick ticket details
- [x] **Feature 3: 3-Day Expiry** — `loadSlipHistory()` filters out non-won slips older than 3 days; optionally deletes expired docs with `deleteDoc()`
- [x] **Feature 4: Daily 3-Slip Limit** — `updateDailyLimitCounter()` queries today's count and displays "Today's Submissions: X / 3"; `submitSlip()` blocks submission if >= 3 with alert message
- [x] **Final review completed** — All code verified via `read_file` on all modified files


