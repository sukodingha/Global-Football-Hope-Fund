/**
 * GFHF Facebook-Style Community Module
 * Stories bar, Create Post modal, Post cards with photo grids,
 * Like/Reaction system, Expandable comments, User profile modals
 * Wallet integration: fund wallet button, wallet balance display
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot, limit,
  serverTimestamp, doc, updateDoc, arrayUnion, getDoc, getDocs, deleteDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createNotification } from "./notifications.js";
import { createReport, checkRateLimit } from "./moderation.js";
import { normalizePrivacy } from "./privacy.js";
import { startLiveStream, endLiveStream } from "./livestream.js";

// Import rewards system for HP badges
import { getHPBadgeHTML, getUserHP, invalidateHPCache, loadRewardData } from "./rewards.js";

// Import shared wallet module
import {
  loadWalletBalance, formatCurrency, getFundWalletModalHTML, initFundWalletModal
} from "./wallet.js";

// ===== CONFIG =====
const CLOUDINARY_CLOUD_NAME = "d8obkydb";
const CLOUDINARY_UPLOAD_PRESET = "chat_uploads";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
const MAX_CLIP_SECONDS = 30; // Hard cap for live recordings + device video uploads

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserAvatar = "👤";
let unsubscribeFeed = null;
let activeInterest = "All";
let activeDMUserId = null;
const chatPanelState = {
  community: false,
  teammates: false
};
let pendingFiles = [];
let pendingMediaType = "image";
let userDirectory = {}; // uniqueId -> { displayName, uid }
let userPhotoCache = {}; // uid -> photoURL (cached to avoid repeated Firestore reads)
let liveStreamTimer = null;
let liveStreamStartTime = null;
let liveStreamActive = false;
let currentLiveStreamId = null;
let cameraStream = null;
let liveCameraStream = null;
let liveRecorder = null;
let liveRecordedChunks = [];
let capturedPhotoDataUrl = null;
let privacySettings = {
  accountType: "public",
  posts: "everyone",
  photos: "everyone",
  videos: "everyone",
  predictionHistory: "everyone",
  onlineStatus: "everyone",
  lastActive: "everyone",
  profile: "everyone"
};

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
const postPrivacySelect = document.getElementById("postPrivacySelect");
const postImagePreview = document.getElementById("postImagePreview");
const postPreviewImg = document.getElementById("postPreviewImg");
const postPreviewVideo = document.getElementById("postPreviewVideo");
const removeImageBtn = document.getElementById("removeImageBtn");
const createPostInput = document.getElementById("createPostInput");
const createPostAvatar = document.getElementById("createPostAvatar");
const openPhotoBtn = document.getElementById("openPhotoBtn");
const openVideoBtn = document.getElementById("openVideoBtn");
const openCameraBtn = document.getElementById("openCameraBtn");
const cameraPreviewWrapper = document.getElementById("cameraPreviewWrapper");
const cameraPreview = document.getElementById("cameraPreview");
const capturePhotoBtn = document.getElementById("capturePhotoBtn");
const retakePhotoBtn = document.getElementById("retakePhotoBtn");
const uploadPhotoBtn = document.getElementById("uploadPhotoBtn");
const liveVideoModal = document.getElementById("liveVideoModal");
const liveVideoOverlay = document.getElementById("liveVideoOverlay");
const liveVideoClose = document.getElementById("liveVideoClose");
const liveVideoStartBtn = document.getElementById("liveVideoStartBtn");
const liveVideoEndBtn = document.getElementById("liveVideoEndBtn");
const liveVideoPreview = document.getElementById("liveVideoPreview");
const liveVideoStatus = document.getElementById("liveVideoStatus");
const liveVideoBadge = document.getElementById("liveVideoBadge");
const liveViewerCount = document.getElementById("liveViewerCount");
const liveVideoTimer = document.getElementById("liveVideoTimer");

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

function setChatPanelState(panelKey, minimized) {
  const panel = panelKey === "community"
    ? document.getElementById("community-chat-box")
    : document.getElementById("teammate-chat-box");

  if (!panel) return;

  const btn = panel.querySelector(".chat-panel-toggle");
  const content = panel.querySelector(".chat-panel-content");
  const label = panelKey === "community" ? "Community Chat" : "Teammates chat";

  panel.classList.toggle("is-minimized", minimized);
  panel.dataset.minimized = String(minimized);
  panel.setAttribute("aria-expanded", String(!minimized));

  if (content) {
    content.hidden = minimized;
  }

  if (btn) {
    btn.setAttribute("aria-label", minimized ? `Expand ${label}` : `Minimize ${label}`);
    btn.innerHTML = minimized
      ? '<i class="fa-solid fa-chevron-up"></i>'
      : '<i class="fa-solid fa-chevron-down"></i>';
  }

  chatPanelState[panelKey] = minimized;
}

function toggleChatPanel(panelKey) {
  const panel = panelKey === "community"
    ? document.getElementById("community-chat-box")
    : document.getElementById("teammate-chat-box");

  if (!panel) return;
  setChatPanelState(panelKey, !panel.classList.contains("is-minimized"));
}

document.querySelectorAll(".chat-panel-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const panelKey = btn.dataset.panel;
    if (panelKey === "community" || panelKey === "teammates") {
      toggleChatPanel(panelKey);
    }
  });
});

setChatPanelState("community", false);
setChatPanelState("teammates", false);

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
  if (postPrivacySelect) postPrivacySelect.value = normalizePrivacy(privacySettings.posts || "everyone");
  pendingFiles = [];
  pendingMediaType = "image";
  capturedPhotoDataUrl = null;
  postImagePreview.hidden = true;
  if (postPreviewVideo) { postPreviewVideo.hidden = true; postPreviewVideo.removeAttribute('src'); }
  if (cameraPreviewWrapper) cameraPreviewWrapper.hidden = true;
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

/** Sets the Create Post status box text/style, clearing any inline "tip" styling. */
function setPostModalStatus(text, type = "info") {
  if (!postModalStatus) return;
  postModalStatus.className = type === "info" ? "message" : `message ${type}`;
  postModalStatus.style.background = "";
  postModalStatus.style.color = "";
  postModalStatus.textContent = text;
}

if (createPostInput) createPostInput.addEventListener("click", openPostModal);
if (openPhotoBtn) openPhotoBtn.addEventListener("click", (e) => { e.preventDefault(); openPostModal(); postModalFile?.click(); });
if (postModalOverlay) postModalOverlay.addEventListener("click", closePostModal);
if (postModalClose) postModalClose.addEventListener("click", closePostModal);

function resetMediaPreview() {
  pendingFiles = [];
  pendingMediaType = "image";
  capturedPhotoDataUrl = null;
  if (postPreviewImg) postPreviewImg.removeAttribute('src');
  if (postPreviewVideo) {
    postPreviewVideo.pause();
    postPreviewVideo.removeAttribute('src');
    postPreviewVideo.hidden = true;
  }
  if (cameraPreviewWrapper) cameraPreviewWrapper.hidden = true;
  postImagePreview.hidden = true;
  if (postModalFile) postModalFile.value = "";
}

function showMediaPreview(file) {
  if (!file) return;
  pendingFiles = [file];
  pendingMediaType = file.type.startsWith('video/') ? 'video' : 'image';
  if (pendingMediaType === 'video') {
    const url = URL.createObjectURL(file);
    postPreviewVideo.src = url;
    postPreviewVideo.hidden = false;
    postPreviewVideo.load();
    postImagePreview.hidden = true;
    if (postPreviewImg) postPreviewImg.removeAttribute('src');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    postPreviewImg.src = ev.target.result;
    postImagePreview.hidden = false;
    if (postPreviewVideo) {
      postPreviewVideo.removeAttribute('src');
      postPreviewVideo.hidden = true;
    }
  };
  reader.readAsDataURL(file);
}

// ===== 30-SECOND VIDEO CAP (device uploads + recorded clips) =====
/** Read a video File's duration (in seconds) without fully decoding it. */
function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video file.'));
    };
  });
}

/**
 * Re-encode a video File down to only its first MAX_CLIP_SECONDS seconds using
 * <video>.captureStream() + MediaRecorder (no server-side transcoding needed).
 */
function trimVideoTo30Seconds(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!window.MediaRecorder) {
      reject(new Error("Your browser can't auto-trim video. Please choose a clip 30 seconds or shorter."));
      return;
    }

    const url = URL.createObjectURL(file);
    const videoEl = document.createElement('video');
    videoEl.src = url;
    videoEl.muted = true; // avoids autoplay-policy issues; captured stream still includes audio
    videoEl.playsInline = true;
    videoEl.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;";
    document.body.appendChild(videoEl);

    const cleanup = () => {
      videoEl.pause();
      videoEl.remove();
      URL.revokeObjectURL(url);
    };

    videoEl.onloadedmetadata = async () => {
      try {
        const captureFn = videoEl.captureStream?.bind(videoEl) || videoEl.mozCaptureStream?.bind(videoEl);
        if (!captureFn) {
          cleanup();
          reject(new Error("Your browser can't auto-trim video. Please choose a clip 30 seconds or shorter."));
          return;
        }

        const stream = captureFn();
        const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
          .find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks = [];
        recorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
        recorder.onerror = () => {
          cleanup();
          reject(new Error('Video trimming failed.'));
        };
        recorder.onstop = () => {
          cleanup();
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          resolve(new File([blob], `trimmed-${Date.now()}.webm`, { type: blob.type }));
        };

        onProgress?.(`✂️ Trimming to the first ${MAX_CLIP_SECONDS} seconds...`);
        recorder.start();
        await videoEl.play();

        const stopAt = Math.min(MAX_CLIP_SECONDS, videoEl.duration || MAX_CLIP_SECONDS);
        const checkProgress = () => {
          if (recorder.state === 'inactive') return;
          if (videoEl.currentTime >= stopAt) {
            recorder.stop();
            return;
          }
          requestAnimationFrame(checkProgress);
        };
        checkProgress();

        // Safety net in case the rAF loop stalls (e.g. backgrounded tab).
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, (stopAt + 2) * 1000);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    videoEl.onerror = () => {
      cleanup();
      reject(new Error('Could not read video file.'));
    };
  });
}

/** Returns the file unchanged if it's already <=30s, otherwise trims it down. */
async function ensureVideoWithin30Seconds(file, onProgress) {
  const duration = await getVideoDuration(file);
  if (!duration || !isFinite(duration) || duration <= MAX_CLIP_SECONDS + 0.25) {
    return file;
  }
  onProgress?.(`✂️ This video is ${Math.round(duration)}s long — trimming to the first ${MAX_CLIP_SECONDS} seconds...`);
  return trimVideoTo30Seconds(file, onProgress);
}

if (postModalFile) {
  postModalFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      if (file.size > 15 * 1024 * 1024) {
        setPostModalStatus("Image must be 15MB or less.", "error");
        return;
      }
      showMediaPreview(file);
      return;
    }

    if (file.size > 300 * 1024 * 1024) {
      setPostModalStatus("Video file is too large.", "error");
      return;
    }

    setPostModalStatus("⏳ Checking video length...");
    postModalSubmit.disabled = true;
    try {
      const finalFile = await ensureVideoWithin30Seconds(file, (msg) => setPostModalStatus(msg));
      setPostModalStatus("");
      showMediaPreview(finalFile);
    } catch (err) {
      console.error("Video trim error:", err);
      setPostModalStatus(err.message || "This video could not be processed.", "error");
    } finally {
      postModalSubmit.disabled = false;
    }
  });
}

if (removeImageBtn) {
  removeImageBtn.addEventListener("click", () => {
    resetMediaPreview();
  });
}

async function compressMedia(file) {
  if (!file) return file;
  if (file.type.startsWith('video/')) {
    return file;
  }
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(imageBitmap.width, imageBitmap.height));
  canvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
  canvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.8));
}

function generateThumbnail(file) {
  if (!file || !file.type.startsWith('video/')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const width = 320;
      const height = Math.round((video.videoHeight / video.videoWidth) * width);
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
    };
    video.onerror = () => resolve(null);
    video.src = URL.createObjectURL(file);
  });
}

async function uploadMedia(file) {
  if (!file) return null;
  const compressedFile = await compressMedia(file);
  const isVideo = file.type.startsWith('video/');
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Unsupported file type.');
  }

  const videoDurationPromise = isVideo ? new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  }) : Promise.resolve(0);
  const duration = await videoDurationPromise;
  if (isVideo && duration > 600) {
    throw new Error('Video must be 10 minutes or less.');
  }

  try {
    const fd = new FormData();
    fd.append("file", compressedFile || file);
    fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    postModalStatus.className = "message";
    postModalStatus.textContent = "Uploading media...";
    const xhr = new XMLHttpRequest();
    const uploadPromise = new Promise((resolve, reject) => {
      xhr.open('POST', CLOUDINARY_UPLOAD_URL, true);
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          postModalStatus.textContent = `Uploading media... ${percent}%`;
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            const url = data.secure_url || data.url;
            const thumbnailUrl = data.thumbnail_url || null;
            resolve({ url: url.startsWith("https://") ? url : "https://" + url.replace(/^http:\/\//i, ""), thumbnailUrl });
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(fd);
    });
    return await uploadPromise;
  } catch {}
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ url: reader.result, thumbnailUrl: null });
    reader.readAsDataURL(compressedFile || file);
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
      let mediaUrl = null;
      let thumbnailUrl = null;
      if (pendingFiles.length > 0) {
        const uploadResult = await uploadMedia(pendingFiles[0]);
        mediaUrl = uploadResult?.url || null;
        thumbnailUrl = uploadResult?.thumbnailUrl || null;
      }

      const { cleanText: parsedText, taggedIds } = parseMentions(text);

      await addDoc(collection(db, "posts"), {
        authorId: currentUser.uid,
        authorName: currentUserName,
        authorAvatar: currentUserAvatar,
        text: parsedText,
        rawText: text,
        taggedUserIds: taggedIds,
        interest: postModalInterest.value,
        mediaUrl: mediaUrl || null,
        imageUrl: mediaUrl || null,
        thumbnailUrl,
        mediaType: pendingMediaType,
        privacy: normalizePrivacy(postPrivacySelect?.value || "everyone"),
        likes: [],
        comments: [],
        impressions: 0,
        createdAt: serverTimestamp()
      });

      closePostModal();
      resetMediaPreview();
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

// ===== LIVE VIDEO =====
async function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (cameraPreview) {
    cameraPreview.srcObject = null;
  }
}

async function openCamera() {
  if (!cameraPreviewWrapper || !cameraPreview) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    cameraPreview.srcObject = cameraStream;
    cameraPreviewWrapper.hidden = false;
    postImagePreview.hidden = true;
  } catch (err) {
    postModalStatus.className = "message error";
    postModalStatus.textContent = "Camera access was denied or unavailable.";
  }
}

if (openCameraBtn) openCameraBtn.addEventListener("click", openCamera);
if (capturePhotoBtn) capturePhotoBtn.addEventListener("click", () => {
  if (!cameraPreview || !cameraPreview.videoWidth) return;
  const canvas = document.getElementById("cameraCaptureCanvas");
  const ctx = canvas.getContext('2d');
  canvas.width = cameraPreview.videoWidth;
  canvas.height = cameraPreview.videoHeight;
  ctx.drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
  capturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  postPreviewImg.src = capturedPhotoDataUrl;
  postImagePreview.hidden = false;
  cameraPreviewWrapper.hidden = true;
  if (postPreviewVideo) {
    postPreviewVideo.removeAttribute('src');
    postPreviewVideo.hidden = true;
  }
  pendingFiles = [dataURLToFile(capturedPhotoDataUrl, 'captured-photo.jpg')];
  pendingMediaType = 'image';
  stopCameraStream();
});
if (retakePhotoBtn) retakePhotoBtn.addEventListener("click", () => { capturedPhotoDataUrl = null; openCamera(); });
if (uploadPhotoBtn) uploadPhotoBtn.addEventListener("click", () => { if (capturedPhotoDataUrl) { postPreviewImg.src = capturedPhotoDataUrl; postImagePreview.hidden = false; cameraPreviewWrapper.hidden = true; } });

function dataURLToFile(dataUrl, filename) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) { u8arr[n] = bstr.charCodeAt(n); }
  return new File([u8arr], filename, { type: mime });
}

function openLiveVideoModal() {
  if (!liveVideoModal) return;
  if (!currentUser) {
    document.getElementById("authModal")?.classList.add("auth-modal--open");
    return;
  }
  liveVideoModal.hidden = false;
  liveVideoStatus.textContent = `Record a short clip — up to ${MAX_CLIP_SECONDS} seconds.`;
  liveVideoBadge.hidden = true;
  if (liveViewerCount) liveViewerCount.textContent = "";
  liveVideoTimer.textContent = "⏱ 00:00";
  liveVideoEndBtn.hidden = true;
  liveVideoStartBtn.hidden = false;
  liveVideoStartBtn.disabled = true;
  liveVideoStartBtn.textContent = "Starting camera...";
  requestLiveCamera();
}

async function requestLiveCamera() {
  try {
    liveCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    liveVideoPreview.srcObject = liveCameraStream;
    liveVideoStartBtn.disabled = false;
    liveVideoStartBtn.textContent = "🔴 Start Recording";
  } catch (err) {
    liveVideoStatus.className = "message error";
    liveVideoStatus.textContent = "Camera/microphone access was denied or unavailable.";
    liveVideoStartBtn.disabled = true;
    liveVideoStartBtn.textContent = "🔴 Start Recording";
  }
}

function stopLiveCameraStream() {
  if (liveCameraStream) {
    liveCameraStream.getTracks().forEach((track) => track.stop());
    liveCameraStream = null;
  }
  if (liveVideoPreview) liveVideoPreview.srcObject = null;
}

function closeLiveVideoModal() {
  if (liveStreamActive) {
    // Stop recording without posting if the user closes the modal mid-recording.
    if (liveRecorder && liveRecorder.state !== 'inactive') {
      liveRecorder.onstop = null;
      liveRecorder.stop();
    }
    clearInterval(liveStreamTimer);
    liveStreamTimer = null;
    liveStreamActive = false;
    if (currentLiveStreamId) {
      endLiveStream(currentLiveStreamId);
      currentLiveStreamId = null;
    }
  }
  liveRecorder = null;
  stopLiveCameraStream();
  if (liveVideoModal) liveVideoModal.hidden = true;
}

function updateLiveTimer() {
  if (!liveStreamActive || !liveStreamStartTime) return;
  const elapsed = Math.floor((Date.now() - liveStreamStartTime) / 1000);
  const seconds = elapsed % 60;
  const minutes = Math.floor(elapsed / 60);
  liveVideoTimer.textContent = `⏱ ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  if (elapsed >= MAX_CLIP_SECONDS) {
    endLiveVideo();
  }
}

async function startLiveVideo() {
  if (liveStreamActive || !liveCameraStream) return;
  liveStreamActive = true;
  liveStreamStartTime = Date.now();
  liveVideoBadge.hidden = false;
  liveVideoStatus.className = "message";
  liveVideoStatus.textContent = `🔴 Recording... stops automatically at ${MAX_CLIP_SECONDS} seconds.`;
  liveVideoStartBtn.hidden = true;
  liveVideoEndBtn.hidden = false;
  liveStreamTimer = setInterval(updateLiveTimer, 1000);

  liveRecordedChunks = [];
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  liveRecorder = new MediaRecorder(liveCameraStream, mimeType ? { mimeType } : undefined);
  liveRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) liveRecordedChunks.push(ev.data); };
  liveRecorder.start();

  currentLiveStreamId = await startLiveStream(currentUser?.uid || "", {
    title: "Community live clip",
    privacy: normalizePrivacy(privacySettings.videos || "everyone")
  });
}

async function endLiveVideo() {
  if (!liveStreamActive) return;
  liveStreamActive = false;
  clearInterval(liveStreamTimer);
  liveStreamTimer = null;
  liveStreamStartTime = null;
  liveVideoBadge.hidden = true;
  liveVideoTimer.textContent = "⏱ 00:00";
  liveVideoEndBtn.hidden = true;
  liveVideoStartBtn.hidden = false;
  liveVideoStatus.textContent = "⏳ Preparing your clip...";

  if (currentLiveStreamId) {
    await endLiveStream(currentLiveStreamId);
    currentLiveStreamId = null;
  }

  const recorder = liveRecorder;
  liveRecorder = null;
  stopLiveCameraStream();

  if (!recorder) {
    closeLiveVideoModal();
    return;
  }

  const clipFile = await new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(liveRecordedChunks, { type: recorder.mimeType || 'video/webm' });
      resolve(new File([blob], `live-clip-${Date.now()}.webm`, { type: blob.type }));
    };
    if (recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      resolve(null);
    }
  });

  if (!clipFile) {
    liveVideoStatus.className = "message error";
    liveVideoStatus.textContent = "Recording could not be saved.";
    return;
  }

  if (liveVideoModal) liveVideoModal.hidden = true;

  // Hand the recorded clip straight to the Create Post flow, exactly like a
  // device gallery upload — same preview, caption, and posting pipeline.
  openPostModal();
  showMediaPreview(clipFile);
  setPostModalStatus(`🎬 Your ${MAX_CLIP_SECONDS}-second clip is ready — add a caption and post!`, "success");
}

if (openVideoBtn) openVideoBtn.addEventListener("click", openLiveVideoModal);
if (liveVideoOverlay) liveVideoOverlay.addEventListener("click", closeLiveVideoModal);
if (liveVideoClose) liveVideoClose.addEventListener("click", closeLiveVideoModal);
if (liveVideoStartBtn) liveVideoStartBtn.addEventListener("click", startLiveVideo);
if (liveVideoEndBtn) liveVideoEndBtn.addEventListener("click", endLiveVideo);

// Read-only fetch of the user's saved default post-privacy preference
// (used to prefill the per-post privacy selector in the Create Post modal).
// The full Privacy Settings UI now lives on the Dashboard page.
async function loadPrivacySettings() {
  if (!currentUser?.uid) return;
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists()) {
      const data = snap.data();
      privacySettings = { ...privacySettings, ...data };
      privacySettings.posts = normalizePrivacy(privacySettings.posts || 'everyone');
      if (postPrivacySelect) postPrivacySelect.value = privacySettings.posts || 'everyone';
    }
  } catch (err) {
    console.warn('Could not load privacy settings:', err);
  }
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
  card.dataset.postId = post.id;
  card.dataset.authorId = post.authorId || "";
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
  const isOwner = !!currentUser && (post.authorId === currentUser.uid);

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
        <div class="post-hp-badge-placeholder" data-author-id="${post.authorId || ""}"></div>
      </div>
      <div class="fb-post-options" style="display:flex;align-items:center;gap:8px;">
        <span aria-hidden="true">•••</span>
        ${isOwner ? '<button class="fb-delete-post-btn" type="button" aria-label="Delete post" title="Delete post" style="background:rgba(239,68,68,0.12);color:#fca5a5;border:1px solid rgba(239,68,68,0.35);border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;">Delete</button>' : ''}
      </div>
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
    img.crossOrigin = "anonymous";
    img.alt = "Post image";
    img.loading = "lazy";
    img.style.cssText = "cursor:pointer;";
    img.onclick = () => window.open(post.imageUrl, '_blank');
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);
  }

  // Stats bar — clean: likes, comments, views (NO HP indicators)
  const impressionCount = post.impressions || 0;
  const statsBar = document.createElement("div");
  statsBar.className = "fb-post-stats";
  statsBar.innerHTML = `
    <span>👍 ${likeCount}</span>
    <span>💬 ${commentCount} comments</span>
    <span>👁️ ${formatImpressionCount(impressionCount)} views</span>
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
    <button class="fb-action-btn" data-action="report">
      🚩 <span>Report</span>
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

  const deleteBtn = card.querySelector('.fb-delete-post-btn');
  deleteBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUser || post.authorId !== currentUser.uid) return;
    const confirmed = window.confirm('Delete this post? This cannot be undone.');
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'posts', post.id));
    } catch (err) {
      console.error('Delete post failed:', err);
      alert('Unable to delete this post right now.');
    }
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
          createNotification(post.authorId, 'like', `${currentUserName} liked your post`, { postId: post.id });
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

  // Share handler — opens the rich share modal with WhatsApp, X, Facebook, Telegram links
  const shareBtn = actions.querySelector('[data-action="share"]');
  shareBtn.addEventListener("click", () => {
    if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
    openShareModal(post);
  });

  const reportBtn = actions.querySelector('[data-action="report"]');
  reportBtn?.addEventListener("click", async () => {
    if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
    const allowed = await checkRateLimit("report", currentUser.uid, 60 * 1000, 3);
    if (!allowed) {
      alert("Slow down. Please wait a moment before reporting again.");
      return;
    }
    const reason = window.prompt("Why are you reporting this post?", "Spam or abuse");
    if (!reason) return;
    const reportId = await createReport({
      reporterId: currentUser.uid,
      targetType: "post",
      targetId: post.id,
      reason,
      details: { authorId: post.authorId || null },
      targetUserId: post.authorId || null
    });
    if (reportId) {
      alert("✅ Report submitted for review.");
    } else {
      alert("Unable to submit report right now.");
    }
  });

  // Comment submit
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
        createNotification(post.authorId, 'comment', `${currentUserName} commented on your post: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`, { postId: post.id });
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

// ===== IMPRESSION COUNT FORMATTING =====
function formatImpressionCount(count) {
  if (!count && count !== 0) return "0";
  const num = typeof count === 'number' ? count : parseInt(count, 10) || 0;
  if (num === 0) return "0";
  if (num < 1000) return num.toString();
  if (num < 1000000) {
    const val = (num / 1000).toFixed(1);
    return val.endsWith('.0') ? val.slice(0, -2) + 'k' : val + 'k';
  }
  const val = (num / 1000000).toFixed(1);
  return val.endsWith('.0') ? val.slice(0, -2) + 'M' : val + 'M';
}

// ===== TRACK POST IMPRESSION (deduplicated per session) =====
const trackedImpressions = new Set();

async function trackPostImpression(postId, authorId) {
  if (!postId || trackedImpressions.has(postId)) return;
  trackedImpressions.add(postId);
  try {
    // Increment the impression counter on the post
    const ref = doc(db, "posts", postId);
    await updateDoc(ref, { impressions: increment(1) });

    // Credit HP to the post creator: 0.1 HP per 1,000 impressions = 0.0001 per impression
    if (authorId && authorId !== (currentUser?.uid || "local_user")) {
      const earnedHP = 0.0001;
      await updateDoc(doc(db, "users", authorId), {
        hopePoints: increment(earnedHP)
      });
      // Invalidate cache so the creator's HP badge refreshes
      invalidateHPCache(authorId);
      delete hpBadgeCache[authorId];
    }
  } catch (err) {
    // Silently fail — impressions are non-critical
    console.debug("Impression track failed for", postId, err);
  }
}

// ===== SHARE MODAL =====
function openShareModal(post) {
  // Remove existing share modal if any
  const oldModal = document.getElementById('sharePostModal');
  if (oldModal) oldModal.remove();

  const pageUrl = window.location.href.split('?')[0].split('#')[0];
  const postUrl = `${pageUrl}?post=${encodeURIComponent(post.id)}`;
  const text = encodeURIComponent(post.rawText || post.text || "Check out this post on GFHF!");
  const shareTitle = encodeURIComponent("Global Football Hope Fund");

  const modal = document.createElement('div');
  modal.id = 'sharePostModal';
  modal.className = 'fb-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fb-modal-overlay" id="shareModalOverlay"></div>
    <div class="fb-modal-card share-modal-card">
      <div class="fb-modal-header">
        <h3><i class="fas fa-share-alt" style="margin-right:8px;"></i> Share Post</h3>
        <button class="fb-modal-close" id="shareModalClose">&times;</button>
      </div>
      <div class="share-modal-body">
        <p style="color:#64748b;font-size:14px;margin-bottom:16px;">Share this post with your friends and followers!</p>
        <div class="share-buttons-grid">
          <a href="https://wa.me/?text=${encodeURIComponent(postUrl + ' - ' + (post.rawText || post.text || ''))}" target="_blank" rel="noopener noreferrer" class="share-btn share-btn-whatsapp">
            <i class="fab fa-whatsapp"></i>
            <span>WhatsApp</span>
          </a>
          <a href="https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(postUrl)}" target="_blank" rel="noopener noreferrer" class="share-btn share-btn-x">
            <i class="fab fa-x-twitter"></i>
            <span>X / Twitter</span>
          </a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}" target="_blank" rel="noopener noreferrer" class="share-btn share-btn-facebook">
            <i class="fab fa-facebook"></i>
            <span>Facebook</span>
          </a>
          <a href="https://t.me/share/url?url=${encodeURIComponent(postUrl)}&text=${text}" target="_blank" rel="noopener noreferrer" class="share-btn share-btn-telegram">
            <i class="fab fa-telegram"></i>
            <span>Telegram</span>
          </a>
        </div>
        <div class="share-link-copy">
          <input type="text" id="shareLinkInput" value="${postUrl}" readonly>
          <button id="copyLinkBtn" class="btn"><i class="fas fa-copy"></i> Copy</button>
        </div>
        <div id="copyToast" class="copy-toast" style="display:none;">✅ Link copied!</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close handlers
  document.getElementById('shareModalClose').addEventListener('click', () => modal.remove());
  document.getElementById('shareModalOverlay').addEventListener('click', () => modal.remove());

  // Copy link with toast
  document.getElementById('copyLinkBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      const toast = document.getElementById('copyToast');
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 2500);
    } catch {
      // Fallback
      const input = document.getElementById('shareLinkInput');
      input.select();
      document.execCommand('copy');
      const toast = document.getElementById('copyToast');
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 2500);
    }
  });
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ===== HP BADGE RESOLVER =====
// Cache HP values per user ID to avoid repeated Firestore reads
const hpBadgeCache = {};

/**
 * Fetch and render HP badge into a placeholder element.
 * @param {string} uid - User ID
 * @param {HTMLElement} placeholderEl - The placeholder element to inject badge HTML into
 */
async function resolveHPBadge(uid, placeholderEl) {
  if (!uid || !placeholderEl) return;
  
  // Check cache
  if (hpBadgeCache[uid] !== undefined) {
    placeholderEl.innerHTML = getHPBadgeHTML(hpBadgeCache[uid]);
    return;
  }
  
  // Fetch from Firestore
  const hp = await getUserHP(uid);
  hpBadgeCache[uid] = hp;
  placeholderEl.innerHTML = getHPBadgeHTML(hp);
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
    // Resolve HP badges for all post cards
    feed.querySelectorAll('.post-hp-badge-placeholder').forEach(el => {
      const authorId = el.dataset.authorId;
      resolveHPBadge(authorId, el);
    });
    // Set up IntersectionObserver to track post impressions + HP rewards
    const impressionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const postId = card.dataset.postId;
          const authorId = card.dataset.authorId;
          if (postId) {
            trackPostImpression(postId, authorId);
          }
          impressionObserver.unobserve(card);
        }
      });
    }, { rootMargin: '0px 0px 100px 0px' });
    feed.querySelectorAll('.fb-post-card').forEach(card => {
      impressionObserver.observe(card);
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

// ===== NOTIFICATION DEEP LINKS (?post=, ?chat=) =====
/**
 * When a user arrives here from a clicked notification (community.html?post=ID
 * or ?chat=UID), scroll to that post / open that chat thread automatically.
 */
function handleNotificationDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get("post");
  const chatPartnerId = params.get("chat");

  if (postId) {
    let attempts = 0;
    const tryScrollToPost = () => {
      const card = document.querySelector(`.fb-post-card[data-post-id="${postId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("fb-post-card-highlight");
        setTimeout(() => card.classList.remove("fb-post-card-highlight"), 2500);
      } else if (attempts < 15) {
        attempts++;
        setTimeout(tryScrollToPost, 300);
      }
    };
    tryScrollToPost();
  }

  if (chatPartnerId) {
    openChatFromDeepLink(chatPartnerId);
  }
}

async function openChatFromDeepLink(partnerId) {
  if (!partnerId) return;
  let partnerName = "Teammate";
  try {
    const snap = await getDoc(doc(db, "users", partnerId));
    if (snap.exists()) {
      partnerName = snap.data().displayName || snap.data().firstName || "Teammate";
    }
  } catch (err) {
    console.warn("Could not resolve chat partner name:", err);
  }
  openFloatingChat(partnerId, partnerName);
}

// ===== CLOUDINARY CHAT IMAGE UPLOAD =====
/**
 * Reusable function: upload an image to Cloudinary, then save a chat message
 * with the image URL to the specified Firestore collection.
 * @param {File} file - The image file to upload
 * @param {string} collectionPath - Firestore collection path (e.g., "communityChat" or "liveChats/chatKey/messages")
 * @param {object} extraData - Additional data to include in the message doc
 */
async function uploadAndSendChatImage(file, collectionPath, extraData = {}) {
  if (!currentUser || !file) return;

  // Upload to Cloudinary
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  try {
    const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: 'POST', body: formData });
    const data = await res.json();

    // DEBUG LOG: See every key returned
    console.log("Cloudinary full object:", data);

    // Safe extraction check (handles secure_url, url, or nested data)
    const imageUrl = data.secure_url || data.url || (data.data && data.data.secure_url);

    if (!imageUrl) {
      console.error("No valid URL returned from Cloudinary!", data);
      alert("Upload failed: Could not retrieve image URL from Cloudinary.");
      return;
    }

    console.log("Extracted Image URL successfully:", imageUrl);

    // Save message to Firestore — ONLY if imageUrl exists (prevents empty docs)
    try {
      const msgData = {
        userId: currentUser.uid,
        senderId: currentUser.uid,
        username: currentUser.displayName || "User",
        senderName: currentUser.displayName || "User",
        text: "",
        imageUrl: imageUrl,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        ...extraData
      };

      console.log("Saved image message to Firestore:", imageUrl);

      // If it's a subcollection path (contains /), parse it
      if (collectionPath.includes('/')) {
        const parts = collectionPath.split('/');
        let ref = db;
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) {
            ref = collection(ref, parts[i]);
          } else {
            ref = doc(ref, parts[i]);
          }
        }
        await addDoc(ref, msgData);
      } else {
        await addDoc(collection(db, collectionPath), msgData);
      }

    } catch (err) {
      console.error('Chat image save failed:', err);
    }
  } catch (err) {
    console.error('Chat image upload failed:', err);
    return;
  }
}

// ===== COMMUNITY CHAT =====
if (communityChatForm) {
  // Add hidden file input for image upload
  const communityFileInput = document.createElement('input');
  communityFileInput.type = 'file';
  communityFileInput.accept = 'image/*';
  communityFileInput.style.display = 'none';
  communityFileInput.id = 'communityChatFileInput';
  communityChatForm.appendChild(communityFileInput);

  // Add camera icon button next to the Send button
  const communityCameraBtn = document.createElement('button');
  communityCameraBtn.type = 'button';
  communityCameraBtn.className = 'chat-camera-btn';
  communityCameraBtn.textContent = '📷';
  communityCameraBtn.title = 'Upload image';
  communityCameraBtn.style.cssText = 'padding:8px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:50%;font-size:18px;cursor:pointer;transition:background 0.2s;line-height:1;';
  // Insert before the send button
  const communitySendBtn = communityChatForm.querySelector('.btn');
  if (communitySendBtn) {
    communityChatForm.insertBefore(communityCameraBtn, communitySendBtn);
  } else {
    communityChatForm.appendChild(communityCameraBtn);
  }

  communityCameraBtn.addEventListener('click', () => communityFileInput.click());

  communityFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    communityCameraBtn.disabled = true;
    communityCameraBtn.textContent = '⏳';
    await uploadAndSendChatImage(file, 'community_chats');
    communityCameraBtn.disabled = false;
    communityCameraBtn.textContent = '📷';
    communityFileInput.value = '';
  });

  communityChatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const input = communityChatForm.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await addDoc(collection(db, "community_chats"), {
        authorId: currentUser.uid, authorName: currentUserName, authorAvatar: currentUserAvatar, text, createdAt: serverTimestamp()
      });
      input.value = "";
    } catch (err) { console.error(err); }
  });
}

function listenToChat() {
  const q = query(collection(db, "community_chats"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snap) => {
    if (!communityChatList) return;
    communityChatList.innerHTML = "";
    snap.docs.forEach(async (d) => {
      const m = d.data();
      // Skip message if both text and imageUrl are empty/falsy (prevents empty bubbles)
      if (!m.text && !m.imageUrl) return;
      const item = document.createElement("div"); item.className = "chat-message";
      // Support both field naming conventions (userId/authorId, username/authorName, timestamp/createdAt)
      const authorId = m.userId || m.authorId || "";
      const authorName = m.username || m.authorName || "Guest";
      const authorAvatar = m.authorAvatar || "👤";
      const timestamp = m.timestamp || m.createdAt;
      const timeDisplay = timestamp?.toMillis ? timeAgo(timestamp.toMillis()) : (timestamp ? timeAgo(timestamp) : "");
      let imageHtml = '';
      if (m.imageUrl && typeof m.imageUrl === 'string' && m.imageUrl.trim() !== '') {
        imageHtml = `<img src="${m.imageUrl}" crossorigin="anonymous" class="chat-shared-image" style="max-width:200px; max-height:200px; border-radius:8px; display:block; margin-top:5px; cursor:pointer;" onclick="window.open('${m.imageUrl}', '_blank')" />`;
      }
      const textHtml = m.text ? `<div class="chat-text">${m.text}</div>` : '';
      const authorProfileLink = `profile.html?uid=${encodeURIComponent(authorId)}`;
      const authorLinkHtml = authorId
        ? `<a href="${authorProfileLink}" style="text-decoration:none;color:inherit;">${escapeHtml(authorAvatar)} ${escapeHtml(authorName)}</a>`
        : `${escapeHtml(authorAvatar)} ${escapeHtml(authorName)}`;
      item.innerHTML = `<div class="chat-author">${authorLinkHtml}<div class="chat-hp-placeholder" data-author-id="${authorId}"></div></div>${imageHtml}${textHtml}<div class="chat-time">${timeDisplay}</div>`;
      communityChatList.appendChild(item);
    });
    // Resolve HP badges for chat messages
    communityChatList.querySelectorAll('.chat-hp-placeholder').forEach(async (el) => {
      const authorId = el.dataset.authorId;
      if (authorId) {
        const hp = await getUserHP(authorId);
        el.innerHTML = getHPBadgeHTML(hp);
      }
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
      const authorId = msg.authorId || msg.userId || "";
      const isOwn = authorId === currentUser?.uid;
      const bubble = document.createElement("div");
      bubble.style.cssText = `padding:8px 12px;margin:4px 8px;border-radius:${isOwn ? '16px 4px 16px 16px' : '4px 16px 16px 16px'};background:${isOwn ? '#0b2d4d' : '#eef4f8'};color:${isOwn ? 'white' : '#0b2d4d'};max-width:80%;align-self:${isOwn ? 'flex-end' : 'flex-start'};font-size:14px;display:flex;flex-direction:column;gap:4px;`;
      // Clickable sender name/avatar — mirrors the profile link on the main feed
      if (!isOwn && authorId) {
        const nameLink = document.createElement("a");
        nameLink.href = `profile.html?uid=${encodeURIComponent(authorId)}`;
        nameLink.style.cssText = "font-weight:700;font-size:12px;text-decoration:none;color:inherit;opacity:0.85;";
        nameLink.textContent = msg.authorName || activeFloatingChatPartnerName || "Teammate";
        bubble.appendChild(nameLink);
      }
      // Add text content if present
      if (msg.text) {
        const textEl = document.createElement('span');
        textEl.textContent = msg.text;
        bubble.appendChild(textEl);
      }
      // Add image content if present and non-empty
      if (msg.imageUrl && typeof msg.imageUrl === 'string' && msg.imageUrl.trim() !== '') {
        const img = document.createElement('img');
        img.className = 'chat-shared-image';
        // Enforce HTTPS for image src
        const imgUrl = msg.imageUrl.startsWith("https://") ? msg.imageUrl : "https://" + msg.imageUrl.replace(/^http:\/\//i, "");
        img.src = imgUrl;
        img.crossOrigin = 'anonymous';
        img.onclick = () => window.open(imgUrl, '_blank');
        img.alt = 'Shared image';
        bubble.appendChild(img);
      }
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
  // Add camera button for image upload in floating chat
  const floatingFileInput = document.createElement('input');
  floatingFileInput.type = 'file';
  floatingFileInput.accept = 'image/*';
  floatingFileInput.style.display = 'none';
  floatingFileInput.id = 'floatingChatFileInput';
  floatingChatForm.appendChild(floatingFileInput);

  const floatingCameraBtn = document.createElement('button');
  floatingCameraBtn.type = 'button';
  floatingCameraBtn.className = 'chat-camera-btn';
  floatingCameraBtn.textContent = '📷';
  floatingCameraBtn.title = 'Upload image';
  floatingCameraBtn.style.cssText = 'padding:6px 8px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:50%;font-size:16px;cursor:pointer;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;line-height:1;';
  const floatingSendBtn = floatingChatForm.querySelector('.floating-chat-send-btn');
  if (floatingSendBtn) {
    floatingChatForm.insertBefore(floatingCameraBtn, floatingSendBtn);
  } else {
    floatingChatForm.appendChild(floatingCameraBtn);
  }

  floatingCameraBtn.addEventListener('click', () => floatingFileInput.click());

  floatingFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!activeFloatingChatPartnerId || !currentUser) return;
    const chatKey = [currentUser.uid, activeFloatingChatPartnerId].sort().join("_");
    floatingCameraBtn.disabled = true;
    floatingCameraBtn.textContent = '⏳';
    await uploadAndSendChatImage(file, `liveChats/${chatKey}/messages`);
    floatingCameraBtn.disabled = false;
    floatingCameraBtn.textContent = '📷';
    floatingFileInput.value = '';
  });

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
        createNotification(activeFloatingChatPartnerId, 'message', `${currentUserName} sent you a message: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`, { senderId: currentUser.uid });
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
onAuthStateChanged(auth, async (user) => {
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
  await loadPrivacySettings();
  handleNotificationDeepLink();
});

window.addEventListener("load", hideAppSplash);

// ===== MOBILE SIDEBAR TOGGLE =====
const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
const floatingSidebar = document.getElementById("floating-chat-sidebar");

if (sidebarToggleBtn && floatingSidebar) {
  sidebarToggleBtn.addEventListener("click", () => {
    const isHidden = floatingSidebar.hasAttribute("hidden");
    if (isHidden) {
      floatingSidebar.removeAttribute("hidden");
      sidebarToggleBtn.classList.add("active");
      sidebarToggleBtn.textContent = "✕ Close Sidebar";
    } else {
      floatingSidebar.setAttribute("hidden", "");
      sidebarToggleBtn.classList.remove("active");
      sidebarToggleBtn.textContent = "☰ Sidebar";
    }
  });

  // On window resize >= 768px, ensure sidebar is visible and button hidden
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      floatingSidebar.removeAttribute("hidden");
      sidebarToggleBtn.classList.remove("active");
      sidebarToggleBtn.textContent = "☰ Sidebar";
    }
  });
}

// ===== WALLET: ADD FUND WALLET BUTTON TO SIDEBAR =====
(function initCommunityWallet() {
  // Inject "Fund Wallet" button into the teammate-chat-box header actions
  const teammateChatBox = document.getElementById("teammate-chat-box");
  if (teammateChatBox) {
    const actions = teammateChatBox.querySelector(".chat-panel-actions");
    if (actions) {
      const walletBtn = document.createElement("button");
      walletBtn.className = "mini-btn fund-wallet-trigger-btn";
      walletBtn.type = "button";
      walletBtn.textContent = "💰 Fund Wallet";
      walletBtn.style.cssText = "padding:4px 12px;font-size:11px;background:#00c853;color:white;border:none;border-radius:999px;font-weight:700;cursor:pointer;";
      actions.appendChild(walletBtn);
    }
  }

  // Show wallet balance in the sidebar when user is logged in
  async function renderSidebarWalletBalance() {
    if (!currentUser) return;
    // Add wallet balance display below teammates list if not exists
    const teammatesContainer = document.getElementById("teammatesList");
    if (!teammatesContainer) return;

    // Check if wallet balance element already exists
    let balanceEl = document.getElementById("communityWalletBalance");
    if (!balanceEl) {
      balanceEl = document.createElement("div");
      balanceEl.id = "communityWalletBalance";
      balanceEl.style.cssText = "padding:8px 12px;margin:6px 0;background:linear-gradient(135deg,#0b2d4d,#123f63);color:white;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;";
      teammatesContainer.parentNode.insertBefore(balanceEl, teammatesContainer);
    }

    const balance = await loadWalletBalance(currentUser.uid);
    balanceEl.innerHTML = `
      <span>💰 Wallet: <strong>${formatCurrency(balance)}</strong></span>
      <button class="fund-wallet-trigger-btn" type="button" style="padding:4px 10px;background:#00c853;color:white;border:none;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">➕ Top Up</button>
    `;
  }

  // Listen to auth changes for wallet balance display
  const origAuthHandler = window._communityAuthPatched;
  if (!origAuthHandler) {
    window._communityAuthPatched = true;
    onAuthStateChanged(auth, (user) => {
      if (user) {
        renderSidebarWalletBalance();
      } else {
        const balanceEl = document.getElementById("communityWalletBalance");
        if (balanceEl) balanceEl.remove();
      }
    });
  }
})();

// ===== INIT =====
renderStories();
loadFeed();
listenToChat();
renderMembers();
renderFriendRequests();
loadUserDirectory(); // Load @mention directory

// Initialize the Fund Wallet modal (must be called after modal HTML is in DOM)
document.addEventListener('DOMContentLoaded', () => {
  // The modal HTML is already in community.html from dashboard, but if not, inject it
  if (!document.getElementById('fundWalletModal')) {
    const modalHTML = getFundWalletModalHTML();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }
  initFundWalletModal();
});

