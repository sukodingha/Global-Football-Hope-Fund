# Community Page Layout Update - TODO

## ✅ Step 1: Edit community.html
- [x] Remove Members card (`.fb-sidebar-card` with `#membersList` and `#friendRequestsList`)
- [x] Reorder sidebar: Community Chat (top) → My Teammates & Chat (bottom)
- [x] Ensure `#dmChatPanel` is inside the Teammates card
- [x] Add `sidebar-toggle-btn` for mobile responsiveness

## ✅ Step 2: Edit css/style.css
- [x] Update `.fb-sidebar` with sticky positioning (`position: sticky; top: 20px; max-height: 90vh; overflow-y: auto;`)
- [x] Set max-height with overflow for chat-list and teammates-list inside sidebar
- [x] Update responsive breakpoint from 980px → 768px
- [x] Add mobile sidebar toggle button styles
- [x] Ensure proper column widths (1fr for main, 340px for sidebar)

## ✅ Step 3: Edit js/community.js
- [x] Add mobile sidebar toggle handler (show/hide with `hidden` attribute)
- [x] Add window resize listener to auto-show sidebar on desktop widths

## Step 4: Verify
- [ ] Open `pages/community.html` in browser
- [ ] Test sticky sidebar behavior on scroll
- [ ] Test responsive single-column layout at ≤ 768px
- [ ] Test mobile toggle button functionality

