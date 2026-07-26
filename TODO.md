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

## Status: ✅ Complete

