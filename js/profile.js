/**
 * GFHF Public User Profile Module
 * Displays any user's profile, photo gallery, and activity feed
 * Accessed via: pages/profile.html?uid=USER_ID
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, orderBy, getDocs, setDoc, addDoc, arrayUnion, arrayRemove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createNotification } from "./notifications.js";
import { blockUser, createReport } from "./moderation.js";

// ===== DOM REFS =====
const profileAvatar = document.getElementById("profileAvatar");
const profileAvatarPlaceholder = document.getElementById("profileAvatarPlaceholder");
const profileDisplayName = document.getElementById("profileDisplayName");
const profileEmail = document.getElementById("profileEmail");
const profileCountry = document.getElementById("profileCountry");
const profileCity = document.getElementById("profileCity");
const profileTeam = document.getElementById("profileTeam");
const profileUniqueId = document.getElementById("profileUniqueId");
const profileGallery = document.getElementById("profileGallery");
const profileGalleryEmpty = document.getElementById("profileGalleryEmpty");
const profileWallFeed = document.getElementById("profileWallFeed");
const profileWallEmpty = document.getElementById("profileWallEmpty");
const reportUserBtn = document.getElementById("reportUserBtn");
const blockUserBtn = document.getElementById("blockUserBtn");

/**
 * Safe HTML escaping
 */
function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

/**
 * Time ago formatter
 */
function timeAgo(timestamp) {
  const now = Date.now();
  let t;
  if (timestamp?.toMillis) t = timestamp.toMillis();
  else if (typeof timestamp === "string") t = new Date(timestamp).getTime();
  else if (typeof timestamp === "number") t = timestamp;
  else t = now;
  const diff = Math.floor((now - t) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * Load and display a user's profile from Firestore
 */
async function loadProfile(uid) {
  if (!uid) {
    profileDisplayName.textContent = "No user specified";
    profileWallFeed.innerHTML = '<p style="color:#ef4444;">❌ Missing user ID in URL.</p>';
    return;
  }

  try {
    // Fetch user document
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      profileDisplayName.textContent = "User not found";
      profileCountry.textContent = "—";
      profileCity.textContent = "—";
      profileTeam.textContent = "—";
      profileUniqueId.textContent = "—";
      if (profileWallEmpty) profileWallEmpty.textContent = "This user has no activity yet.";
      return;
    }

    const data = userSnap.data();
    const displayName = data.displayName || data.firstName || "Anonymous";
    const photoURL = data.photoURL || "";

    // --- Profile Header ---
    profileDisplayName.textContent = displayName;
    profileEmail.textContent = data.email || "";
    profileCountry.textContent = data.country || "Not provided";
    profileCity.textContent = data.city || "Not provided";
    profileTeam.textContent = data.club || data.nationalTeam || "Not provided";
    profileUniqueId.textContent = data.uniqueId || "—";

    // Profile avatar
    if (photoURL) {
      profileAvatar.src = photoURL;
      profileAvatar.style.display = "block";
      profileAvatarPlaceholder.style.display = "none";
    } else {
      profileAvatar.style.display = "none";
      profileAvatarPlaceholder.style.display = "flex";
      // Generate initials
      const initials = displayName
        .split(" ")
        .map(s => s[0])
        .join("")
        .substring(0, 2)
        .toUpperCase() || "?";
      profileAvatarPlaceholder.textContent = initials;
    }

    // --- Photo Gallery ---
    const galleryPhotos = data.galleryPhotos || [];
    if (galleryPhotos.length > 0) {
      if (profileGalleryEmpty) profileGalleryEmpty.style.display = "none";
      galleryPhotos.forEach((url, index) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;display:inline-block;width:110px;height:110px;border-radius:12px;overflow:hidden;border:2px solid #e2e8f0;flex-shrink:0;";
        const img = document.createElement("img");
        img.src = url;
        img.alt = `Gallery photo ${index + 1}`;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;";
        img.loading = "lazy";
        wrap.appendChild(img);
        profileGallery.appendChild(wrap);
      });
    } else {
      if (profileGalleryEmpty) profileGalleryEmpty.style.display = "block";
    }

    // --- Wall / Activity Feed ---
    await loadUserPosts(uid);

  } catch (err) {
    console.error("Error loading profile:", err);
    profileDisplayName.textContent = "Error loading profile";
    profileWallFeed.innerHTML = `<p style="color:#ef4444;">❌ Failed to load profile: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Load all posts by a user from the `posts` collection
 * Fetches without orderBy to avoid Firestore composite index requirement,
 * then sorts locally in JavaScript.
 */
async function loadUserPosts(uid) {
  if (!profileWallFeed) return;
  if (!uid) {
    profileWallFeed.innerHTML = '<p style="color:#64748b;font-size:14px;">No user ID provided.</p>';
    return;
  }

  try {
    // Fetch posts without orderBy to avoid needing a composite index
    const postsQuery = query(
      collection(db, "posts"),
      where("authorId", "==", uid)
    );
    const querySnap = await getDocs(postsQuery);

    if (querySnap.empty) {
      profileWallFeed.innerHTML = '<p style="color:#64748b;font-size:14px;">This user has not posted anything yet.</p>';
      return;
    }

    // Convert to array and sort locally by timestamp (newest first)
    const posts = [];
    querySnap.docs.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };
      // Normalize timestamp field for sorting
      data._sortTime = data.timestamp?.toMillis
        ? data.timestamp.toMillis()
        : data.createdAt?.toMillis
          ? data.createdAt.toMillis()
          : typeof data.timestamp === "string"
            ? new Date(data.timestamp).getTime()
            : typeof data.createdAt === "string"
              ? new Date(data.createdAt).getTime()
              : 0;
      posts.push(data);
    });
    posts.sort((a, b) => b._sortTime - a._sortTime);

    profileWallFeed.innerHTML = "";
    posts.forEach((post) => {

      // Support both rawText and text fields
      const displayText = post.rawText || post.text || "";
      const safeText = displayText.includes('<') ? displayText : escapeHtml(displayText);
      const hasImage = post.imageUrl ? true : false;
      const likeCount = Array.isArray(post.likes) ? post.likes.length : (typeof post.likes === 'number' ? post.likes : 0);
      const commentCount = Array.isArray(post.comments) ? post.comments.length : 0;
      const timestamp = post.timestamp || post.createdAt;

      const card = document.createElement("div");
      card.className = "wall-post-card card";
      card.style.cssText = "padding:16px;border:1px solid #e2e8f0;border-radius:14px;background:#fafcff;";

      card.innerHTML = `
        <div class="wall-post-header">
          <div class="wall-avatar">${escapeHtml(post.authorAvatar || "👤")}</div>
          <div class="wall-post-author">
            <strong>${escapeHtml(post.authorName || "Anonymous")}</strong>
            <span class="post-meta">${timeAgo(timestamp)} · ${escapeHtml(post.interest || "General")}</span>
          </div>
        </div>
        <div class="post-body">
          <p>${safeText}</p>
        </div>
        ${hasImage ? `<div style="margin:8px 0;border-radius:12px;overflow:hidden;max-height:300px;"><img src="${escapeHtml(post.imageUrl)}" alt="Post image" style="width:100%;height:auto;max-height:300px;object-fit:cover;border-radius:12px;" loading="lazy"></div>` : ""}
        <div style="display:flex;gap:16px;padding-top:10px;border-top:1px solid #e9eef4;font-size:13px;color:#64748b;">
          <span>👍 ${likeCount}</span>
          <span>💬 ${commentCount}</span>
        </div>
      `;

      profileWallFeed.appendChild(card);
    });

  } catch (err) {
    console.error("Error loading user posts:", err);
    profileWallFeed.innerHTML = '<p style="color:#ef4444;">❌ Failed to load activity feed. Please try again later.</p>';
  }
}

// ===== ADD TEAMMATE SYSTEM =====
let profileUserId = null;
let loggedInUserId = null;

/**
 * Check if the target user is already a teammate of the logged-in user
 * by reading a doc from users/{loggedInUserId}/teammates/{targetUid}
 * @param {string} targetUid - The profile being viewed
 * @returns {Promise<boolean>} true if already a teammate
 */
async function isAlreadyTeammate(targetUid) {
  if (!loggedInUserId || !targetUid) return false;
  try {
    const teammateDoc = await getDoc(doc(db, "users", loggedInUserId, "teammates", targetUid));
    return teammateDoc.exists();
  } catch (err) {
    console.warn("Could not check teammate status:", err);
    return false;
  }
}

/**
 * Update the Add Teammate button UI based on connection status
 * @param {boolean} isTeammate - Whether the target is already a teammate
 */
function updateAddTeammateBtnUI(isTeammate) {
  const addBtn = document.getElementById("addTeammateBtn");
  if (!addBtn) return;

  if (isTeammate) {
    addBtn.innerHTML = '👥 TEAMMATES';
    addBtn.disabled = true;
    addBtn.classList.add('is-teammate');
    addBtn.style.background = '#10b981';
    addBtn.style.cursor = 'default';
    addBtn.style.opacity = '0.8';
  } else {
    addBtn.innerHTML = '👤 Add Teammate';
    addBtn.disabled = false;
    addBtn.classList.remove('is-teammate');
    addBtn.style.background = '';
    addBtn.style.cursor = 'pointer';
    addBtn.style.opacity = '1';
  }
}

/**
 * Add a user as a teammate (mutual) and create a chat thread
 * Step 1: Send a teammate_request notification to the target user
 * Step 2: Immediately update the button UI to show "TEAMMATES" without reload
 */
async function handleAddTeammate(targetUid) {
  if (!loggedInUserId || !targetUid || loggedInUserId === targetUid) return;
  try {
    const senderSnap = await getDoc(doc(db, "users", loggedInUserId));
    const senderData = senderSnap.exists() ? senderSnap.data() : {};
    const senderName = senderData.displayName || senderData.firstName || "A user";
    const senderAvatar = senderData.photoURL || "👤";

    const notificationsRef = collection(db, "notifications", targetUid, "items");
    await addDoc(notificationsRef, {
      type: "teammate_request",
      senderId: loggedInUserId,
      recipientId: targetUid,
      senderName,
      senderAvatar,
      status: "pending",
      message: `${senderName} wants to connect as a teammate.`,
      read: false,
      createdAt: serverTimestamp()
    });

    updateAddTeammateBtnUI(false);
    alert("✅ Teammate request sent! Waiting for approval.");
  } catch (err) {
    console.error("Error sending teammate request:", err);
    alert("Failed to send teammate request. Please try again.");
  }
}

async function handleReportUser(targetUid, targetName) {
  if (!loggedInUserId || !targetUid || loggedInUserId === targetUid) return;
  const reason = window.prompt(`Why are you reporting ${targetName || "this user"}?`, "Spam or abuse");
  if (!reason) return;
  try {
    const reportId = await createReport({
      reporterId: loggedInUserId,
      targetType: "user",
      targetId: targetUid,
      reason,
      details: { profileView: true },
      targetUserId: targetUid
    });
    if (reportId) {
      alert("✅ Report submitted for review.");
    } else {
      alert("Unable to submit report right now.");
    }
  } catch (err) {
    console.error("Error reporting user:", err);
    alert("Failed to report user.");
  }
}

async function handleBlockUser(targetUid, targetName) {
  if (!loggedInUserId || !targetUid || loggedInUserId === targetUid) return;
  const confirmed = window.confirm(`Block ${targetName || "this user"}? You will no longer interact with them on the platform.`);
  if (!confirmed) return;
  try {
    const blocked = await blockUser(loggedInUserId, targetUid, "Blocked from profile action");
    if (blocked) {
      alert("✅ User blocked.");
    } else {
      alert("Unable to block this user right now.");
    }
  } catch (err) {
    console.error("Error blocking user:", err);
    alert("Failed to block user.");
  }
}

// ===== PAGE LOAD =====
onAuthStateChanged(auth, async (user) => {
  // Get uid from URL params
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("uid");
  profileUserId = uid;
  loggedInUserId = user?.uid || null;

  loadProfile(uid);

  // Show profile action buttons only if viewing another user's profile
  const addTeammateBtn = document.getElementById("addTeammateBtn");
  if (addTeammateBtn) {
    if (loggedInUserId && profileUserId && loggedInUserId !== profileUserId) {
      addTeammateBtn.style.display = "inline-block";

      // Check existing teammate status and update UI accordingly
      const alreadyTeammate = await isAlreadyTeammate(profileUserId);
      updateAddTeammateBtnUI(alreadyTeammate);

      addTeammateBtn.onclick = () => handleAddTeammate(profileUserId);
    } else {
      addTeammateBtn.style.display = "none";
    }
  }

  if (reportUserBtn) {
    if (loggedInUserId && profileUserId && loggedInUserId !== profileUserId) {
      reportUserBtn.style.display = "inline-block";
      reportUserBtn.onclick = () => handleReportUser(profileUserId, profileDisplayName.textContent);
    } else {
      reportUserBtn.style.display = "none";
    }
  }

  if (blockUserBtn) {
    if (loggedInUserId && profileUserId && loggedInUserId !== profileUserId) {
      blockUserBtn.style.display = "inline-block";
      blockUserBtn.onclick = () => handleBlockUser(profileUserId, profileDisplayName.textContent);
    } else {
      blockUserBtn.style.display = "none";
    }
  }
});

