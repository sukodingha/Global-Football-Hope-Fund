/**
 * GFHF Username System
 * - Allows users to set a unique @username (displayed in @mentions and profile)
 * - Validates format (3-20 chars, letters/numbers/underscore)
 * - Checks Firestore uniqueness
 * - Auto-prompts users who don't have a username set
 */

import { auth, db } from "./firebase.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== STATE =====
let usernameModalOpen = false;

/**
 * Validate a username string
 * @param {string} username
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateUsername(username) {
  if (!username || typeof username !== "string") {
    return { valid: false, reason: "Username is required." };
  }
  const trimmed = username.trim().toLowerCase();
  if (trimmed.length < 3) {
    return { valid: false, reason: "Username must be at least 3 characters." };
  }
  if (trimmed.length > 20) {
    return { valid: false, reason: "Username must be 20 characters or fewer." };
  }
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    return { valid: false, reason: "Username can only contain letters, numbers, and underscores." };
  }
  if (/^[0-9_]/.test(trimmed)) {
    return { valid: false, reason: "Username must start with a letter." };
  }
  return { valid: true };
}

/**
 * Check if a username is already taken in Firestore
 * @param {string} username - The username to check (lowercased)
 * @returns {Promise<boolean>} true if available
 */
export async function isUsernameAvailable(username) {
  if (!db) return false;
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", username.trim().toLowerCase()));
    const snap = await getDocs(q);
    return snap.empty;
  } catch (err) {
    console.warn("Error checking username availability:", err);
    return false;
  }
}

/**
 * Save a username to the user's Firestore document
 * @param {string} userId
 * @param {string} username
 */
export async function saveUsername(userId, username) {
  if (!userId || !username || !db) return;
  const clean = username.trim().toLowerCase();
  const userRef = doc(db, "users", userId);
  await setDoc(userRef, { username: clean }, { merge: true });
}

/**
 * Get the @username display string for a user
 * @param {Object} profileData - Firestore user data
 * @returns {string} e.g. "@john_doe" or ""
 */
export function getUsernameDisplay(profileData) {
  if (profileData && profileData.username) {
    return `@${profileData.username}`;
  }
  return "";
}

/**
 * Build and show the username selection modal
 * @param {Function} onSave - callback after successful save
 */
export function showUsernameModal(onSave) {
  if (usernameModalOpen) return;
  usernameModalOpen = true;

  // Remove existing modal if any
  const existing = document.getElementById("usernameModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "usernameModal";
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 5000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  `;

  modal.innerHTML = `
    <div style="
      background: white; border-radius: 24px; padding: 32px 28px 28px;
      max-width: 420px; width: calc(100% - 32px); margin: 16px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.35); text-align: center;
    ">
      <div style="
        width: 56px; height: 56px; margin: 0 auto 12px;
        border-radius: 16px; display: grid; place-items: center;
        font-size: 28px; background: linear-gradient(135deg, #00c853, #0b2d4d);
      ">@</div>
      <h3 style="margin: 0 0 6px; font-size: 22px; color: #0b2d4d;">
        Choose Your Username
      </h3>
      <p style="margin: 0 0 18px; font-size: 14px; color: #64748b;">
        This will be your unique @username for mentions and profile.
      </p>
      <div style="text-align: left; margin-bottom: 8px;">
        <label style="font-weight: 600; font-size: 13px; color: #14213d; display: block; margin-bottom: 6px;">
          Username
        </label>
        <input id="usernameInput" type="text" placeholder="e.g. john_doe" maxlength="20"
          style="
            width: 100%; padding: 12px 16px; border: 1px solid #d6d9de;
            border-radius: 12px; font-size: 15px; background: #fafafa;
            box-sizing: border-box; transition: border-color 0.2s;
          "
        >
      </div>
      <div id="usernameError" style="
        font-size: 13px; color: #ef4444; margin-bottom: 8px; display: none;
      "></div>
      <div id="usernameSuccess" style="
        font-size: 13px; color: #00c853; margin-bottom: 8px; display: none;
      "></div>
      <button id="usernameSaveBtn" style="
        width: 100%; padding: 12px; border: none; border-radius: 12px;
        background: linear-gradient(90deg, #00c853, #00b34a);
        color: white; font-weight: 700; font-size: 16px;
        cursor: pointer; transition: opacity 0.2s;
      " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
        Save Username
      </button>
      <p style="margin: 12px 0 0; font-size: 12px; color: #94a3b8;">
        3-20 characters · letters, numbers, underscores · starts with a letter
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  const input = document.getElementById("usernameInput");
  const errorEl = document.getElementById("usernameError");
  const successEl = document.getElementById("usernameSuccess");
  const saveBtn = document.getElementById("usernameSaveBtn");

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn?.click();
      }
    });
    // Real-time validation feedback
    input.addEventListener("input", () => {
      errorEl.style.display = "none";
      successEl.style.display = "none";
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const val = input?.value?.trim() || "";
      const validation = validateUsername(val);
      if (!validation.valid) {
        errorEl.textContent = validation.reason || "Invalid username.";
        errorEl.style.display = "block";
        successEl.style.display = "none";
        return;
      }

      // Check availability
      const available = await isUsernameAvailable(val);
      if (!available) {
        errorEl.textContent = "This username is already taken. Try another.";
        errorEl.style.display = "block";
        successEl.style.display = "none";
        return;
      }

      // Save
      try {
        const user = auth.currentUser;
        if (!user) {
          errorEl.textContent = "You must be signed in.";
          errorEl.style.display = "block";
          return;
        }
        await saveUsername(user.uid, val);
        successEl.textContent = `✅ Username @${val.trim().toLowerCase()} saved!`;
        successEl.style.display = "block";
        errorEl.style.display = "none";
        saveBtn.disabled = true;
        saveBtn.style.opacity = "0.5";
        saveBtn.textContent = "✅ Saved!";

        // Close modal after 1.5s, then fire callback
        setTimeout(() => {
          modal.remove();
          usernameModalOpen = false;
          if (typeof onSave === "function") {
            onSave(val.trim().toLowerCase());
          }
        }, 1500);
      } catch (err) {
        errorEl.textContent = "Failed to save username. Try again.";
        errorEl.style.display = "block";
        console.error(err);
      }
    });
  }

  // Close on overlay click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) return; // Don't close on overlay click — must choose
  });

  // Focus the input
  setTimeout(() => input?.focus(), 300);
}

/**
 * Check if the logged-in user has a username, and prompt if not
 * @param {Object} user - Firebase Auth user object
 * @param {Object} profileData - Firestore user data (optional, to avoid re-fetch)
 */
export async function checkUsername(user, profileData) {
  if (!user || !db) return;

  let data = profileData;
  if (!data) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      data = snap.exists() ? snap.data() : {};
    } catch {
      return;
    }
  }

  if (!data.username) {
    showUsernameModal();
  }
}

