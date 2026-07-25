# Chat Image Upload Fixes - TODO

## ✅ Step 1: Fix `listenToChat` in community.js
- Handle both field naming conventions (`authorId`/`userId`, `authorName`/`username`, `createdAt`/`timestamp`)
- Ensure images render properly in community chat messages

## ✅ Step 2: Fix floating chat (teammate) listener in community.js
- Add image rendering with `.chat-shared-image` class and `onclick="window.open(...)"`
- Check if `msg.imageUrl` is present and non-empty before appending

## ✅ Step 3: Update `.chat-shared-image` in style.css
- Set `max-width: 200px; max-height: 200px;`
- Set `margin-top: 6px;`
- Keep existing `min-width`, `min-height`, `border-radius`, `object-fit`, `cursor` properties

