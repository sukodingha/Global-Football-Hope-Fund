/**
 * GFHF Real-Time In-App Notifications Module
 * - Adds a notification bell icon to the navigation header
 * - Firestore real-time listener (onSnapshot) on notifications/{uid}
 * - Red unread badge counter and drop-down list for recent alerts
 * - Alerts for likes, comments, and @mentions (#GFHF-XXXX tags)
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, collection, query, where, orderBy, onSnapshot,
  serverTimestamp, updateDoc, getDocs, addDoc, setDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== STATE =====
let currentUser = null;
let unsubscribeNotifications = null;
let notificationCount = 0;

// ===== DOM REFS (injected dynamically) =====
const notificationContainerId = "gfhfNotificationContainer";

/**
 * Create and inject the notification bell HTML into the header
 */
function injectNotificationBell() {
  // Remove existing if any
  const existing = document.getElementById(notificationContainerId);
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.id = notificationContainerId;
  container.className = "notification-bell-container";
  container.innerHTML = `
    <button id="notificationBellBtn" class="notification-bell-btn" type="button" aria-label="Notifications">
      <span class="notification-bell-icon">🔔</span>
      <span id="notificationBadge" class="notification-badge" hidden>0</span>
    </button>
    <div id="notificationDropdown" class="notification-dropdown" hidden>
      <div class="notification-dropdown-header">
        <strong>Notifications</strong>
        <button id="markAllReadBtn" class="notification-mark-read" type="button">Mark all read</button>
      </div>
      <div id="notificationList" class="notification-list">
        <div class="notification-empty">No notifications yet.</div>
      </div>
    </div>
  `;

  // Insert after userStatus in the header brand
  const headerBrand = document.querySelector(".header-brand");
  if (headerBrand) {
    headerBrand.appendChild(container);
  }

  // Attach event listeners
  const bellBtn = document.getElementById("notificationBellBtn");
  const dropdown = document.getElementById("notificationDropdown");
  const markAllBtn = document.getElementById("markAllReadBtn");

  if (bellBtn && dropdown) {
    bellBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
      if (!container.contains(e.target)) {
        dropdown.hidden = true;
      }
    });
  }

  if (markAllBtn) {
    markAllBtn.addEventListener("click", () => {
      markAllNotificationsRead();
      dropdown.hidden = true;
    });
  }
}

/**
 * Listen to notifications for the current user
 */
function listenToNotifications(uid) {
  // Unsubscribe previous listener
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
    unsubscribeNotifications = null;
  }

  if (!uid) {
    updateBadge(0);
    renderNotifications([]);
    return;
  }

  if (!db) { console.warn("Firestore db not available"); return; }

  try {
    const notificationsRef = collection(db, "notifications", uid, "items");
    const q = query(notificationsRef, orderBy("createdAt", "desc"), limit(50));

    unsubscribeNotifications = onSnapshot(q, (snapshot) => {
      const notifications = [];
      let unreadCount = 0;

      snapshot.docs.forEach((docSnap) => {
        const data = { id: docSnap.id, ...docSnap.data() };
        notifications.push(data);
        if (!data.read) unreadCount++;
      });

      notificationCount = unreadCount;
      updateBadge(unreadCount);
      renderNotifications(notifications);
    }, (error) => {
      console.warn("Notification listener error:", error);
      // If the collection doesn't exist yet, just show empty state
      if (error.code === "not-found") {
        updateBadge(0);
        renderNotifications([]);
      }
    });
  } catch (err) {
    console.warn("Could not set up notification listener:", err);
  }
}

/**
 * Mark all notifications as read in Firestore
 */
async function markAllNotificationsRead() {
  if (!currentUser) return;

  try {
    const notificationsRef = collection(db, "notifications", currentUser.uid, "items");
    const q = query(notificationsRef, where("read", "==", false));
    const snapshot = await getDocs(q);

    const updates = [];
    snapshot.docs.forEach((docSnap) => {
      updates.push(updateDoc(doc(db, "notifications", currentUser.uid, "items", docSnap.id), {
        read: true
      }));
    });

    await Promise.all(updates);
    updateBadge(0);
  } catch (err) {
    console.warn("Could not mark notifications as read:", err);
  }
}

/**
 * Update the badge counter
 */
function updateBadge(count) {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  if (count > 0) {
    badge.hidden = false;
    badge.textContent = count > 99 ? "99+" : count.toString();
  } else {
    badge.hidden = true;
  }
}

/**
 * Handle accepting a teammate request
 */
async function handleAcceptTeammate(notifId, senderId, senderName) {
  if (!currentUser || !senderId) return;
  try {
    // 1. Create mutual teammate links
    const myTeammateRef = doc(db, "users", currentUser.uid, "teammates", senderId);
    await setDoc(myTeammateRef, {
      teammateId: senderId,
      addedAt: serverTimestamp()
    });

    const theirTeammateRef = doc(db, "users", senderId, "teammates", currentUser.uid);
    await setDoc(theirTeammateRef, {
      teammateId: currentUser.uid,
      addedAt: serverTimestamp()
    });

    // 2. Create/ensure chat thread
    const chatKey = [currentUser.uid, senderId].sort().join("_");
    const chatRef = doc(db, "chats", chatKey);
    await setDoc(chatRef, {
      participants: [currentUser.uid, senderId],
      createdAt: serverTimestamp(),
      lastActivity: serverTimestamp()
    }, { merge: true });

    // 3. Update request notification status to 'accepted'
    await updateDoc(doc(db, "notifications", currentUser.uid, "items", notifId), {
      status: "accepted",
      read: true
    });

    // 4. Send acceptance notification to the requester
    const senderNotifRef = collection(db, "notifications", senderId, "items");
    await addDoc(senderNotifRef, {
      type: "teammate_accepted",
      senderId: currentUser.uid,
      message: `${currentUser.displayName || "Your teammate"} accepted your teammate request!`,
      read: false,
      createdAt: serverTimestamp()
    });

    alert("✅ Teammate added! You can now chat with each other.");
  } catch (err) {
    console.error("Error accepting teammate request:", err);
    alert("Failed to accept teammate request.");
  }
}

/**
 * Handle rejecting a teammate request
 */
async function handleRejectTeammate(notifId, senderId, senderName) {
  if (!currentUser || !senderId) return;
  try {
    // 1. Update request notification status to 'rejected'
    await updateDoc(doc(db, "notifications", currentUser.uid, "items", notifId), {
      status: "rejected",
      read: true
    });

    // 2. Send rejection notification to the requester
    const senderNotifRef = collection(db, "notifications", senderId, "items");
    await addDoc(senderNotifRef, {
      type: "teammate_declined",
      senderId: currentUser.uid,
      message: `${currentUser.displayName || "A user"} declined your teammate request.`,
      read: false,
      createdAt: serverTimestamp()
    });

    alert("Teammate request declined.");
  } catch (err) {
    console.error("Error rejecting teammate request:", err);
  }
}

/**
 * Render the notification list in the dropdown
 */
function renderNotifications(notifications) {
  const list = document.getElementById("notificationList");
  if (!list) return;

  if (!notifications || notifications.length === 0) {
    list.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
    return;
  }

  list.innerHTML = notifications.map((notif) => {
    const timeAgo = getTimeAgo(notif.createdAt);
    const icon = notif.type === "like" ? "❤️"
      : notif.type === "comment" ? "💬"
      : notif.type === "mention" ? "@"
      : notif.type === "tag" ? "🏷️"
      : notif.type === "teammate_request" ? "👥"
      : notif.type === "teammate_accepted" ? "✅"
      : notif.type === "teammate_declined" ? "❌"
      : notif.type === "message" ? "💬"
      : "🔔";

    // For teammate_request with pending status, show Accept/Reject buttons
    let actionButtons = "";
    if (notif.type === "teammate_request" && notif.status === "pending") {
      actionButtons = `
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="mini-btn teammate-accept-btn" data-notifid="${notif.id}" data-senderid="${notif.senderId}" data-sendername="${notif.senderName || ''}" style="flex:1;padding:6px 12px;background:#00c853;color:white;border:none;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;">✅ Accept</button>
          <button class="mini-btn teammate-reject-btn" data-notifid="${notif.id}" data-senderid="${notif.senderId}" data-sendername="${notif.senderName || ''}" style="flex:1;padding:6px 12px;background:#ef4444;color:white;border:none;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;">❌ Reject</button>
        </div>
      `;
    } else if (notif.type === "teammate_request" && notif.status === "accepted") {
      actionButtons = `<div style="margin-top:6px;font-size:11px;color:#00c853;font-weight:700;">✅ Accepted</div>`;
    } else if (notif.type === "teammate_request" && notif.status === "rejected") {
      actionButtons = `<div style="margin-top:6px;font-size:11px;color:#ef4444;font-weight:700;">❌ Declined</div>`;
    }

    return `
      <div class="notification-item ${notif.read ? "read" : "unread"}" data-id="${notif.id}">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
          <div class="notification-text">${notif.message || "New notification"}</div>
          <div class="notification-time">${timeAgo}</div>
          ${actionButtons}
        </div>
        ${!notif.read && notif.type !== "teammate_request" ? '<div class="notification-unread-dot"></div>' : ''}
      </div>
    `;
  }).join("");

  // Attach teammate Accept button handlers
  list.querySelectorAll(".teammate-accept-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const notifId = btn.dataset.notifid;
      const senderId = btn.dataset.senderid;
      const senderName = btn.dataset.sendername;
      await handleAcceptTeammate(notifId, senderId, senderName);
    });
  });

  // Attach teammate Reject button handlers
  list.querySelectorAll(".teammate-reject-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const notifId = btn.dataset.notifid;
      const senderId = btn.dataset.senderid;
      const senderName = btn.dataset.sendername;
      await handleRejectTeammate(notifId, senderId, senderName);
    });
  });

  // Add click handler to mark individual as read and close dropdown
  const dropdown = document.getElementById("notificationDropdown");
  list.querySelectorAll(".notification-item.unread").forEach((item) => {
    item.addEventListener("click", async (e) => {
      // Don't mark as read if clicking on action buttons
      if (e.target.closest(".teammate-accept-btn") || e.target.closest(".teammate-reject-btn")) return;
      e.stopPropagation();
      const notifId = item.dataset.id;
      if (currentUser && notifId) {
        try {
          await updateDoc(doc(db, "notifications", currentUser.uid, "items", notifId), {
            read: true
          });
        } catch (err) {
          console.warn("Could not mark notification as read:", err);
        }
      }
      // Close dropdown after clicking a notification
      if (dropdown) dropdown.hidden = true;
    });
  });

  // Also close dropdown on already-read notification click
  list.querySelectorAll(".notification-item.read").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dropdown) dropdown.hidden = true;
    });
  });
}

/**
 * Format timestamp to relative time string
 */
function getTimeAgo(timestamp) {
  if (!timestamp) return "Just now";

  const now = Date.now();
  const t = timestamp?.toMillis ? timestamp.toMillis() : (typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp || now);
  const diff = Math.floor((now - t) / 1000);

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * Create a notification for a user (to be called from other modules)
 * @param {string} targetUid - The user to notify
 * @param {string} type - 'like' | 'comment' | 'mention' | 'tag'
 * @param {string} message - The notification message
 */
export async function createNotification(targetUid, type, message) {
  if (!targetUid || !type || !message) return;

  try {
    const notificationsRef = collection(db, "notifications", targetUid, "items");
    await addDoc(notificationsRef, {
      type,
      message,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not create notification:", err);
  }
}

// ===== INIT =====
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    listenToNotifications(user.uid);
  } else {
    listenToNotifications(null);
  }
});

// Inject notification bell when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectNotificationBell);
} else {
  injectNotificationBell();
}

