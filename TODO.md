# Photo Upload Refactor & Public Profile — Progress Tracker

## ✅ Completed Steps
- All dashboard photo upload UI/JS/CSS changes

## 📋 Steps

### TASK 1: Fix Dashboard Photo Upload Pipeline
- [x] Already done in previous pass — `handleProfilePhotoUpload()` covers Storage → Auth → Firestore → UI

### TASK 2: Public User Profile View & Wall (`pages/profile.html` + `js/profile.js`)
- [ ] Create `pages/profile.html` — Full profile page template
- [ ] Create `js/profile.js` — Profile loader: reads `?uid=`, fetches Firestore user doc, renders profile header, wall feed, photo gallery
- [ ] Link Community Posts: Edit `js/community.js` to wrap avatar/name in `<a>` pointing to `profile.html?uid=`

### TASK 3: Git Stage
- [ ] Run `git add .`

