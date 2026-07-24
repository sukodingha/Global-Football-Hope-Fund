/**
 * GFHF Facebook-Style Community Module
 * Stories bar, Create Post modal, Post cards with photo grids,
 * Like/Reaction system, Expandable comments, User profile modals
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot, limit,
  serverTimestamp, doc, updateDoc, arrayUnion, getDoc, getDocs, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createNotification } from "./notifications.js";

// ===== CONFIG =====
const CLOUDINARY_CLOUD_NAME = "d8obkydb";
const CLOUDINARY_UPLOAD_PRESET = "football_preset";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserAvatar = "👤";
let unsubscribeFeed = null;
let activeInterest = "All";
let activeDMUserId = null;
let pendingFiles = [];
let userDirectory = {}; // uniqueId -> { displayName, uid }
let userPhotoCache = {}; // uid -> photoURL (cached to avoid repeated Firestore reads)

// ===== DOM REFS =====
const feed = document.getElementById("communityFeed");
const storiesTrack = document.getElementById("storiesTrack");

// Create Post Modal
const postModal = document.getElementById("postModal");
const postModalOverlay = document.getElementById("postModalOverlay");
const postModalClose = document.getElementById("postModalClose");
const postModalText = document.getElementById("postModalText");
const postModalFile = document.getElementById("postModalFile");
const postModalSubmit = document.getElementById("postModalSubmit");
const postModalStatus = document.getElementById("postModalStatus");
const postModalInterest = document.getElementById("postModalInterest");
const postImagePreview = document.getElementById("postImagePreview");
const postPreviewImg = document.getElementById("postPreviewImg");
const removeImageBtn = document.getElementById("removeImageBtn");
const createPostInput = document.getElementById("createPostInput");
const createPostAvatar = document.getElementById("createPostAvatar");
const openPhotoBtn = document.getElementById("openPhotoBtn");

// Profile Modal
const profileModal = document.getElementById("profileModal");
const profileModalOverlay = document.getElementById("profileModalOverlay");
const profileModalClose = document.getElementById("profileModalClose");
const profileModalBody = document.getElementById("profileModalBody");

// Sidebar
const membersList = document.getElementById("membersList");
const friendRequestsList = document.getElementById("friendRequestsList");
const friendRequestCount = document.getElementById("friendRequestCount");
const dmChatPanel = document.getElementById("dmChatPanel");
const dmChatWith = document.getElementById("dmChatWith");
const dmChatMessages = document.getElementById("dmChatMessages");
const dmChatForm = document.getElementById("dmChatForm");
const dmMessageInput = document.getElementById("dmMessageInput");
const communityChatList = document.getElementById("communityChatList");
const communityChatForm = document.getElementById("communityChatForm");

// Teammates
const teammatesList = document.getElementById("teammatesList");

// Floating Chat Popup
const floatingChatPopup = document.getElementById("floatingChatPopup");
const floatingChatTitle = document.getElementById("floatingChatTitle");
const floatingChatMessages = document.getElementById("floatingChatMessages");
const floatingChatForm = document.getElementById("floatingChatForm");
const floatingChatInput = document.getElementById("floatingChatInput");
const floatingChatClose = document.getElementById("floatingChatClose");

// Filter buttons
const filterBtns = document.querySelectorAll(".feed-filter-btn");

// ===== STORIES DATA =====
const STORIES = [
  { emoji: "⚽", label: "Match Day!", color: "#e74c3c" },
  { emoji: "🏆", label: "Champions", color: "#f39c12" },
  { emoji: "🔥", label: "Highlights", color: "#e67e22" },
  { emoji: "💪", label: "Training", color: "#2ecc71" },
  { emoji: "🌟", label: "Top Player", color: "#3498db" },
  { emoji: "🎯", label: "Predictions", color: "#9b59b6" },
  { emoji: "📢", label: "Transfer News", color: "#1abc9c" },
  { emoji: "⚡", label: "Live Scores", color: "#e74c3c" },
];

// ===== MEMBER PROFILES (simulated) =====
const MEMBER_PROFILES = [
  { id: "member_1", name: "Alex M.", emoji: "🙋", country: "Brazil", favTeam: "Brazil", bio: "Samba football fan" },
  { id: "member_2", name: "Sarah K.", emoji: "🙋‍♀️", country: "England", favTeam: "Arsenal", bio: "Arsenal till I die" },
  { id: "member_3", name: "Marco R.", emoji: "🤙", country: "Italy", favTeam: "Inter", bio: "Forza Inter!" },
  { id: "member_4", name: "Yuki T.", emoji: "🙆", country: "Japan", favTeam: "Barcelona", bio: "Visca Barca" },
  { id: "member_5", name: "Emma W.", emoji: "🙌", country: "Germany", favTeam: "Bayern", bio: "Mia san mia" },
  { id: "member_6", name: "Carlos D.", emoji: "⚡", country: "Argentina", favTeam: "Argentina", bio: "Vamos Argentina" },
  { id: "member_7", name: "Aisha N.", emoji: "🌟", country: "Nigeria", favTeam: "Liverpool", bio: "YNWA" },
  { id: "member_8", name: "David L.", emoji: "🔥", country: "France", favTeam: "PSG", bio: "Ici c'est Paris" },
];

// ===== FRIEND SYSTEM (localStorage) =====
const LS_FRIENDS_KEY = "gfhf_friends";
const LS_REQUESTS_KEY = "gfhf_friend_requests";
const LS_DM_KEY = "gfhf_dm_messages";

function getFriends() { try { return JSON.parse(localStorage.getItem(LS_FRIENDS_KEY) || "{}"); } catch { return {}; } }
function saveFriends(f) { localStorage.setItem(LS_FRIENDS_KEY, JSON.stringify(f)); }
function getFriendRequests() { try { return JSON.parse(localStorage.getItem(LS_REQUESTS_KEY) || "[]"); } catch { return []; } }
function saveFriendRequests(r) { localStorage.setItem(LS_REQUESTS_KEY, JSON.stringify(r)); }
function getDMMessages(uid) { try { const a = JSON.parse(localStorage.getItem(LS_DM_KEY) || "{}"); return a[uid] || []; } catch { return []; } }
function saveDMMessage(uid, msg) { try { const a = JSON.parse(localStorage.getItem(LS_DM_KEY) || "{}"); if (!a[uid]) a[uid] = []; a[uid].push(msg); localStorage.setItem(LS_DM_KEY, JSON.stringify(a)); } catch {} }

// ===== STORIES BAR =====
function renderStories() {
  if (!storiesTrack) return;
  storiesTrack.innerHTML = "";
  STORIES.forEach((story) => {
    const div = document.createElement("div");
    div.className = "story-item";
    div.innerHTML = `<div class="story-circle" style="background:${story.color}">${story.emoji}</div><span class="story-label">${story.label}</span>`;
    storiesTrack.appendChild(div);
  });
}

// ===== @MENTION TAG SYSTEM =====

/**
 * Load all Firestore users that have a uniqueId into the userDirectory
 */
async function loadUserDirectory() {
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    usersSnap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.uniqueId) {
        userDirectory[data.uniqueId] = {
          uid: docSnap.id,
          displayName: data.displayName || data.firstName || "Unknown"
        };
      }
    });
  } catch (err) {
    console.warn("Could not load user directory for @mentions:", err);
  }
}

/**
 * Parse @mentions in text and return { cleanText, taggedIds[] }
 */
function parseMentions(text) {
  const taggedIds = [];
  const cleanText = text.replace(/@(#GFHF-[A-Z0-9]+)/g, (match, uniqueId) => {
    const user = userDirectory[uniqueId];
    if (user) {
      taggedIds.push(user.uid);
      return `<span class="mention-tag" style="color:#00c853;font-weight:700;background:rgba(0,200,83,0.1);padding:1px 6px;border-radius:6px;">@${user.displayName}</span>`;
    }
    // Keep as plain text if user not found
    return match;
  });
  return { cleanText, taggedIds };
}

/**
 * Highlight @mentions in post text for display
 */
function highlightMentions(text) {
  return text.replace(/@(#GFHF-[A-Z0-9]+)/g, (match, uniqueId) => {
    const user = userDirectory[uniqueId];
    if (user) {
      return `<span class="mention-tag" style="color:#00c853;font-weight:700;background:rgba(0,200,83,0.1);padding:1px 6px;border-radius:6px;">@${user.displayName}</span>`;
    }
    return `<span style="color:#f59e0b;font-weight:600;">${match}</span>`;
  });
}

// ===== CREATE POST MODAL =====
function openPostModal() {
  if (!currentUser) {
    document.getElementById("authModal")?.classList.add("auth-modal--open");
    return;
  }
  postModalText.value = "";
  postModalInterest.value = "Football";
  pendingFiles = [];
  postImagePreview.hidden = true;
  postModalStatus.className = "message";
  postModalStatus.textContent = "";
  postModal.hidden = false;

  const avatar = document.getElementById("postModalAvatar");
  const name = document.getElementById("postModalName");
  avatar.textContent = currentUserAvatar;
  name.textContent = currentUserName;

  // Show @mention hint
  postModalStatus.className = "message";
  postModalStatus.textContent = '💡 Tip: Type @#GFHF-XXXX to tag another user in your post!';
  postModalStatus.style.display = "block";
  postModalStatus.style.background = "#f0f9ff";
  postModalStatus.style.color = "#0369a1";
}

function closePostModal() {
  postModal.hidden = true;
}

if (createPostInput) createPostInput.addEventListener("click", openPostModal);
if (openPhotoBtn) openPhotoBtn.addEventListener("click", (e) => { e.preventDefault(); openPostModal(); postModalFile?.click(); });
if (postModalOverlay) postModalOverlay.addEventListener("click", closePostModal);
if (postModalClose) postModalClose.addEventListener("click", closePostModal);

if (postModalFile) {
  postModalFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingFiles = [file];
    const reader = new FileReader();
    reader.onload = (ev) => {
      postPreviewImg.src = ev.target.result;
      postImagePreview.hidden = false;
    };
    reader.readAsDataURL(file);
  });
}

if (removeImageBtn) {
  removeImageBtn.addEventListener("click", () => {
    pendingFiles = [];
    postImagePreview.hidden = true;
    postModalFile.value = "";
  });
}

async function uploadImage(file) {
  if (!file) return null;
  // Try Cloudinary first
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      return data.secure_url;
    }
  } catch {}
  // Fallback: return base64 data URL
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

if (postModalSubmit) {
  postModalSubmit.addEventListener("click", async () => {
    if (!currentUser) {
      postModalStatus.className = "message error";
      postModalStatus.textContent = "Please sign in first.";
      return;
    }
    const text = postModalText.value.trim();
    if (!text) {
      postModalStatus.className = "message error";
      postModalStatus.textContent = "Please write something.";
      return;
    }

    postModalSubmit.disabled = true;
    postModalSubmit.textContent = "Posting...";

    try {
      let imageUrl = null;
      if (pendingFiles.length > 0) {
        imageUrl = await uploadImage(pendingFiles[0]);
      }

      // Parse @mentions in the post text
      const { cleanText: parsedText, taggedIds } = parseMentions(text);

      await addDoc(collection(db, "posts"), {
        authorId: currentUser.uid,
        authorName: currentUserName,
        authorAvatar: currentUserAvatar,
        text: parsedText, // Store with HTML mentions
        rawText: text,    // Keep original for editing
        taggedUserIds: taggedIds,
        interest: postModalInterest.value,
        imageUrl: imageUrl || null,
        likes: [],
        comments: [],
        createdAt: serverTimestamp()
      });

      closePostModal();
    } catch (err) {
      postModalStatus.className = "message error";
      postModalStatus.textContent = "Failed to post. Try again.";
      console.error(err);
    } finally {
      postModalSubmit.disabled = false;
      postModalSubmit.textContent = "Post";
    }
  });
}

// ===== FEED FILTER =====
filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeInterest = btn.dataset.filter;
    loadFeed();
  });
});

// ===== DYNAMIC AVATAR RESOLVER =====
/**
 * Fetch a user's photoURL from Firestore (cached after first fetch)
 * @param {string} uid - The user ID to look up
 * @returns {Promise<string>} The photoURL or empty string
 */
async function getUserPhotoURL(uid) {
  if (!uid) return "";
  if (userPhotoCache[uid] !== undefined) return userPhotoCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : {};
    const url = data.photoURL || data.profilePic || "";
    userPhotoCache[uid] = url;
    return url;
  } catch {
    userPhotoCache[uid] = "";
    return "";
  }
}

/**
 * Generate initials avatar HTML for a user
 */
function getInitialsAvatar(name) {
  const initials = (name || "?")
    .split(" ")
    .map(s => s[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "?";
  return `<div style="width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,#0b2d4d,#123f63);color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;">${initials}</div>`;
}

/**
 * Render an avatar image element (either <img> with photoURL or initials fallback)
 * @param {string} uid - User ID
 * @param {string} photoURL - Direct photoURL if known, or empty to fetch
 * @param {string} displayName - Display name for initials fallback
 * @param {number} size - Size in pixels
 * @returns {Promise<string>} HTML string for the avatar
 */
async function resolveAvatarHTML(uid, photoURL, displayName, size = 40) {
  const url = photoURL || (uid ? await getUserPhotoURL(uid) : "");
  if (url) {
    return `<img src="${url}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">`;
  }
  const initials = (displayName || "?")
    .split(" ")
    .map(s => s[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "?";
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,#0b2d4d,#123f63);color:white;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.35)}px;font-weight:700;flex-shrink:0;">${initials}</div>`;
}

// ===== UUID / SHORT ID GENERATOR =====
function generateCommentId() {
  return 'cmt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

// ===== EMOJI REACTION OPTIONS =====
const COMMENT_EMOJIS = ['❤️', '👍', '😂', '😮', '🔥'];

// ===== POST CARD RENDERER =====
function timeAgo(timestamp) {
  const now = Date.now();
  const t = timestamp?.toMillis ? timestamp.toMillis() : (typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp || now);
  const diff = Math.floor((now - t) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(t).toLocaleDateString();
}

function renderPostCard(post) {
  const card = document.createElement("div");
  card.className = "fb-post-card";
  const isLiked = currentUser && post.likes?.includes(currentUser.uid);
  const likeCount = post.likes?.length || 0;
  const commentCount = post.comments?.length || 0;

  // Determine post text to display - support both old plain text and new HTML mentions
  let displayText;
  if (post.text && (post.text.includes('<span class="mention-tag') || post.text.includes('<span style='))) {
    // Already contains HTML mentions from parseMentions
    displayText = post.text;
  } else if (post.rawText) {
    // Has rawText - highlight mentions client-side
    displayText = highlightMentions(escapeHtml(post.rawText));
  } else {
    // Old style plain text - escape and highlight
    displayText = highlightMentions(escapeHtml(post.text || ""));
  }

  // Tagged users badge
  const taggedBadge = (post.taggedUserIds && post.taggedUserIds.length > 0)
    ? `<div style="font-size:12px;color:#00c853;padding:0 18px 6px;">👥 Tagged ${post.taggedUserIds.length} user(s)</div>`
    : '';

  // Build profile link
  const profileLink = `profile.html?uid=${encodeURIComponent(post.authorId || "")}`;

  // Resolve author avatar (photoURL or initials)
  const authorPhotoURL = userPhotoCache[post.authorId] || post.authorPhotoURL || "";
  const authorInitials = (post.authorName || "?")
    .split(" ")
    .map(s => s[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "?";
  let authorAvatarHtml = `<div class="fb-post-avatar" style="overflow:hidden;">${authorInitials.substring(0, 1)}</div>`;
  if (authorPhotoURL) {
    authorAvatarHtml = `<div class="fb-post-avatar" style="overflow:hidden;"><img src="${authorPhotoURL}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"></div>`;
  }

  // Header
  card.innerHTML = `
    <div class="fb-post-header">
      <a href="${profileLink}" class="fb-post-avatar-link" style="text-decoration:none;color:inherit;">
        ${authorAvatarHtml}
      </a>
      <div class="fb-post-meta">
        <a href="${profileLink}" style="text-decoration:none;color:inherit;">
          <strong>${post.authorName || "Anonymous"}</strong>
        </a>
        <div class="fb-post-time">${timeAgo(post.createdAt)} · ${post.interest || "General"}</div>
      </div>
      <div class="fb-post-options">•••</div>
    </div>
    <div class="fb-post-text">${displayText}</div>
    ${taggedBadge}
  `;

  // Image Grid
  if (post.imageUrl) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "fb-post-image-grid fb-post-image-single";
    const img = document.createElement("img");
    img.src = post.imageUrl;
    img.alt = "Post image";
    img.loading = "lazy";
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);
  }

  // Stats bar
  const statsBar = document.createElement("div");
  statsBar.className = "fb-post-stats";
  statsBar.innerHTML = `
    <span>👍 ${likeCount}</span>
    <span>💬 ${commentCount} comments</span>
  `;
  card.appendChild(statsBar);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "fb-post-actions";
  actions.innerHTML = `
    <button class="fb-action-btn ${isLiked ? 'liked' : ''}" data-action="like">
      ${isLiked ? '❤️' : '👍'} <span>${isLiked ? 'Liked' : 'Like'}</span>
    </button>
    <button class="fb-action-btn" data-action="comment">
      💬 <span>Comment</span>
    </button>
    <button class="fb-action-btn" data-action="share">
      📤 <span>Share</span>
    </button>
  `;
  card.appendChild(actions);

  // Comments section (hidden initially)
  const commentSection = document.createElement("div");
  commentSection.className = "fb-comment-section";
  commentSection.hidden = true;

  const commentList = document.createElement("div");
  commentList.className = "fb-comment-list";
  (post.comments || []).forEach((c) => {
    const ci = document.createElement("div");
    ci.className = "fb-comment-item";
    ci.dataset.commentId = c.commentId || "";
    const commentProfileLink = `profile.html?uid=${encodeURIComponent(c.authorId || "")}`;

    // Compute emoji reactions counts
    const reactions = c.reactions || {};
    let reactionsHtml = COMMENT_EMOJIS.map(emoji => {
      const count = (reactions[emoji] || []).length;
      const hasReacted = currentUser && (reactions[emoji] || []).includes(currentUser.uid);
      return count > 0
        ? `<button class="cmt-reaction-btn ${hasReacted ? 'reacted' : ''}" data-emoji="${emoji}">${emoji} ${count}</button>`
        : '';
    }).filter(Boolean).join(' ');

    // Build replies HTML
    let repliesHtml = '';
    if (c.replies && c.replies.length > 0) {
      repliesHtml = `<div class="cmt-replies">${c.replies.map(r => {
        const rLink = `profile.html?uid=${encodeURIComponent(r.authorId || "")}`;
        return `<div class="cmt-reply-item"><span class="fb-comment-avatar" style="width:24px;height:24px;font-size:11px;"><a href="${rLink}" style="text-decoration:none;color:inherit;">${r.authorAvatar || "👤"}</a></span><div class="fb-comment-body" style="font-size:13px;"><strong><a href="${rLink}" style="text-decoration:none;color:inherit;">${r.authorName || "Guest"}</a></strong><p>${escapeHtml(r.text || "")}</p><span class="fb-comment-time">${timeAgo(r.createdAt)}</span></div></div>`;
      }).join('')}</div>`;
    }

    ci.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-start;width:100%;">
        <span class="fb-comment-avatar"><a href="${commentProfileLink}" style="text-decoration:none;color:inherit;">${c.authorAvatar || "👤"}</a></span>
        <div class="fb-comment-body" style="flex:1;">
          <strong><a href="${commentProfileLink}" style="text-decoration:none;color:inherit;">${c.authorName || "Guest"}</a></strong>
          <p>${escapeHtml(c.text || "")}</p>
          <span class="fb-comment-time">${timeAgo(c.createdAt)}</span>
          <div class="cmt-actions-bar">
            <button class="cmt-action-btn cmt-reply-toggle-btn" type="button">💬 Reply</button>
            <button class="cmt-action-btn cmt-emoji-toggle-btn" type="button">😊 React</button>
          </div>
          ${reactionsHtml ? `<div class="cmt-reactions-bar">${reactionsHtml}</div>` : ''}
          <div class="cmt-emoji-picker" hidden>
            ${COMMENT_EMOJIS.map(e => `<button class="cmt-emoji-btn" data-emoji="${e}" type="button">${e}</button>`).join('')}
          </div>
          <form class="cmt-reply-form" hidden>
            <input type="text" placeholder="Write a reply..." required style="flex:1;padding:8px 12px;border:1px solid #e2e8f0;border-radius:999px;font-size:13px;background:#f8fafc;">
            <button type="submit" style="padding:6px 12px;background:#0b2d4d;color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Reply</button>
          </form>
          ${repliesHtml}
        </div>
      </div>`;
    commentList.appendChild(ci);
  });
  commentSection.appendChild(commentList);

  const commentForm = document.createElement("form");
  commentForm.className = "fb-comment-form";
  commentForm.innerHTML = `
    <span class="fb-comment-form-avatar">${currentUserAvatar}</span>
    <input type="text" class="comment-input" placeholder="Write a comment..." required>
    <button type="submit" class="comment-send-btn" style="padding:8px 16px;background:#0b2d4d;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;white-space:nowrap;">Send</button>
  `;
  commentSection.appendChild(commentForm);
  card.appendChild(commentSection);

  // Enter key support for comment input (Shift+Enter = newline, Enter = submit)
  const commentInput = commentForm.querySelector('.comment-input');
  if (commentInput) {
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commentForm.dispatchEvent(new Event('submit'));
      }
    });
  }

  // Attach clickable avatars
  card.querySelectorAll(".fb-avatar-clickable").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openProfileModal(el.dataset.userid, el.dataset.username, el.dataset.useremoji);
    });
  });

  // Like handler
  const likeBtn = actions.querySelector('[data-action="like"]');
  likeBtn.addEventListener("click", async () => {
    if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
    try {
      const ref = doc(db, "posts", post.id);
      const snap = await getDoc(ref);
      const likes = snap.data()?.likes || [];
      if (likes.includes(currentUser.uid)) {
        await updateDoc(ref, { likes: likes.filter((id) => id !== currentUser.uid) });
      } else {
        await updateDoc(ref, { likes: arrayUnion(currentUser.uid) });
        // Send notification to post author if the liker is not the author
        if (post.authorId && post.authorId !== currentUser.uid) {
          createNotification(post.authorId, 'like', `${currentUserName} liked your post`);
        }
      }
    } catch (err) { console.error(err); }
  });

  // Comment toggle
  const commentBtn = actions.querySelector('[data-action="comment"]');
  commentBtn.addEventListener("click", () => {
    commentSection.hidden = !commentSection.hidden;
    if (!commentSection.hidden) {
      commentForm.querySelector("input").focus();
    }
  });

  // Comment submit — store commentId so reply/emoji handlers can match it
  commentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
    const input = commentForm.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    try {
      const ref = doc(db, "posts", post.id);
      // Fetch current comments, append with generated ID, save back
      const snap = await getDoc(ref);
      const currentComments = snap.data()?.comments || [];
      const newComment = {
        commentId: generateCommentId(),
        authorId: currentUser.uid,
        authorName: currentUserName,
        authorAvatar: currentUserAvatar,
        text,
        reactions: {},
        replies: [],
        createdAt: new Date().toISOString()
      };
      currentComments.push(newComment);
      await updateDoc(ref, { comments: currentComments });
      input.value = "";
      // Send notification to post author if the commenter is not the author
      if (post.authorId && post.authorId !== currentUser.uid) {
        createNotification(post.authorId, 'comment', `${currentUserName} commented on your post: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      }
    } catch (err) { console.error(err); }
  });

  // ===== EVENT DELEGATION for reply toggle, emoji picker, reactions, and reply submit =====
  // These use data-post-id and data-comment-id attributes set on the elements

  // Helper: toggle emoji reaction on a comment (used by both emoji picker + reactions bar)
  async function toggleCommentReaction(commentId, emoji) {
    if (!currentUser || !post.id || !commentId) return;
    try {
      const ref = doc(db, "posts", post.id);
      const snap = await getDoc(ref);
      const comments = snap.data()?.comments || [];
      const idx = comments.findIndex(c => c.commentId === commentId);
      if (idx === -1) return;
      const comment = { ...comments[idx] };
      const reactions = comment.reactions || {};
      const reactedUsers = reactions[emoji] || [];
      if (reactedUsers.includes(currentUser.uid)) {
        reactions[emoji] = reactedUsers.filter(uid => uid !== currentUser.uid);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...reactedUsers, currentUser.uid];
      }
      comment.reactions = reactions;
      comments[idx] = comment;
      await updateDoc(ref, { comments });
    } catch (err) { console.error(err); }
  }

  // Reply toggle button (inline onclick via data attributes)
  card.querySelectorAll('.cmt-reply-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const replyForm = btn.closest('.fb-comment-body').querySelector('.cmt-reply-form');
      if (replyForm) {
        replyForm.hidden = !replyForm.hidden;
        if (!replyForm.hidden) replyForm.querySelector('input')?.focus();
      }
    });
  });

  // Emoji picker toggle
  card.querySelectorAll('.cmt-emoji-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const picker = btn.closest('.fb-comment-body').querySelector('.cmt-emoji-picker');
      if (picker) picker.hidden = !picker.hidden;
    });
  });

  // Emoji button click inside picker (❤️ 👍 😂 😮 🔥)
  card.querySelectorAll('.cmt-emoji-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
      const emoji = btn.dataset.emoji;
      const commentItem = btn.closest('.fb-comment-item');
      const commentId = commentItem?.dataset.commentId;
      if (!commentId || !post.id) return;
      await toggleCommentReaction(commentId, emoji);
    });
  });

  // Existing reaction button click in the reactions bar
  card.querySelectorAll('.cmt-reaction-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
      const emoji = btn.dataset.emoji;
      const commentItem = btn.closest('.fb-comment-item');
      const commentId = commentItem?.dataset.commentId;
      if (!commentId || !post.id) return;
      await toggleCommentReaction(commentId, emoji);
    });
  });

  // Reply form submit
  card.querySelectorAll('.cmt-reply-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      const commentItem = form.closest('.fb-comment-item');
      const commentId = commentItem?.dataset.commentId;
      if (!commentId || !post.id) return;

      try {
        const ref = doc(db, "posts", post.id);
        const snap = await getDoc(ref);
        const comments = snap.data()?.comments || [];
        const idx = comments.findIndex(c => c.commentId === commentId);
        if (idx === -1) return;

        const comment = { ...comments[idx] };
        const replies = comment.replies || [];
        replies.push({
          authorId: currentUser.uid,
          authorName: currentUserName,
          authorAvatar: currentUserAvatar,
          text,
          createdAt: new Date().toISOString()
        });
        comment.replies = replies;
        comments[idx] = comment;
        await updateDoc(ref, { comments });
        input.value = "";
        form.hidden = true;
      } catch (err) { console.error(err); }
    });

    // Enter key support for reply input
    const replyInput = form.querySelector('input');
    if (replyInput) {
      replyInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          form.dispatchEvent(new Event('submit'));
        }
      });
    }
  });

  return card;
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ===== LOAD FEED =====
async function loadFeed() {
  if (!feed) return;
  feed.innerHTML = '<div class="fb-loading">⏳ Loading posts...</div>';

  if (unsubscribeFeed) unsubscribeFeed();

  const postsQuery = activeInterest === "All"
    ? query(collection(db, "posts"), orderBy("createdAt", "desc"))
    : query(collection(db, "posts"), where("interest", "==", activeInterest), orderBy("createdAt", "desc"));

  unsubscribeFeed = onSnapshot(postsQuery, (snapshot) => {
    feed.innerHTML = "";
    if (snapshot.empty) {
      feed.innerHTML = '<div class="fb-empty-feed">No posts yet. Be the first to share! 🎉</div>';
      return;
    }
    snapshot.docs.forEach((docSnap) => {
      const post = { id: docSnap.id, ...docSnap.data() };
      feed.appendChild(renderPostCard(post));
    });
  }, (err) => {
    console.error(err);
    feed.innerHTML = '<div class="fb-empty-feed">Unable to load feed. Please refresh.</div>';
  });
}

// ===== PROFILE MODAL =====
function openProfileModal(userId, userName, userEmoji) {
  profileModalBody.innerHTML = `
    <div class="profile-card">
      <div class="profile-cover"></div>
      <div class="profile-avatar-large">${userEmoji || "👤"}</div>
      <h2>${userName || "Anonymous"}</h2>
      <p class="profile-bio">Football enthusiast & GFHF community member</p>
      <div class="profile-interests">
        <span class="profile-interest-tag">⚽ Football</span>
        <span class="profile-interest-tag">🏆 Competitions</span>
        <span class="profile-interest-tag">🤝 Community</span>
      </div>
      <div class="profile-stats">
        <div class="profile-stat"><strong>${MEMBER_PROFILES.find(m => m.id === userId)?.favTeam || "—"}</strong><span>Favorite Team</span></div>
        <div class="profile-stat"><strong>${MEMBER_PROFILES.find(m => m.id === userId)?.country || "—"}</strong><span>Country</span></div>
      </div>
    </div>
  `;
  profileModal.hidden = false;
}

if (profileModalOverlay) profileModalOverlay.addEventListener("click", () => { profileModal.hidden = true; });
if (profileModalClose) profileModalClose.addEventListener("click", () => { profileModal.hidden = true; });

// ===== MEMBERS / FRIEND SYSTEM =====
function getFriendStatus(targetId) {
  const reqs = getFriendRequests();
  const friends = getFriends();
  const cur = currentUser?.uid || "local_user";
  if (friends[cur]?.includes(targetId) || friends[targetId]?.includes(cur)) return "accepted";
  if (reqs.find(r => r.from === targetId && r.to === cur)) return "pending_received";
  if (reqs.find(r => r.from === cur && r.to === targetId)) return "pending_sent";
  return "none";
}

function renderMembers() {
  if (!membersList) return;
  membersList.innerHTML = "";
  const curId = currentUser?.uid || "local_user";

  MEMBER_PROFILES.forEach((m) => {
    const status = getFriendStatus(m.id);
    const card = document.createElement("div");
    card.className = "member-card";
    let actions = "";
    if (status === "accepted") {
      actions = `<button class="mini-btn dm-btn" data-id="${m.id}" data-name="${m.name}">💬</button>`;
    } else if (status === "pending_received") {
      actions = `<button class="mini-btn accept-btn" data-id="${m.id}">✅</button><button class="mini-btn secondary decline-btn" data-id="${m.id}">✕</button>`;
    } else if (status === "pending_sent") {
      actions = `<span class="pending-label">⏳</span>`;
    } else {
      actions = `<button class="mini-btn request-btn" data-id="${m.id}" data-name="${m.name}">➕</button>`;
    }
    card.innerHTML = `<div class="member-avatar fb-avatar-clickable" data-userid="${m.id}" data-username="${m.name}" data-useremoji="${m.emoji}">${m.emoji}</div><div class="member-info"><strong class="fb-avatar-clickable" data-userid="${m.id}" data-username="${m.name}" data-useremoji="${m.emoji}">${m.name}</strong><span class="member-meta">${m.country}</span></div><div class="member-actions">${actions}</div>`;
    membersList.appendChild(card);

    card.querySelectorAll(".fb-avatar-clickable").forEach(el => {
      el.addEventListener("click", () => openProfileModal(el.dataset.userid, el.dataset.username, el.dataset.useremoji));
    });
  });

  membersList.querySelectorAll(".request-btn").forEach(b => b.addEventListener("click", () => sendFriendRequest(b.dataset.id, b.dataset.name)));
  membersList.querySelectorAll(".accept-btn").forEach(b => b.addEventListener("click", () => acceptFriendRequest(b.dataset.id)));
  membersList.querySelectorAll(".decline-btn").forEach(b => b.addEventListener("click", () => declineFriendRequest(b.dataset.id)));
  membersList.querySelectorAll(".dm-btn").forEach(b => b.addEventListener("click", () => openDMChat(b.dataset.id, b.dataset.name)));
}

function sendFriendRequest(id, name) {
  const cur = currentUser?.uid || "local_user";
  const reqs = getFriendRequests();
  reqs.push({ from: cur, fromName: currentUserName, to: id, toName: name, status: "pending", createdAt: new Date().toISOString() });
  saveFriendRequests(reqs);
  renderMembers(); renderFriendRequests();
}

function acceptFriendRequest(fromId) {
  const reqs = getFriendRequests();
  const idx = reqs.findIndex(r => r.from === fromId && r.to === (currentUser?.uid || "local_user"));
  if (idx === -1) return;
  reqs.splice(idx, 1);
  saveFriendRequests(reqs);
  const friends = getFriends();
  const cur = currentUser?.uid || "local_user";
  if (!friends[cur]) friends[cur] = [];
  if (!friends[cur].includes(fromId)) friends[cur].push(fromId);
  if (!friends[fromId]) friends[fromId] = [];
  if (!friends[fromId].includes(cur)) friends[fromId].push(cur);
  saveFriends(friends);
  renderMembers(); renderFriendRequests();
}

function declineFriendRequest(fromId) {
  const reqs = getFriendRequests();
  const idx = reqs.findIndex(r => r.from === fromId && r.to === (currentUser?.uid || "local_user"));
  if (idx === -1) return;
  reqs.splice(idx, 1);
  saveFriendRequests(reqs);
  renderMembers(); renderFriendRequests();
}

function renderFriendRequests() {
  if (!friendRequestsList) return;
  const cur = currentUser?.uid || "local_user";
  const reqs = getFriendRequests();
  const incoming = reqs.filter(r => r.to === cur && r.status === "pending");
  const outgoing = reqs.filter(r => r.from === cur && r.status === "pending");
  if (friendRequestCount) friendRequestCount.textContent = incoming.length.toString();
  friendRequestsList.innerHTML = "";
  if (incoming.length === 0 && outgoing.length === 0) {
    friendRequestsList.innerHTML = '<p class="helper-text">No requests</p>'; return;
  }
  incoming.forEach(r => {
    const d = document.createElement("div"); d.className = "friend-request-item";
    d.innerHTML = `<span>📩 <strong>${r.fromName}</strong></span><div class="request-actions"><button class="mini-btn accept-btn" data-id="${r.from}">✅</button><button class="mini-btn secondary decline-btn" data-id="${r.from}">✕</button></div>`;
    friendRequestsList.appendChild(d);
    d.querySelector(".accept-btn").addEventListener("click", () => acceptFriendRequest(r.from));
    d.querySelector(".decline-btn").addEventListener("click", () => declineFriendRequest(r.from));
  });
  outgoing.forEach(r => {
    const d = document.createElement("div"); d.className = "friend-request-item";
    d.innerHTML = `<span>⏳ Sent to <strong>${r.toName}</strong></span>`;
    friendRequestsList.appendChild(d);
  });
}

function openDMChat(uid, name) {
  if (!dmChatPanel) return;
  activeDMUserId = uid;
  dmChatPanel.hidden = false;
  if (dmChatWith) dmChatWith.textContent = `💬 Chat with ${name}`;
  renderDMMessages();
}

function renderDMMessages() {
  if (!dmChatMessages || !activeDMUserId) return;
  const msgs = getDMMessages(activeDMUserId);
  dmChatMessages.innerHTML = "";
  if (msgs.length === 0) { dmChatMessages.innerHTML = '<p class="helper-text">No messages yet.</p>'; return; }
  msgs.forEach(msg => {
    const isMe = msg.from === (currentUser?.uid || "local_user");
    const d = document.createElement("div"); d.className = "chat-message";
    d.style.marginLeft = isMe ? "20px" : "0";
    d.style.marginRight = isMe ? "0" : "20px";
    d.style.background = isMe ? "rgba(0,200,83,0.1)" : "white";
    d.innerHTML = `<div class="chat-author">${isMe ? "You" : msg.fromName}</div><div class="chat-text">${msg.text}</div><div class="chat-time">${new Date(msg.createdAt).toLocaleTimeString()}</div>`;
    dmChatMessages.appendChild(d);
  });
  dmChatMessages.scrollTop = dmChatMessages.scrollHeight;
}

if (dmChatForm) {
  dmChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeDMUserId || !dmMessageInput) return;
    const text = dmMessageInput.value.trim();
    if (!text) return;
    saveDMMessage(activeDMUserId, { from: currentUser?.uid || "local_user", fromName: currentUserName, text, createdAt: new Date().toISOString() });
    dmMessageInput.value = "";
    renderDMMessages();
  });
}

// ===== COMMUNITY CHAT =====
if (communityChatForm) {
  communityChatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const input = communityChatForm.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await addDoc(collection(db, "communityChat"), {
        authorId: currentUser.uid, authorName: currentUserName, authorAvatar: currentUserAvatar, text, createdAt: serverTimestamp()
      });
      input.value = "";
    } catch (err) { console.error(err); }
  });
}

function listenToChat() {
  const q = query(collection(db, "communityChat"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snap) => {
    if (!communityChatList) return;
    communityChatList.innerHTML = "";
    snap.docs.forEach(d => {
      const m = d.data();
      const item = document.createElement("div"); item.className = "chat-message";
      item.innerHTML = `<div class="chat-author">${m.authorAvatar || "👤"} ${m.authorName || "Guest"}</div><div class="chat-text">${m.text || ""}</div><div class="chat-time">${m.createdAt?.toMillis ? timeAgo(m.createdAt.toMillis()) : ""}</div>`;
      communityChatList.appendChild(item);
    });
  }, console.error);
}

// ===== TEAMMATES SYSTEM (Firestore-based) =====
/**
 * Load teammates from the logged-in user's Firestore subcollection
 */
async function loadTeammates() {
  if (!teammatesList) return;
  if (!currentUser) {
    teammatesList.innerHTML = '<p class="helper-text" style="font-size:13px;">Sign in to see your teammates.</p>';
    return;
  }

  try {
    const teammatesSnap = await getDocs(collection(db, "users", currentUser.uid, "teammates"));

    if (teammatesSnap.empty) {
      teammatesList.innerHTML = '<p class="helper-text" style="font-size:13px;">No teammates yet. Add teammates from user profiles!</p>';
      return;
    }

    teammatesList.innerHTML = "";
    teammatesSnap.docs.forEach(async (docSnap) => {
      const teammateId = docSnap.id;
      // Fetch the teammate's user profile for display name & photo
      const userSnap = await getDoc(doc(db, "users", teammateId));
      const userData = userSnap.exists() ? userSnap.data() : {};
      const displayName = userData.displayName || userData.firstName || "Unknown";
      const photoURL = userData.photoURL || "";
      const initials = displayName.split(" ").map(s => s[0]).join("").substring(0, 2).toUpperCase() || "?";

      const item = document.createElement("div");
      item.className = "teammate-item";
      item.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #eef2f6;cursor:pointer;";
      item.innerHTML = `
        <div style="position:relative;width:36px;height:36px;flex-shrink:0;">
          ${photoURL ? `<img src="${photoURL}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">` : `<div style="width:36px;height:36px;border-radius:50%;background:#0b2d4d;color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;">${initials}</div>`}
          <span class="status-dot online" style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;border:2px solid white;background:#22c55e;"></span>
        </div>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:14px;color:#0b2d4d;">${displayName}</div>
          <div style="font-size:11px;color:#22c55e;">● Online</div>
        </div>
        <button class="mini-btn chat-teammate-btn" data-id="${teammateId}" data-name="${displayName}" style="padding:6px 12px;background:#0b2d4d;color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">💬</button>
      `;
      teammatesList.appendChild(item);

      // Click to open floating chat
      const chatBtn = item.querySelector(".chat-teammate-btn");
      chatBtn.addEventListener("click", () => openFloatingChat(teammateId, displayName));
    });
  } catch (err) {
    console.error("Error loading teammates:", err);
    teammatesList.innerHTML = '<p class="helper-text" style="font-size:13px;">Could not load teammates.</p>';
  }
}

// ===== FLOATING CHAT POPUP (Facebook-style) =====
let activeFloatingChatPartnerId = null;
let activeFloatingChatPartnerName = "";
let unsubscribeFloatingChat = null;

function openFloatingChat(partnerId, partnerName) {
  if (!floatingChatPopup || !floatingChatMessages || !floatingChatForm || !floatingChatInput) return;

  activeFloatingChatPartnerId = partnerId;
  activeFloatingChatPartnerName = partnerName;

  // Unsubscribe any previous chat listener
  if (unsubscribeFloatingChat) {
    unsubscribeFloatingChat();
    unsubscribeFloatingChat = null;
  }

  // Show popup
  floatingChatPopup.style.display = "flex";
  if (floatingChatTitle) floatingChatTitle.textContent = `💬 ${partnerName}`;

  // Build chat key
  const uid1 = currentUser?.uid || "anon";
  const chatKey = [uid1, partnerId].sort().join("_");
  const messagesRef = collection(db, "liveChats", chatKey, "messages");
  const q = query(messagesRef, orderBy("createdAt", "asc"), limit(100));

  floatingChatMessages.innerHTML = '<p class="helper-text" style="padding:16px;text-align:center;font-size:14px;color:#64748b;">Loading messages...</p>';

  unsubscribeFloatingChat = onSnapshot(q, (snapshot) => {
    floatingChatMessages.innerHTML = "";
    if (snapshot.empty) {
      floatingChatMessages.innerHTML = '<p class="helper-text" style="padding:16px;text-align:center;font-size:14px;color:#64748b;">No messages yet. Say hello! 👋</p>';
      return;
    }
    snapshot.docs.forEach((docSnap) => {
      const msg = docSnap.data();
      const isOwn = msg.authorId === currentUser?.uid;
      const bubble = document.createElement("div");
      bubble.style.cssText = `padding:8px 12px;margin:4px 8px;border-radius:${isOwn ? '16px 4px 16px 16px' : '4px 16px 16px 16px'};background:${isOwn ? '#0b2d4d' : '#eef4f8'};color:${isOwn ? 'white' : '#0b2d4d'};max-width:80%;align-self:${isOwn ? 'flex-end' : 'flex-start'};font-size:14px;`;
      bubble.textContent = msg.text || "";
      floatingChatMessages.appendChild(bubble);
    });
    floatingChatMessages.scrollTop = floatingChatMessages.scrollHeight;
  }, (err) => {
    console.error("Floating chat listen error:", err);
    floatingChatMessages.innerHTML = '<p class="helper-text" style="padding:16px;text-align:center;font-size:14px;color:#ef4444;">Could not load messages.</p>';
  });
}

function closeFloatingChat() {
  if (unsubscribeFloatingChat) {
    unsubscribeFloatingChat();
    unsubscribeFloatingChat = null;
  }
  if (floatingChatPopup) floatingChatPopup.style.display = "none";
  activeFloatingChatPartnerId = null;
  activeFloatingChatPartnerName = "";
}

// Floating chat close button
if (floatingChatClose) {
  floatingChatClose.addEventListener("click", closeFloatingChat);
}

// Floating chat form submit
if (floatingChatForm) {
  floatingChatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeFloatingChatPartnerId || !floatingChatInput || !currentUser) return;
    const text = floatingChatInput.value.trim();
    if (!text) return;

    try {
      const uid1 = currentUser.uid;
      const chatKey = [uid1, activeFloatingChatPartnerId].sort().join("_");
      await addDoc(collection(db, "liveChats", chatKey, "messages"), {
        authorId: currentUser.uid,
        authorName: currentUserName,
        text,
        createdAt: serverTimestamp()
      });
      floatingChatInput.value = "";

      // Send notification to the recipient about the new message
      if (activeFloatingChatPartnerId !== currentUser.uid) {
        createNotification(activeFloatingChatPartnerId, 'message', `${currentUserName} sent you a message: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      }
    } catch (err) {
      console.error("Floating chat send error:", err);
    }
  });

  // Enter key support for floating chat input
  floatingChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      floatingChatForm.dispatchEvent(new Event('submit'));
    }
  });
}

// ===== HIDE SPLASH =====
function hideAppSplash() {
  document.getElementById("appSplash")?.classList.add("hidden");
}

// ===== AUTH STATE =====
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  currentUserName = user?.displayName || user?.email?.split("@")[0] || "Guest";
  currentUserAvatar = "👤";
  if (createPostAvatar) createPostAvatar.textContent = currentUserAvatar;
  if (document.getElementById("postModalAvatar")) {
    document.getElementById("postModalAvatar").textContent = currentUserAvatar;
    document.getElementById("postModalName").textContent = currentUserName;
  }
  hideAppSplash();
  renderMembers();
  renderFriendRequests();
  loadTeammates(); // Load teammates on auth change
});

window.addEventListener("load", hideAppSplash);

// ===== MOBILE SIDEBAR TOGGLE =====
const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
const fbSidebar = document.getElementById("fbSidebar");

if (sidebarToggleBtn && fbSidebar) {
  sidebarToggleBtn.addEventListener("click", () => {
    const isHidden = fbSidebar.hasAttribute("hidden");
    if (isHidden) {
      fbSidebar.removeAttribute("hidden");
      sidebarToggleBtn.classList.add("active");
      sidebarToggleBtn.textContent = "✕ Close Sidebar";
    } else {
      fbSidebar.setAttribute("hidden", "");
      sidebarToggleBtn.classList.remove("active");
      sidebarToggleBtn.textContent = "☰ Sidebar";
    }
  });

  // On window resize >= 768px, ensure sidebar is visible and button hidden
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      fbSidebar.removeAttribute("hidden");
      sidebarToggleBtn.classList.remove("active");
      sidebarToggleBtn.textContent = "☰ Sidebar";
    }
  });
}

// ===== INIT =====
renderStories();
loadFeed();
listenToChat();
renderMembers();
renderFriendRequests();
loadUserDirectory(); // Load @mention directory

