# Replace Firebase Storage with Cloudinary Upload — Dashboard

## ✅ Completed

### TASK 1: Profile Photo & User Wall
- [x] `pages/dashboard.html`: Added `#currentProfilePic`, `#uploadSpinner`, `#uploadAvatarBtn`, `#profilePicPlaceholder`
- [x] `js/dashboard.js`: `handleProfilePhotoUpload()` with Storage → Auth → Firestore pipeline, `guardDb()`, spinner controls, instant UI refresh
- [x] `css/style.css`: `.spinner` animation, `#currentProfilePic` styles, profile placeholder styles

### TASK 2: Public User Profile View & Wall
- [x] `pages/profile.html`: Full profile page template with header card, photo gallery, activity feed
- [x] `js/profile.js`: Reads `?uid=` param, fetches Firestore doc `users/${uid}`, renders profile header, gallery, user posts from `posts` collection
- [x] `js/community.js`: Post card header avatar + name wrapped in `<a href="profile.html?uid=...">`, comment author names also linked

### TASK 3: Replace Firebase Storage with Cloudinary in dashboard.js ✅
- [x] Added `handleImageUpload()` Cloudinary function (accepts file input element)
- [x] Added `uploadToCloudinary()` helper function (accepts File object directly)
- [x] Replaced `uploadToFirebaseStorage()` with Cloudinary-based upload
- [x] Updated `handleProfilePhotoUpload()` to use Cloudinary
- [x] Updated gallery photo upload handler to use Cloudinary
- [x] Removed unused Firebase Storage imports (`getStorage`, `ref`, `uploadBytes`, `getDownloadURL`)

