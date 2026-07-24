# Feature Implementation TODO

## Feature 1: Teammate Request & Notification System
- [x] 1a. Edit `js/profile.js` - Send notification on "Add Teammate" click
- [x] 1b. Edit `js/notifications.js` - Add teammate_request notification rendering with Accept/Reject buttons
- [x] 1c. Edit `js/notifications.js` - Handle Accept (create teammate links + notify sender)
- [x] 1d. Edit `js/notifications.js` - Handle Reject (update status + notify sender)

## Feature 2: Fixed Bottom-Right Chat Box on Dashboard
- [x] 2a. Edit `pages/dashboard.html` - Add floating chat popup HTML (or ensure it exists)
- [x] 2b. Edit `css/style.css` - Ensure `.floating-chat-popup` has fixed bottom-right positioning
- [x] 2c. Edit `js/dashboard.js` - Wire up floating chat popup functionality

## Feature 3: Active Real-Time Notifications
- [x] 3a. Edit `js/community.js` - Call createNotification on post likes
- [x] 3b. Edit `js/community.js` - Call createNotification on post comments
- [x] 3c. Edit `js/community.js` - Call createNotification on comment replies
- [x] 3d. Edit `js/notifications.js` - Add DM notification support for new chat messages
- [x] 3e. Edit `js/notifications.js` - Add "message" type to icon mapping

