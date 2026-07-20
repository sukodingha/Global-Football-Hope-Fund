/**
 * GFHF Real-Time Chat Module
 * Firestore-backed direct messaging with friend-request integration
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== DOM refs (injected by community.js or dashboard.js) =====
let currentUser = null;
let activeChatPartnerId = null;
let activeChatPartnerName = "";
let unsubscribeChat = null;

// ===== Chat bubble rendering =====
function formatTimestamp(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function createMessageBubble(message, isOwn) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-bubble-wrapper ${isOwn ? "sent" : "received"}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";

  const nameEl = document.createElement("div");
  nameEl.className = "chat-bubble-author";
  nameEl.textContent = isOwn ? "You" : (message.authorName || "Anonymous");

  const textEl = document.createElement("div");
  textEl.className = "chat-bubble-text";
  textEl.textContent = message.text || "";

  const timeEl = document.createElement("div");
  timeEl.className = "chat-bubble-time";
  timeEl.textContent = formatTimestamp(message.createdAt);

  bubble.appendChild(nameEl);
  bubble.appendChild(textEl);
  bubble.appendChild(timeEl);
  wrapper.appendChild(bubble);

  return wrapper;
}

// ===== Open a real-time chat with a friend =====
export function openRealTimeChat(partnerId, partnerName, containerEl, formEl, inputEl) {
  if (!partnerId || !containerEl) return;

  // Clean up previous listener
  if (unsubscribeChat) {
    unsubscribeChat();
    unsubscribeChat = null;
  }

  activeChatPartnerId = partnerId;
  activeChatPartnerName = partnerName;

  // Build composite chat ID (sorted for consistency)
  const uid1 = currentUser?.uid || "anon";
  const chatKey = [uid1, partnerId].sort().join("_");

  // Listen to messages in this chat
  const messagesRef = collection(db, "liveChats", chatKey, "messages");
  const q = query(messagesRef, orderBy("createdAt", "asc"), limit(100));

  containerEl.innerHTML = '<div class="chat-loading">Loading messages...</div>';

  unsubscribeChat = onSnapshot(q, (snapshot) => {
    containerEl.innerHTML = "";

    if (snapshot.empty) {
      containerEl.innerHTML = '<div class="chat-empty">No messages yet. Say hello! 👋</div>';
      return;
    }

    snapshot.docs.forEach((docSnap) => {
      const msg = docSnap.data();
      const isOwn = msg.authorId === currentUser?.uid;
      const bubble = createMessageBubble(msg, isOwn);
      containerEl.appendChild(bubble);
    });

    // Auto-scroll to bottom
    containerEl.scrollTop = containerEl.scrollHeight;
  }, (error) => {
    console.error("Chat listen error:", error);
    containerEl.innerHTML = '<div class="chat-error">Could not load messages.</div>';
  });

  // Wire up form submission
  if (formEl && inputEl) {
    const newForm = formEl.cloneNode(true);
    formEl.parentNode.replaceChild(newForm, formEl);
    formEl = newForm;
    inputEl = newForm.querySelector("input, textarea");

    newForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = inputEl?.value?.trim();
      if (!text || !currentUser) return;

      try {
        await addDoc(collection(db, "liveChats", chatKey, "messages"), {
          authorId: currentUser.uid,
          authorName: currentUser.displayName || currentUser.email?.split("@")[0] || "Member",
          text,
          createdAt: serverTimestamp()
        });
        inputEl.value = "";
      } catch (error) {
        console.error("Send message error:", error);
      }
    });
  }
}

// ===== Close active chat =====
export function closeRealTimeChat() {
  if (unsubscribeChat) {
    unsubscribeChat();
    unsubscribeChat = null;
  }
  activeChatPartnerId = null;
  activeChatPartnerName = "";
}

// ===== Listen to auth state =====
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  // If user logs out, clean up any active chat
  if (!user && unsubscribeChat) {
    unsubscribeChat();
    unsubscribeChat = null;
  }
});
