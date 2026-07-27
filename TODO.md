# Implementation TODOs: Expandable Slips, Leaderboard Visibility, 3-Day Expiry & 3/Day Limit

## ✅ Completed

- [x] Analyzed existing codebase (predictions.js, predictions.html, style.css)
- [x] Created implementation plan (Plan approved)
- [x] **Step 1: Added CSS styles** — expandable slips, winning slip modal, daily limit counter, leaderboard view button ✅
- [x] **Step 2: Feature 4 — Daily 3-Slip Limit** ✅
  - `updateDailyLimitCounter()` queries today's submissions and shows "X / 3"
  - `submitSlip()` checks the limit before allowing submission
  - Counter displays with `limit-reached` CSS class when at max
- [x] **Step 3: Feature 3 — 3-Day Expiry** ✅
  - `loadSlipHistory()` filters out non-winning slips older than 3 days
  - Optionally deletes expired docs from Firestore via `deleteDoc()`
  - Winning slips always shown regardless of age
- [x] **Step 4: Feature 1 — Expandable History** ✅
  - Each slip rendered with a "🔽 View Picks" toggle button
  - Expanded view shows all 7 picks with Home vs Away, user's pick, and match info
  - Friendly labels like "Winner: 1 (Home)" and "Total Goals: Over 2.5"
- [x] **Step 5: Feature 2 — Winning Slips on Leaderboard** ✅
  - First winning slip ID stored per user in leaderboard aggregation
  - "🏆 View" button renders next to each leaderboard entry
  - `openWinningSlipModal()` creates a styled modal with full winning slip details
  - Modal shows ticket header, all picks, and "+2 HP Awarded" badge
- [x] **Step 6: Fixed `competition.html`** — Modernized with splash screen, auth modal, PWA install, mobile nav, service worker registration
- [x] **Step 7: Final review** — All features verified in predictions.js and style.css

