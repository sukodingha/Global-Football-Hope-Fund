# Community Page — Facebook-Style Comment/Reply/Reaction UI

## ✅ Completed

### community.html
- [x] Sidebar restructured: 2 cards (Community Chat + My Teammates & Chat Box)
- [x] Removed Members & Friend Requests cards
- [x] Added `sidebar-toggle-btn` for mobile toggle

### css/style.css
- [x] Added `.cmt-actions-bar`, `.cmt-action-btn` (Reply / React buttons)
- [x] Added `.cmt-reactions-bar`, `.cmt-reaction-btn`, `.reacted` state
- [x] Added `.cmt-emoji-picker`, `.cmt-emoji-btn` (❤️ 👍 😂 😮 🔥)
- [x] Added `.cmt-reply-form`, `.cmt-replies`, `.cmt-reply-item` (nested replies)
- [x] Updated `.fb-post-image-single img` to `object-fit: contain`
- [x] Updated `.fb-page` layout with `margin-right` for sidebar offset
- [x] Added `#floatingChatSidebar` fixed sidebar styles
- [x] Responsive breakpoint at 768px with sidebar toggle

### js/community.js
- [x] `generateCommentId()` — unique per-comment ID
- [x] `COMMENT_EMOJIS` — 5 emoji options for reactions
- [x] Comments section in `renderPostCard`:
  - Each comment rendered with `data-comment-id` attribute
  - Reply toggle button toggles inline `.cmt-reply-form`
  - Emoji toggle button shows/hides `.cmt-emoji-picker`
  - Reaction buttons show count + `reacted` class
  - Sub-replies rendered in `.cmt-replies` div with indentation
- [x] `toggleCommentReaction(commentId, emoji)` — reads/writes Firestore
- [x] Reply submit appends to `comment.replies[]` in Firestore
- [x] Enter key support on all inputs
- [x] Mobile sidebar toggle handler

