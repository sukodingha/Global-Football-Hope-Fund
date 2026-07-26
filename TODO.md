# Rebuild Predictions Module — COMPLETE

## Steps

- [x] Plan approved
- [x] 1. Rewrite `js/predictions.js` — full rebuild with:
  - 5-day rolling calendar selector (Today + 4 future days)
  - 20 fixtures per date with future kick-off times (14:00, 16:30, 18:00, 20:00)
  - `userSlip[]` array with toggle/swap logic
  - Save to `user_predictions` collection in Firestore
  - Settlement engine: >=6/7 correct → award 2 HP
  - History query without `orderBy` → no index crash
- [x] 2. Update `pages/predictions.html` — added `#dateCalendar` container, updated banner counter text
- [x] 3. Verify no broken dependencies — uses same Firebase/Rewards imports as before
- [x] 4. **Dynamic match times update**:
  - `getShuffledTeamsForDate()` — deterministic rotation per date so each tab shows distinct pairings
  - **Today**: kick-offs start from `currentHour + 1` with 15-min intervals up to 22:00
  - **Future dates**: standard slots (12:00, 14:30, 17:00, 19:30, 21:00 etc.)
  - Past kick-offs are filtered out (`kickoff.getTime() <= now` condition)
  - Fallback padding ensures at least 7 fixtures even late in the day

## Status: ✅ Complete

