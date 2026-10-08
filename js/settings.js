import { auth, db } from "./firebase.js";
import { onAuthStateChanged, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizePrivacy } from "./privacy.js";

const settingsForm = document.getElementById("settingsForm");
const authMessage = document.getElementById("settingsAuthMessage");
const toast = document.getElementById("settingsToast");
const avatarUrlInput = document.getElementById("settingsAvatarUrl");
const avatarPreview = document.getElementById("settingsAvatarPreview");
const avatarPlaceholder = document.getElementById("settingsAvatarPlaceholder");
const PRIVACY_FIELDS = {
  accountTypeSelect: "accountType",
  postsPrivacySelect: "posts",
  photosPrivacySelect: "photos",
  videosPrivacySelect: "videos",
  predictionPrivacySelect: "predictionHistory",
  onlinePrivacySelect: "onlineStatus",
  lastActivePrivacySelect: "lastActive",
  profilePrivacySelect: "profile"
};

let currentUser = null;
let toastTimer = null;

function showToast(message, type = "success") {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `settings-toast is-visible ${type}`;
  toastTimer = window.setTimeout(() => {
    toast.className = "settings-toast";
  }, 3600);
}

function setAvatarPreview(url) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    avatarPreview.hidden = true;
    avatarPreview.removeAttribute("src");
    avatarPlaceholder.hidden = false;
    return;
  }
  avatarPreview.src = trimmedUrl;
}

function getFavoriteLeagues() {
  return [...document.querySelectorAll('input[name="favoriteLeague"]:checked')]
    .map((input) => input.value);
}

async function loadSettings(user) {
  const snapshot = await getDoc(doc(db, "users", user.uid));
  const profile = snapshot.exists() ? snapshot.data() : {};
  const settings = profile.settings || {};
  const notifications = settings.notificationPreferences || {};

  Object.entries(PRIVACY_FIELDS).forEach(([elementId, field]) => {
    const input = document.getElementById(elementId);
    if (!input) return;
    input.value = field === "accountType"
      ? (profile.accountType === "private" ? "private" : "public")
      : normalizePrivacy(profile[field]);
  });

  document.getElementById("kickoffAlerts").checked = notifications.kickoffAlerts !== false;
  document.getElementById("settlementNotifications").checked = notifications.settlementNotifications !== false;
  document.getElementById("settingsDisplayName").value = profile.displayName || user.displayName || "";
  avatarUrlInput.value = profile.photoURL || user.photoURL || "";
  setAvatarPreview(avatarUrlInput.value);

  const favoriteLeagues = new Set(profile.favoriteLeagues || settings.favoriteLeagues || []);
  document.querySelectorAll('input[name="favoriteLeague"]').forEach((input) => {
    input.checked = favoriteLeagues.has(input.value);
  });
}

async function savePrivacySettings() {
  const updates = {};
  Object.entries(PRIVACY_FIELDS).forEach(([elementId, field]) => {
    const input = document.getElementById(elementId);
    updates[field] = field === "accountType" ? input.value : normalizePrivacy(input.value);
  });
  await setDoc(doc(db, "users", currentUser.uid), {
    ...updates,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveNotificationPreferences() {
  await setDoc(doc(db, "users", currentUser.uid), {
    settings: {
      notificationPreferences: {
        kickoffAlerts: document.getElementById("kickoffAlerts").checked,
        settlementNotifications: document.getElementById("settlementNotifications").checked
      }
    },
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveProfileCustomization() {
  const displayName = document.getElementById("settingsDisplayName").value.trim();
  const photoURL = avatarUrlInput.value.trim();
  if (!displayName) throw new Error("Enter a display name before saving.");

  if (photoURL) {
    let parsedUrl;
    try {
      parsedUrl = new URL(photoURL);
    } catch {
      throw new Error("Enter a valid avatar URL.");
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Avatar URL must use HTTPS.");
    }
  }

  await updateProfile(currentUser, { displayName, photoURL });
  await setDoc(doc(db, "users", currentUser.uid), {
    displayName,
    photoURL,
    favoriteLeagues: getFavoriteLeagues(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveSection(section) {
  if (!currentUser) {
    showToast("Sign in to save your settings.", "error");
    return;
  }

  const button = document.querySelector(`[data-save="${section}"]`);
  if (button) button.disabled = true;
  try {
    if (section === "privacy") await savePrivacySettings();
    else if (section === "notifications") await saveNotificationPreferences();
    else if (section === "profile") await saveProfileCustomization();
    showToast("Settings saved successfully.");
  } catch (error) {
    console.error("Could not save settings:", error);
    showToast(error.message || "Could not save settings. Please try again.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function exportAccountData() {
  if (!currentUser) return showToast("Sign in to export your account data.", "error");
  try {
    const snapshot = await getDoc(doc(db, "users", currentUser.uid));
    const exportData = {
      exportedAt: new Date().toISOString(),
      userId: currentUser.uid,
      email: currentUser.email || "",
      profile: snapshot.exists() ? snapshot.data() : {}
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "gfhf-account-data.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    showToast("Your profile data download is ready.");
  } catch (error) {
    console.error("Could not export account data:", error);
    showToast("Could not export your data. Please try again.", "error");
  }
}

async function sendPasswordReset() {
  if (!currentUser?.email) return showToast("No email address is available for this account.", "error");
  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    showToast("Password reset link sent to your email.");
  } catch (error) {
    console.error("Could not send password reset email:", error);
    showToast("Could not send the reset link. Please try again.", "error");
  }
}

document.querySelectorAll("[data-save]").forEach((button) => {
  button.addEventListener("click", () => saveSection(button.dataset.save));
});

document.getElementById("exportAccountDataBtn")?.addEventListener("click", exportAccountData);
document.getElementById("sendPasswordResetBtn")?.addEventListener("click", sendPasswordReset);
avatarUrlInput?.addEventListener("input", () => setAvatarPreview(avatarUrlInput.value));
avatarPreview?.addEventListener("load", () => {
  avatarPreview.hidden = false;
  avatarPlaceholder.hidden = true;
});
avatarPreview?.addEventListener("error", () => {
  avatarPreview.hidden = true;
  avatarPlaceholder.hidden = false;
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    if (settingsForm) settingsForm.hidden = true;
    if (authMessage) authMessage.hidden = false;
    return;
  }

  if (settingsForm) settingsForm.hidden = false;
  if (authMessage) authMessage.hidden = true;
  try {
    await loadSettings(user);
  } catch (error) {
    console.error("Could not load settings:", error);
    showToast("Could not load your saved settings.", "error");
  }
});
