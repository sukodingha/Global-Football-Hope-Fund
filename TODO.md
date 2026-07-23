# Photo Upload Refactor — Progress Tracker

## ✅ Completed Steps

## 📋 Steps

### Step 1: `pages/dashboard.html` — UI Changes
- [x] Add `<img id="currentProfilePic">` inside "Profile Picture" form-section
- [x] Add loading spinner `<div id="uploadSpinner" class="spinner" hidden></div>`
- [x] Add `#uploadAvatarBtn` button next to hidden file input

### Step 2: `js/dashboard.js` — Core Logic Refactor
- [x] Add safe Firestore DB guard checks (`if (!db) return;`)
- [x] Refactor `uploadToFirebaseStorage()` to use path `profile_pictures/${uid}/${Date.now()}`
- [x] Create `handleProfilePhotoUpload(file)` combined handler (uploads → Auth → Firestore → UI refresh)
- [x] Refactor `avatarUploadInput` change handler to use new handler
- [x] Wire `#uploadPhotoBtn` + `#photoUploadInput` for gallery with instant refresh
- [x] Add `updateCurrentProfilePicUI()` for instant #currentProfilePic refresh
- [x] Add spinner controls (`showSpinner`/`hideSpinner`)
- [x] Load existing photo into #currentProfilePic on page load

### Step 3: `css/style.css` — New Styles
- [x] Add `.spinner` animation styles
- [x] Add `#currentProfilePic` styles
- [x] Add `.profile-pic-placeholder` styles
- [x] Add `#uploadAvatarBtn:disabled` styles

### Step 4: Git Stage
- [ ] Run `git add .`

