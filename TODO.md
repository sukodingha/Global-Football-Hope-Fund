# GFHF Predictions Page Fix - TODO

## Step 1: Fix predictions.html broken slipBanner HTML ✅
- Close unclosed `<div>` in slipBanner section

## Step 2: Fix js/predictions.js - renderFixtures() broken HTML ✅
- Properly close all divs in the HTML template string
- Fix odds-teams, odds-card, prediction-section divs

## Step 3: Fix js/predictions.js - API Integration ✅
- Keep RapidAPI but add proper caching (Map by dateStr)
- Add request debouncing for calendar clicks
- Add proper error handling with user-facing messages
- Ensure loading indicators always hide

## Step 4: Fix js/predictions.js - Add missing CSS class styles inline ✅
- pred-btn missing base styles - add inline styles to template

## Step 5: Fix js/competition.js - API Integration ✅
- Same caching pattern, error handling
- Remove auto-refresh to prevent 429

## Step 6: Fix js/dashboard.js - Remove duplicate API block ✅
- Remove the second API_KEY/API_HOST and fetchLiveScores at bottom

## Step 7: Fix css/style.css - Add missing pred-btn styles ✅

