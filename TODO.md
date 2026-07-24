# Community Page Layout Update - TODO

## ✅ Step 1: Edit community.html
- [x] Remove Members card (`.fb-sidebar-card` with `#membersList` and `#friendRequestsList`)
- [x] Reorder sidebar: Community Chat (top) → My Teammates & Chat (bottom)
- [x] Ensure `#dmChatPanel` is inside the Teammates card
- [x] Add `sidebar-toggle-btn` for mobile responsiveness

## ✅ Step 2: Edit css/style.css
- [x] Update `.fb-sidebar` with sticky positioning and scroll constraints
- [x] Set max-height with overflow for chat-list and teammates-list inside sidebar
- [x] Update responsive breakpoint from 980px → 768px
- [x] Add mobile sidebar toggle button styles
- [x] Ensure proper column widths (flex: 1 for main, ~320-360px for sidebar)

## ✅ Step 3: Edit js/community.js
- [x] Add mobile sidebar toggle handler (show/hide `#fbSidebar`)
- [x] Add resize listener to restore sidebar on screens > 768px

## Step 4: Verify
- [x] Open `pages/community.html` in browser
- [x] Test sticky sidebar behavior on scroll
- [x] Test responsive single-column layout at ≤ 768px
- [x] Test mobile sidebar toggle button

