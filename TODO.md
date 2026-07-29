# HP Formatting Task - TODO

## Objective
Ensure every HP point displayed in the DOM uses `.toFixed(3)` formatting via a global `formatHP()` helper.

## Steps

- [x] Step 1: Add `formatHP()` function to `js/rewards.js` and export it
- [x] Step 2: Update `getHPBadgeHTML()` in `js/rewards.js` to use `formatHP()`
- [x] Step 3: Update `js/home.js` - format leaderboard HP display with `formatHP()`
- [x] Step 4: Update `js/dashboard.js` - format all HP displays in rewards card with `formatHP()`
- [x] Step 5: Update `js/community.js` - ensure HP badges use `formatHP()` (via rewards.js)
- [x] Step 6: Update `js/predictions.js` - format leaderboard HP values and HP messages with `formatHP()`
- [x] Step 7: Verify all changes are consistent

