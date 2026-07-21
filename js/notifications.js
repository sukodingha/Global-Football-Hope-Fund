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
  serverTimestamp, updateDoc, getDocs, limit
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
      const isHidden = dropdown.hidden;
      dropdown.hidden = !isHidden;
      if (!isHidden) {
        // Open: mark all as read via Firestore
        markAllNotificationsRead();
      }
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
      : "🔔";

    return `
      <div class="notification-item ${notif.read ? "read" : "unread"}" data-id="${notif.id}">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
          <div class="notification-text">${notif.message || "New notification"}</div>
          <div class="notification-time">${timeAgo}</div>
        </div>
        ${!notif.read ? '<div class="notification-unread-dot"></div>' : ''}
      </div>
    `;
  }).join("");

  // Add click handler to mark individual as read
  list.querySelectorAll(".notification-item.unread").forEach((item) => {
    item.addEventListener("click", async () => {
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
    const { addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
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

