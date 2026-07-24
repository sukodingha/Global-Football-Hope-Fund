/**
* GFHF Dashboard Module — Account overview + User Wall (localStorage)
 * Features: profile photo upload (Cloudinary), photo gallery, unique ID display
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, addDoc, collection, query, where, getDocs, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { updateHeaderAvatar } from "./auth.js";

// ===== DOM refs =====
const welcomeText = document.getElementById("welcomeText");
const userEmail = document.getElementById("userEmail");
const messageBox = document.getElementById("messageBox");
const profileSummary = document.getElementById("profileSummary");
const predictionSummary = document.getElementById("predictionSummary");
const uniqueIdSection = document.getElementById("uniqueIdSection");
const avatarUploadInput = document.getElementById("avatarUploadInput");
const uploadAvatarBtn = document.getElementById("uploadAvatarBtn");
const uploadSpinner = document.getElementById("uploadSpinner");
const currentProfilePic = document.getElementById("currentProfilePic");
const profilePicPlaceholder = document.getElementById("profilePicPlaceholder");
const photoGalleryContainer = document.getElementById("photoGalleryContainer");
const photoUploadInput = document.getElementById("photoUploadInput");

// Wall elements
const wallPostForm = document.getElementById("wallPostForm");
const wallPostText = document.getElementById("wallPostText");
const wallMessage = document.getElementById("wallMessage");
const wallFeed = document.getElementById("wallFeed");

// Editable profile elements
const editDisplayName = document.getElementById("editDisplayName");
const editBio = document.getElementById("editBio");
const editCountry = document.getElementById("editCountry");
const editCity = document.getElementById("editCity");
const editFavTeam = document.getElementById("editFavTeam");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const editProfileToggleBtn = document.getElementById("editProfileToggleBtn");
const profileEditSection = document.getElementById("profileEditSection");

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
 * Safe Firestore DB guard — prevents Uncaught FirebaseError if db is null
 */
function guardDb() {
  if (!db) {
    console.warn("Firestore (db) is not initialized.");
    return false;
  }
  return true;
}

// ===== Spinner Controls =====
function showSpinner() {
  if (uploadSpinner) uploadSpinner.hidden = false;
  if (uploadAvatarBtn) uploadAvatarBtn.disabled = true;
}
function hideSpinner() {
  if (uploadSpinner) uploadSpinner.hidden = true;
  if (uploadAvatarBtn) uploadAvatarBtn.disabled = false;
}

/**
 * Immediately update the #currentProfilePic element on the dashboard
 * without a full page reload — Facebook-style instant refresh.
 */
function updateCurrentProfilePicUI(photoURL) {
  if (!currentProfilePic || !profilePicPlaceholder) return;
  if (photoURL) {
    currentProfilePic.src = photoURL;
    currentProfilePic.style.display = "block";
    profilePicPlaceholder.style.display = "none";
  } else {
    currentProfilePic.style.display = "none";
    profilePicPlaceholder.style.display = "flex";
  }
}

/**
 * Upload an image file to Cloudinary using the unsigned upload preset.
 * Returns the secure URL from Cloudinary, or null on failure.
 */
async function handleImageUpload(fileInput) {
    const file = fileInput.files[0];
    if (!file) {
        alert('Please select an image first!');
        return null;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'football_preset');

    try {
        const response = await fetch('https://api.cloudinary.com/v1_1/d8obkydb/image/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (data.secure_url) {
            console.log('Upload successful:', data.secure_url);
            return data.secure_url; // This URL goes straight to Firestore!
        } else {
            throw new Error(data.error?.message || 'Cloudinary upload failed.');
        }
    } catch (error) {
        console.error('Error uploading image:', error);
        alert('Image upload failed. Check your console for details.');
        return null;
    }
}

/**
 * Upload a file to Cloudinary and return the secure URL.
 * Accepts a File object directly (not a file input element).
 */
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', 'football_preset');

  try {
    const response = await fetch('https://api.cloudinary.com/v1_1/d8obkydb/image/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.secure_url) {
      console.log('Upload successful:', data.secure_url);
      return data.secure_url;
    } else {
      throw new Error(data.error?.message || 'Cloudinary upload failed.');
    }
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
}

/**
 * Combined handler: upload profile photo to Cloudinary → update Auth profile →
 * update Firestore (photoURL + galleryPhotos) → refresh UI everywhere.
 * Facebook-style instant refresh.
 */
async function handleProfilePhotoUpload(file, user) {
  if (!file || !user) return;
  if (!guardDb()) {
    showMessage("Database unavailable. Please try again later.", "error");
    return;
  }

  showSpinner();
  try {
    // 1. Local preview (instant)
    const localPreviewUrl = URL.createObjectURL(file);
    updateHeaderAvatar(localPreviewUrl, user.displayName || user.email?.split("@")[0]);
    updateCurrentProfilePicUI(localPreviewUrl);

    // 2. Upload to Cloudinary
    const downloadURL = await uploadToCloudinary(file);

    // 3. Update Firebase Auth profile
    await updateProfile(user, { photoURL: downloadURL });

    // 4. Update Firestore: set photoURL + append to galleryPhotos
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    const profile = snap.exists() ? snap.data() : {};
    const existingGallery = profile.galleryPhotos || profile.photos || [];
    // Avoid duplicates if same URL already exists
    if (!existingGallery.includes(downloadURL)) {
      existingGallery.push(downloadURL);
    }
    await setDoc(userRef, {
      photoURL: downloadURL,
      galleryPhotos: existingGallery
    }, { merge: true });

    // 5. Clean up local object URL
    URL.revokeObjectURL(localPreviewUrl);

    // 6. Refresh UI everywhere (Facebook-style)
    updateHeaderAvatar(downloadURL, user.displayName || user.email?.split("@")[0]);
    updateCurrentProfilePicUI(downloadURL);
    renderPhotoGallery(user.uid);

    showMessage("Profile picture updated successfully!", "success");
  } catch (err) {
    console.error("Profile photo upload error:", err);
    showMessage("Failed to upload profile picture. Please try again.", "error");
    // Revert local preview on error
    const currentPhotoURL = user.photoURL || "";
    updateHeaderAvatar(currentPhotoURL, user.displayName || user.email?.split("@")[0]);
    updateCurrentProfilePicUI(currentPhotoURL);
  } finally {
    hideSpinner();
    // Reset the file input so the same file can be re-selected
    if (avatarUploadInput) avatarUploadInput.value = "";
  }
}

/**
 * Ensure the user has a uniqueId in Firestore
 */
async function ensureUniqueId(user, profile) {
  if (profile.uniqueId) return profile.uniqueId;
  if (!guardDb()) return "#GFHF-ERROR";
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
 * Render the photo gallery with "Set as Profile Picture" buttons and "Active Profile Pic" badge
 */
async function renderPhotoGallery(userId) {
  if (!photoGalleryContainer) return;
  const profileRef = doc(db, "users", userId);
  const snap = await getDoc(profileRef);
  const profile = snap.exists() ? snap.data() : {};
  const photos = profile.galleryPhotos || profile.photos || [];
  const currentPhotoURL = profile.photoURL || "";

  if (photos.length === 0) {
    photoGalleryContainer.innerHTML = '<p style="color:#64748b;font-size:14px;">No photos yet. Upload your first photo below!</p>';
    return;
  }

  photoGalleryContainer.innerHTML = photos.map((url, index) => {
    const isActiveProfile = url === currentPhotoURL;
    return `
    <div style="position:relative;display:inline-flex;flex-direction:column;align-items:center;margin:6px;padding:6px;background:#fff;border-radius:14px;border:2px solid ${isActiveProfile ? '#00c853' : '#e2e8f0'};box-shadow:${isActiveProfile ? '0 0 16px rgba(0,200,83,0.25)' : 'none'};min-width:130px;">
      <div style="position:relative;width:120px;height:120px;">
        <img src="${url}" alt="Gallery photo ${index + 1}" style="width:120px;height:120px;object-fit:cover;border-radius:10px;">
        ${isActiveProfile ? '<span style="position:absolute;top:4px;left:4px;background:#00c853;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;">⭐ Active</span>' : ''}
        <button class="delete-photo-btn" data-index="${index}" style="position:absolute;top:4px;right:4px;width:24px;height:24px;border:none;border-radius:50%;background:rgba(0,0,0,0.6);color:white;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>
      </div>
      <button type="button" class="set-profile-btn" data-url="${url}" style="margin-top:6px;padding:5px 10px;border:none;border-radius:999px;background:${isActiveProfile ? '#00c853' : '#0b2d4d'};color:white;font-size:11px;font-weight:700;cursor:pointer;width:100%;">${isActiveProfile ? '✅ Active Profile Pic' : '🖼 Set as Profile Picture'}</button>
    </div>
  `}).join('');

  // Delete photo handler
  photoGalleryContainer.querySelectorAll(".delete-photo-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.dataset.index);
      photos.splice(index, 1);
      await setDoc(doc(db, "users", userId), { galleryPhotos: photos }, { merge: true });
      renderPhotoGallery(userId);
    });
  });

  // Set as Profile Picture handler — also refreshes #currentProfilePic and header
  photoGalleryContainer.querySelectorAll(".set-profile-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      try {
        // Update Firestore
        await setDoc(doc(db, "users", userId), { photoURL: url }, { merge: true });
        // Update Firebase Auth profile
        if (auth.currentUser) {
          await updateProfile(auth.currentUser, { photoURL: url });
        }
        // Update dashboard #currentProfilePic immediately
        updateCurrentProfilePicUI(url);
        // Update header immediately
        const displayName = profile.displayName || auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Member";
        updateHeaderAvatar(url, displayName);
        // Re-render gallery to show the Active badge
        renderPhotoGallery(userId);
        showMessage("Profile picture updated!", "success");
      } catch (err) {
        showMessage("Failed to set profile picture.", "error");
        console.error(err);
      }
    });
  });
}

// ===== Editable Profile =====
/**
 * Load the user's profile fields from Firestore into the edit fields.
 */
async function loadEditableProfile(user) {
  if (!editDisplayName || !editBio) return;
  const profileRef = doc(db, "users", user.uid);
  const snap = await getDoc(profileRef);
  if (snap.exists()) {
    const data = snap.data();
    editDisplayName.value = data.displayName || "";
    editBio.value = data.bio || "";
    if (editCountry) editCountry.value = data.country || "";
    if (editCity) editCity.value = data.city || "";
    if (editFavTeam) editFavTeam.value = data.club || data.nationalTeam || "";
  }
}

/**
 * Save profile fields to Firestore with edit limit (max 10 edits).
 * If editCount < 10: update directly and increment editCount.
 * If editCount >= 10: save to pendingEdits collection for admin approval.
 */
async function handleSaveProfile(user) {
  if (!user || !guardDb()) {
    showMessage("Unable to save. Try again later.", "error");
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  const profile = snap.exists() ? snap.data() : {};
  const editCount = profile.editCount || 0;

  const updatedFields = {};

  // Collect the editable fields (Display Name is readonly so we keep existing)
  if (editBio) {
    const val = editBio.value.trim();
    if (val) updatedFields.bio = val;
  }
  if (editCountry) {
    const val = editCountry.value.trim();
    if (val) updatedFields.country = val;
  }
  if (editCity) {
    const val = editCity.value.trim();
    if (val) updatedFields.city = val;
  }
  if (editFavTeam) {
    const val = editFavTeam.value.trim();
    if (val) updatedFields.club = val;
  }

  // Always send bio even if empty (to allow clearing)
  updatedFields.bio = editBio?.value?.trim() || "";

  if (Object.keys(updatedFields).length === 0) {
    showMessage("No changes to save.", "error");
    return;
  }

  if (editCount < 10) {
    // --- UNDER LIMIT: Update directly ---
    try {
      await setDoc(userRef, updatedFields, { merge: true });
      // Increment editCount
      await setDoc(userRef, { editCount: increment(1) }, { merge: true });

      // Refresh the profile summary and header
      const freshSnap = await getDoc(userRef);
      const freshProfile = freshSnap.exists() ? freshSnap.data() : {};
      if (welcomeText) {
        welcomeText.textContent = `Welcome, ${freshProfile.displayName || freshProfile.firstName || "friend"}!`;
      }

      // Re-render profile summary
      const uniqueId = freshProfile.uniqueId || "";
      if (profileSummary) {
        profileSummary.innerHTML = `
          <p><strong>Country:</strong> ${freshProfile.country || "Not provided"}</p>
          <p><strong>City:</strong> ${freshProfile.city || "Not provided"}</p>
          <p><strong>Favorite Team:</strong> ${freshProfile.club || freshProfile.nationalTeam || "Not provided"}</p>
          <p><strong>Bio:</strong> ${freshProfile.bio || "Not provided"}</p>
          <p><strong>Edits used:</strong> ${(freshProfile.editCount || 0)} / 10</p>
          <p><strong>Unique ID:</strong> <code style="background:#0b2d4d;color:#fff;padding:2px 8px;border-radius:6px;">${uniqueId}</code></p>
        `;
      }

      showMessage("Profile updated successfully!", "success");
    } catch (err) {
      console.error("Save profile error:", err);
      showMessage("Failed to save profile.", "error");
    }
  } else {
    // --- OVER LIMIT: Save as pending edit ---
    try {
      await addDoc(collection(db, "pendingEdits"), {
        userId: user.uid,
        updatedFields: updatedFields,
        requestedAt: serverTimestamp(),
        status: "pending"
      });
      alert("You have reached your 10-edit limit. Your requested updates have been sent to an Admin for approval.");
    } catch (err) {
      console.error("Pending edit save error:", err);
      showMessage("Failed to submit edit request.", "error");
    }
  }
}

// Wire up the Edit Profile toggle button
if (editProfileToggleBtn && profileEditSection) {
  editProfileToggleBtn.addEventListener("click", () => {
    const isHidden = profileEditSection.style.display === "none" || profileEditSection.style.display === "";
    profileEditSection.style.display = isHidden ? "block" : "none";
    editProfileToggleBtn.textContent = isHidden ? "🙈 Hide Edit Form" : "✏️ Edit Profile";
  });
}

// Wire up the Save Profile button
if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", () => {
    handleSaveProfile(auth.currentUser);
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
      <p><strong>Bio:</strong> ${profile.bio || "Not provided"}</p>
      <p><strong>Edits used:</strong> ${(profile.editCount || 0)} / 10</p>
      <p><strong>Unique ID:</strong> <code style="background:#0b2d4d;color:#fff;padding:2px 8px;border-radius:6px;">${uniqueId}</code></p>
    `;
  }

  // ===== Load existing profile photo into #currentProfilePic =====
  const existingPhotoURL = profile.photoURL || user.photoURL || "";
  if (existingPhotoURL) {
    updateCurrentProfilePicUI(existingPhotoURL);
  }

  // ===== Load editable profile fields =====
  loadEditableProfile(user);

  // Render photo gallery
  renderPhotoGallery(user.uid);

  // ===== Avatar Upload: #uploadAvatarBtn triggers hidden file input =====
  if (uploadAvatarBtn && avatarUploadInput) {
    uploadAvatarBtn.addEventListener("click", () => {
      avatarUploadInput.click();
    });
  }

  // ===== Avatar file handler — uses handleProfilePhotoUpload for full pipeline =====
  if (avatarUploadInput) {
    avatarUploadInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleProfilePhotoUpload(file, user);
    });
  }

  // ===== Gallery Upload: "Upload New Photo" button triggers hidden input =====
  const uploadPhotoBtn = document.getElementById("uploadPhotoBtn");
  if (uploadPhotoBtn && photoUploadInput) {
    uploadPhotoBtn.addEventListener("click", () => {
      photoUploadInput.click();
    });
  }

  // ===== Photo gallery upload handler =====
  if (photoUploadInput) {
    photoUploadInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      if (!guardDb()) {
        showMessage("Database unavailable. Please try again later.", "error");
        return;
      }
      try {
        for (const file of files) {
          const imageUrl = await uploadToCloudinary(file);
          const snap = await getDoc(doc(db, "users", user.uid));
          const currentProfile = snap.exists() ? snap.data() : {};
          const existing = currentProfile.galleryPhotos || currentProfile.photos || [];
          existing.push(imageUrl);
          await setDoc(doc(db, "users", user.uid), { galleryPhotos: existing }, { merge: true });
        }
        showMessage(`${files.length} photo(s) uploaded to gallery!`, "success");
        renderPhotoGallery(user.uid);
      } catch (err) {
        console.error("Gallery upload error:", err);
        showMessage("Failed to upload photos.", "error");
      } finally {
        photoUploadInput.value = "";
      }
    });
  }

  // ===== Predictions summary =====
  let predictions = [];
  if (guardDb()) {
    try {
      const predictionsRef = collection(db, "predictions");
      const q = query(predictionsRef, where("userId", "==", user.uid));
      const predictionSnap = await getDocs(q);
      predictions = predictionSnap.docs.map((docSnap) => docSnap.data());
    } catch (err) {
      console.warn("Could not fetch predictions:", err);
    }
  }
  if (predictionSummary) {
    const totalPoints = predictions.reduce((sum, p) => sum + (p.points || 0), 0);
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

