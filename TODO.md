# Predictions Overhaul - DONE ✅

## Completed Changes

### 1. Removed ALL Mock/Hardcoded Data ✅
- [x] Deleted `TEAMS_POOL` constant array (Arsenal, Chelsea, Inter Milan, Juventus, etc.)
- [x] Deleted `getShuffledTeamsForDate()` function
- [x] Deleted `generateFixturesForDate()` function
- [x] Deleted `getMockResult()` function and `getScoreWinner()` helper (kept `getScoreWinner` for real API use)
- [x] Removed mock fallback in leaderboard (5 dummy users)
- [x] Removed fallback padding logic for late-hour fixture generation

### 2. Added Real API Fetching ✅
- [x] Added `API_KEY` and `API_HOST` constants from dashboard.js
- [x] Added `async function fetchFixturesFromAPI(dateStr)` that calls `GET /fixtures?date=YYYY-MM-DD`
- [x] Maps API response to fixture shape: `id` (real fixture.fixture.id), `league`, `homeTeam`, `awayTeam`, `date`, `status`

### 3. Filter by Current Time ("Today") ✅
- [x] Gets `const now = new Date()` on Today tab
- [x] Filters fixtures to only show matches where `kickoffTime > now`
- [x] Displays "⏰ No more upcoming matches scheduled for today. Please select tomorrow's tab!" when none remain

### 4. Updated `loadFixturesForDate()` to be async ✅
- [x] Calls `fetchFixturesFromAPI(dateStr)` instead of `generateFixturesForDate()`
- [x] Time filtering applied only for Today tab

### 5. Updated Settlement Engine ✅
- [x] Settlement uses real API results via `fetchRealFixtureResult(matchId)`
- [x] Only settles matches with status "FT" (full-time)
- [x] Supports both new `pick` field format and legacy `winner`/`goals` fields

### 6. Removed Mock Leaderboard Fallback ✅
- [x] Replaced with: "No winners yet. Be the first to get 6/7 correct! 🏆"

### 7. NEW: 1 Pick Per Match (Single Button) ✅
- [x] Each match card now shows 5 buttons: winner_1, winner_X, winner_2, goals_over2.5, goals_under2.5
- [x] Clicking any button selects it (adds to slip)
- [x] Clicking the same button again deselects it
- [x] Clicking a different button swaps the pick
- [x] Visual feedback: `selected-btn` class + `odds-card-selected` highlight
- [x] Must select exactly 7 different matches to submit

