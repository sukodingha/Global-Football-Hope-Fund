# Photo Upload Refactor & Profile Edit System — Complete

## ✅ Completed

### TASK 1: Dashboard Photo Upload (Cloudinary)
- [x] `js/dashboard.js`: Added `handleImageUpload()` Cloudinary function (as provided)
- [x] `js/dashboard.js`: Added `uploadToCloudinary()` helper, replaced `uploadToFirebaseStorage()` in all handlers
- [x] `js/dashboard.js`: Removed Firebase Storage imports (`getStorage`, `ref`, `uploadBytes`, `getDownloadURL`)

### TASK 2: Public User Profile View & Wall
- [x] `pages/profile.html`: Full profile page template
- [x] `js/profile.js`: Reads `?uid=` param, fetches Firestore, renders profile
- [x] `js/community.js`: Post card header linked to profile, comment authors linked

### TASK 3: Edit Profile System with 10-Edit Limit
- [x] `pages/dashboard.html`: Added "✏️ Edit Profile" toggle button, `#profileEditSection` with readonly Display Name, editable Bio, Country, City, Favorite Team fields
- [x] `js/dashboard.js`: 
  - Added `addDoc`, `increment`, `serverTimestamp` imports
  - `loadEditableProfile()` now loads Bio, Country, City, Favorite Team
  - `handleSaveProfile()`:
    - If `editCount < 10`: Updates Firestore directly, increments `editCount`, shows success message
    - If `editCount >= 10`: Saves to `pendingEdits` collection with `{ userId, updatedFields, requestedAt, status: 'pending' }`, shows alert
  - Edit Profile toggle shows/hides the edit form
  - Profile Summary now shows Bio and Edits used (X / 10)

### TASK 4: Git Staging
- [x] `git add .` executed

