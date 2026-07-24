# Community Page 3-Feature Implementation

## Feature 1: Nested Comment Replies & Emoji Reactions ✅
- [x] **js/community.js**: Add UUID generation for comments (`generateCommentId()`), structured comment objects with `id`, `reactions`, `replies` fields
- [x] **js/community.js**: Rewrite comment section to support reply threading (Reply button → inline reply form with `cmt-reply-toggle-btn`)
- [x] **js/community.js**: Add emoji reaction picker (❤️👍😂😮🔥) on comments with `cmt-emoji-picker`, toggle on/off via `cmt-emoji-toggle-btn`
- [x] **js/community.js**: Update comment submit & reply submit to handle nested replies via `replies` array in Firestore
- [x] **js/community.js**: Add event delegation for reply toggle, emoji picker toggle, emoji reactions, existing reaction buttons, and reply form submit with Enter key support
- [x] **css/style.css**: Add `.cmt-actions-bar`, `.cmt-action-btn`, `.cmt-reactions-bar`, `.cmt-reaction-btn`, `.cmt-emoji-picker`, `.cmt-emoji-btn`, `.cmt-reply-form`, `.cmt-replies`, `.cmt-reply-item` styles

## Feature 2: Block/Mute/Favorite Privacy Controls
- [ ] **js/privacy.js** (new): `loadPrivacySettings`, `blockUser`, `muteUser`, `favoriteUser`, `isBlocked`, `isMuted`
- [ ] **js/community.js**: Add dropdown menu on post options (•••) with Block/Mute/Favorite
- [ ] **js/community.js**: Filter blocked/muted users from feed and comments
- [ ] **css/style.css**: Add `.privacy-dropdown`, `.privacy-dropdown-item` styles

## Feature 3: Unread Chat Badges & Alerts
- [ ] **js/community.js**: Add real-time `onSnapshot` listener for unread message counts
- [ ] **js/community.js**: Track `lastReadTimestamps` in localStorage per chat key
- [ ] **js/community.js**: Add badge count to sidebar "Community Chat" and "My Teammates" headers
- [ ] **js/community.js**: Highlight teammates with unread messages + notification chime
- [ ] **css/style.css**: Add `.unread-badge`, `.unread-dot`, `.teammate-item.unread` styles

