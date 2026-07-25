# Chat Image Upload Fixes - Todo

## ✅ Step 1: Fix `listenToChat` in community.js
- Handle both field naming conventions (`authorId`/`userId`, `authorName`/`username`, `createdAt`/`timestamp`)
- Ensure images render properly in community chat messages

## ✅ Step 2: Fix floating chat (teammate) listener in community.js
- Add image rendering with `.chat-shared-image` class and `onclick="window.open(...)"`
- Check if `msg.imageUrl` is present and non-empty before appending

## ✅ Step 3: Update `.chat-shared-image` in style.css

---

# Post Actions & HP Cleanup - Completed

## ✅ POST TOOLBAR CLEANUP
- Stats bar shows only: 👍 likes, 💬 comments, 👁️ views
- REMOVED HP earned display and HP tooltip from stats bar and action buttons

## ✅ BACKGROUND HP ACCUMULATION
- `trackPostImpression()` fires when posts enter viewport via IntersectionObserver
- Increments post `impressions` by 1
- Credits author's `hopePoints` by 0.0001 HP per impression using `increment()`
- Invalidates HP badge cache to trigger live refresh

## ✅ HP DISPLAY RESTRICTION
- HP badge (`post-hp-badge-placeholder`) only renders under author name in post header
- HP badge (`chat-hp-placeholder`) only renders under username in community chat messages
- No HP numbers appear in post action bars or stats bar

