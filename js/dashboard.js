/**
 * GFHF Dashboard Module — Account overview + User Wall (localStorage)
 * Features: profile photo upload, photo gallery, unique ID display
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CLOUDINARY_CLOUD_NAME = "d8obkydb";
const CLOUDINARY_UPLOAD_PRESET = "football_preset";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

const welcomeText = document.getElementById("welcomeText");
const userEmail = document.getElementById("userEmail");
const messageBox = document.getElementById("messageBox");
const profileSummary = document.getElementById("profileSummary");
const predictionSummary = document.getElementById("predictionSummary");
const uniqueIdSection = document.getElementById("uniqueIdSection");
const avatarUploadInput = document.getElementById("avatarUploadInput");
const photoGalleryContainer = document.getElementById("photoGalleryContainer");
const photoUploadInput = document.getElementById("photoUploadInput");

// Wall elements
const wallPostForm = document.getElementById("wallPostForm");
const wallPostText = document.getElementById("wallPostText");
const wallMessage = document.getElementById("wallMessage");
const wallFeed = document.getElementById("wallFeed");

const WALL_POSTS_KEY = "gfhf_wall_posts";

function showMessage(text, type = "success") {
  if (!messageBox) return;
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
}

function showWallMessage(text, type = "success") {
  if (!wallMessage) return;
  wallMessage.textContent = text;
  wallMessage.className = `message ${type}`;
}

function getWallPosts() {
  try {
    return JSON.parse(localStorage.getItem(WALL_POSTS_KEY) || "[]");
  } catch { return []; }
}

function saveWallPosts(posts) {
  localStorage.setItem(WALL_POSTS_KEY, JSON.stringify(posts));
}

function renderWallPosts(currentUserId) {
  if (!wallFeed) return;
  const posts = getWallPosts();
  // Sort by newest first
  posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  wallFeed.innerHTML = "";
  if (posts.length === 0) {
    wallFeed.innerHTML = '<p class="helper-text">No wall posts yet. Be the first to share!</p>';
    return;
  }

  posts.forEach((post, index) => {
    const card = document.createElement("div");
    card.className = "card wall-post-card";

    const isOwner = post.authorId === currentUserId;
    const initials = post.authorName.split(" ").map(s => s[0]).join("").substring(0, 2).toUpperCase() || "?";

    card.innerHTML = `
      <div class="wall-post-header">
        <div class="wall-avatar">${initials}</div>
        <div class="wall-post-author">
          <strong>${post.authorName}</strong>
          <span class="post-meta">${new Date(post.createdAt).toLocaleString()}</span>
        </div>
        ${isOwner ? `<button class="mini-btn secondary delete-wall-post" data-index="${index}">🗑️</button>` : ""}
      </div>
      <div class="post-body">
        <p>${post.text}</p>
      </div>
      <div class="wall-post-footer">
        <button class="like-btn wall-like-btn" data-index="${index}">
          👍 <span class="like-count">${post.likes || 0}</span> Agree
        </button>
      </div>
    `;

    // Like button
    card.querySelector(".wall-like-btn")?.addEventListener("click", () => {
      const allPosts = getWallPosts();
      const realIndex = allPosts.findIndex(p => p.createdAt === post.createdAt && p.authorId === post.authorId);
      if (realIndex === -1) return;
      allPosts[realIndex].likes = (allPosts[realIndex].likes || 0) + 1;
      saveWallPosts(allPosts);
      renderWallPosts(currentUserId);
    });

    // Delete button
    card.querySelector(".delete-wall-post")?.addEventListener("click", () => {
      const allPosts = getWallPosts();
      allPosts.splice(index, 1);
      saveWallPosts(allPosts);
      renderWallPosts(currentUserId);
    });

    wallFeed.appendChild(card);
  });
}

// Wall post form handler
if (wallPostForm) {
  wallPostForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = wallPostText?.value?.trim();
    if (!text) {
      showWallMessage("Please write something.", "error");
      return;
    }

    const user = auth.currentUser;
    const authorName = user?.displayName || user?.email?.split("@")[0] || "Anonymous";
    const authorId = user?.uid || "local_anon";

    const posts = getWallPosts();
    posts.push({
      authorId,
      authorName,
      text,
      likes: 0,
      createdAt: new Date().toISOString()
    });
    saveWallPosts(posts);
    wallPostText.value = "";
    showWallMessage("Post published on your wall!", "success");
    renderWallPosts(authorId);
  });
}

/**
 * Generate a unique 8-character alphanumeric User ID (e.g., #GFHF-89A2)
 */
function generateUniqueId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `#GFHF-${code}`;
}

/**
 * Upload a file to Cloudinary and return the secure URL
 */
async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.secure_url;
}

/**
 * Ensure the user has a uniqueId in Firestore
 */
async function ensureUniqueId(user, profile) {
  if (profile.uniqueId) return profile.uniqueId;
  const newId = generateUniqueId();
  const userRef = doc(db, "users", user.uid);
  await setDoc(userRef, { uniqueId: newId }, { merge: true });
  return newId;
}

/**
 * Render the Unique ID section with a Copy button
 */
function renderUniqueId(uniqueId) {
  if (!uniqueIdSection || !uniqueId) return;
  uniqueIdSection.innerHTML = `
    <p><strong>Your Unique ID:</strong></p>
    <div style="display:flex;align-items:center;gap:10px;background:#0b2d4d;color:#fff;padding:12px 16px;border-radius:12px;">
      <span style="font-size:20px;font-weight:900;letter-spacing:0.04em;font-family:monospace;">${uniqueId}</span>
      <button id="copyUniqueIdBtn" class="mini-btn" style="background:#00c853;border:none;color:white;padding:6px 14px;border-radius:999px;font-weight:700;cursor:pointer;">📋 Copy ID</button>
    </div>
    <p style="font-size:13px;color:#64748b;margin-top:6px;">Use this ID for account recovery and tagging in community posts.</p>
  `;
  const copyBtn = document.getElementById("copyUniqueIdBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(uniqueId).then(() => {
        copyBtn.textContent = "✅ Copied!";
        setTimeout(() => { copyBtn.textContent = "📋 Copy ID"; }, 2000);
      }).catch(() => {
        copyBtn.textContent = "❌ Error";
      });
    });
  }
}

/**
 * Render the photo gallery
 */
async function renderPhotoGallery(userId) {
  if (!photoGalleryContainer) return;
  const profileRef = doc(db, "users", userId);
  const snap = await getDoc(profileRef);
  const photos = snap.exists() ? (snap.data().photos || []) : [];

  if (photos.length === 0) {
    photoGalleryContainer.innerHTML = '<p style="color:#64748b;font-size:14px;">No photos yet. Upload your first photo below!</p>';
    return;
  }

  photoGalleryContainer.innerHTML = photos.map((url, index) => `
    <div style="position:relative;display:inline-block;margin:4px;">
      <img src="${url}" alt="User photo ${index + 1}" style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:2px solid #e2e8f0;">
      <button class="delete-photo-btn" data-index="${index}" style="position:absolute;top:4px;right:4px;width:24px;height:24px;border:none;border-radius:50%;background:rgba(0,0,0,0.6);color:white;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>
    </div>
  `).join('');

  photoGalleryContainer.querySelectorAll(".delete-photo-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.dataset.index);
      photos.splice(index, 1);
      await setDoc(doc(db, "users", userId), { photos }, { merge: true });
      renderPhotoGallery(userId);
    });
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showMessage("Please sign in to access your dashboard.", "error");
    renderWallPosts(null);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("goto") === "community") {
    window.location.href = "community.html";
    return;
  }

  if (welcomeText) {
    welcomeText.textContent = `Welcome, ${user.displayName || "friend"}!`;
  }

  if (userEmail) {
    userEmail.textContent = user.email || "No email available";
  }

  const profileRef = doc(db, "users", user.uid);
  const profileSnap = await getDoc(profileRef);
  let profile = {};

  if (profileSnap.exists()) {
    profile = profileSnap.data();
    if (welcomeText) {
      welcomeText.textContent = `Welcome, ${profile.displayName || profile.firstName || "friend"}!`;
    }
  }

  // Ensure unique ID
  const uniqueId = await ensureUniqueId(user, profile);
  renderUniqueId(uniqueId);

  if (profileSummary) {
    profileSummary.innerHTML = `
      <p><strong>Country:</strong> ${profile.country || "Not provided"}</p>
      <p><strong>City:</strong> ${profile.city || "Not provided"}</p>
      <p><strong>Favorite Team:</strong> ${profile.club || profile.nationalTeam || "Not provided"}</p>
      <p><strong>Unique ID:</strong> <code style="background:#0b2d4d;color:#fff;padding:2px 8px;border-radius:6px;">${uniqueId}</code></p>
    `;
  }

  // Render photo gallery
  renderPhotoGallery(user.uid);

  // Avatar upload handler
  if (avatarUploadInput) {
    avatarUploadInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const imageUrl = await uploadToCloudinary(file);
        await updateProfile(user, { photoURL: imageUrl });
        await setDoc(doc(db, "users", user.uid), { photoURL: imageUrl }, { merge: true });
        showMessage("Profile picture updated successfully!", "success");
      } catch (err) {
        showMessage("Failed to upload profile picture.", "error");
        console.error(err);
      }
    });
  }

  // Photo gallery upload handler
  if (photoUploadInput) {
    photoUploadInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      try {
        for (const file of files) {
          const imageUrl = await uploadToCloudinary(file);
          const existing = profile.photos || [];
          existing.push(imageUrl);
          await setDoc(doc(db, "users", user.uid), { photos: existing }, { merge: true });
        }
        showMessage(`${files.length} photo(s) uploaded!`, "success");
        renderPhotoGallery(user.uid);
      } catch (err) {
        showMessage("Failed to upload photos.", "error");
        console.error(err);
      }
    });
  }

  const predictionsRef = collection(db, "predictions");
  const q = query(predictionsRef, where("userId", "==", user.uid));
  const predictionSnap = await getDocs(q);
  const predictions = predictionSnap.docs.map((docSnap) => docSnap.data());

  if (predictionSummary) {
    const totalPoints = predictions.reduce((sum, prediction) => sum + (prediction.points || 0), 0);
    predictionSummary.innerHTML = `
      <p><strong>Predictions submitted:</strong> ${predictions.length}</p>
      <p><strong>Current points:</strong> ${totalPoints}</p>
      <p><strong>Latest pick:</strong> ${predictions[0]?.champion || "No prediction yet"}</p>
    `;
  }

  renderWallPosts(user.uid);
});

// Logout button handler (ES module compatible)
const dashboardLogoutBtn = document.getElementById("dashboardLogoutBtn");
if (dashboardLogoutBtn) {
  dashboardLogoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "../index.html";
    } catch (error) {
      console.error("Logout error:", error);
    }
  });
}
const API_KEY = "6e2987eec8066be0a986f648fe4a9cf7"; // Put your API-Sports key here
const API_HOST = "v3.football.api-sports.io";

async function fetchLiveScores() {
    const feedContainer = document.getElementById('live-scores-feed');
    if (!feedContainer) return;

    try {
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?live=all`, {
            method: "GET",
            headers: {
                "x-rapidapi-host": API_HOST,
                "x-rapidapi-key": API_KEY
            }
        });

        const data = await response.json();
        
        if (!data.response || data.response.length === 0) {
            feedContainer.innerHTML = "<p class='no-matches'>No live matches currently in progress.</p>";
            return;
        }

        // Clear loading text
        feedContainer.innerHTML = "";

        // Render up to 4 current live matches to keep the dashboard clean
        data.response.slice(0, 4).forEach(match => {
            const homeTeam = match.teams.home.name;
            const homeLogo = match.teams.home.logo;
            const awayTeam = match.teams.away.name;
            const awayLogo = match.teams.away.logo;
            const homeGoals = match.goals.home ?? 0;
            const awayGoals = match.goals.away ?? 0;
            const elapsed = match.fixture.status.elapsed;
            const leagueName = match.league.name;

            const matchCard = document.createElement('div');
            matchCard.className = 'match-card';
            matchCard.innerHTML = `
                <div class="match-league">${leagueName} - <span class="live-badge">${elapsed}' Live</span></div>
                <div class="match-teams">
                    <div class="team">
                        <img src="${homeLogo}" alt="${homeTeam}" width="20" height="20">
                        <span>${homeTeam}</span>
                    </div>
                    <div class="score">${homeGoals} - ${awayGoals}</div>
                    <div class="team">
                        <img src="${awayLogo}" alt="${awayTeam}" width="20" height="20">
                        <span>${awayTeam}</span>
                    </div>
                </div>
            `;
            feedContainer.appendChild(matchCard);
        });

    } catch (error) {
        console.error("Error fetching live matches:", error);
        feedContainer.innerHTML = "<p class='error-text'>Failed to load live match data.</p>";
    }
}

// Kick off the fetch when the dashboard loads
document.addEventListener('DOMContentLoaded', fetchLiveScores);

