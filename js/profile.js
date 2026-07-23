/**
 * GFHF Public User Profile Module
 * Displays any user's profile, photo gallery, and activity feed
 * Accessed via: pages/profile.html?uid=USER_ID
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
 */
async function loadUserPosts(uid) {
  if (!profileWallFeed) return;

  try {
    const postsQuery = query(
      collection(db, "posts"),
      where("authorId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const querySnap = await getDocs(postsQuery);

    if (querySnap.empty) {
      profileWallFeed.innerHTML = '<p style="color:#64748b;font-size:14px;">This user has not posted anything yet.</p>';
      return;
    }

    profileWallFeed.innerHTML = "";
    querySnap.docs.forEach((docSnap) => {
      const post = { id: docSnap.id, ...docSnap.data() };
      const card = document.createElement("div");
      card.className = "wall-post-card card";
      card.style.cssText = "padding:16px;border:1px solid #e2e8f0;border-radius:14px;background:#fafcff;";

      const text = post.text || "";
      const hasImage = post.imageUrl ? true : false;
      const likeCount = post.likes?.length || 0;
      const commentCount = post.comments?.length || 0;

      card.innerHTML = `
        <div class="wall-post-header">
          <div class="wall-avatar">${post.authorAvatar || "👤"}</div>
          <div class="wall-post-author">
            <strong>${escapeHtml(post.authorName || "Anonymous")}</strong>
            <span class="post-meta">${timeAgo(post.createdAt)} · ${post.interest || "General"}</span>
          </div>
        </div>
        <div class="post-body">
          <p>${text}</p>
        </div>
        ${hasImage ? `<div style="margin:8px 0;border-radius:12px;overflow:hidden;max-height:300px;"><img src="${post.imageUrl}" alt="Post image" style="width:100%;height:auto;max-height:300px;object-fit:cover;border-radius:12px;" loading="lazy"></div>` : ""}
        <div style="display:flex;gap:16px;padding-top:10px;border-top:1px solid #e9eef4;font-size:13px;color:#64748b;">
          <span>👍 ${likeCount}</span>
          <span>💬 ${commentCount}</span>
        </div>
      `;

      profileWallFeed.appendChild(card);
    });

  } catch (err) {
    console.error("Error loading user posts:", err);
    profileWallFeed.innerHTML = `<p style="color:#ef4444;">❌ Failed to load posts.</p>`;
  }
}

// ===== PAGE LOAD =====
onAuthStateChanged(auth, () => {
  // Get uid from URL params
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("uid");
  loadProfile(uid);
});

