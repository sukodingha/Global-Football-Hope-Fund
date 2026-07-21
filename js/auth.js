import { auth } from "./firebase-config.js";
import { db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ===== DOM refs =====
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const messageBox = document.getElementById("messageBox");
const userStatus = document.getElementById("userStatus");
const logoutBtn = document.getElementById("logoutBtn");
const authModal = document.getElementById("authModal");
const authModalOverlay = document.getElementById("authModalOverlay");
const authModalClose = document.getElementById("authModalClose");
const authModalTitle = document.getElementById("authModalTitle");
const authModalMsg = document.getElementById("authModalMsg");
const authLoginTab = document.getElementById("authLoginTab");
const authRegisterTab = document.getElementById("authRegisterTab");
const authLoginForm = document.getElementById("authLoginForm");
const authRegisterForm = document.getElementById("authRegisterForm");
const googleSignInBtn = document.getElementById("googleSignInBtn");

let authModalResolve = null;

// ===== Auth Modal =====
export function showAuthModal() {
  return new Promise((resolve) => {
    authModalResolve = resolve;
    if (authModal) {
      authModal.classList.add("auth-modal--open");
      document.body.style.overflow = "hidden";
    }
    switchAuthTab("login");
  });
}

export function hideAuthModal() {
  if (authModal) {
    authModal.classList.remove("auth-modal--open");
    document.body.style.overflow = "";
  }
  if (authModalResolve) {
    authModalResolve(auth.currentUser);
    authModalResolve = null;
  }
}

function switchAuthTab(tab) {
  if (!authLoginTab || !authRegisterTab || !authLoginForm || !authRegisterForm || !authModalTitle) return;

  if (tab === "login") {
    authLoginTab.classList.add("active");
    authRegisterTab.classList.remove("active");
    authLoginForm.style.display = "grid";
    authRegisterForm.style.display = "none";
    authModalTitle.textContent = "Sign In";
  } else {
    authLoginTab.classList.remove("active");
    authRegisterTab.classList.add("active");
    authLoginForm.style.display = "none";
    authRegisterForm.style.display = "grid";
    authModalTitle.textContent = "Create Account";
  }
}

function showModalMessage(text, type = "success") {
  if (!authModalMsg) return;
  authModalMsg.textContent = text;
  authModalMsg.className = `message ${type}`;
}

// Close modal events
if (authModalClose) {
  authModalClose.addEventListener("click", hideAuthModal);
}
if (authModalOverlay) {
  authModalOverlay.addEventListener("click", (e) => {
    if (e.target === authModalOverlay) hideAuthModal();
  });
}

// Tab switching
if (authLoginTab) {
  authLoginTab.addEventListener("click", () => switchAuthTab("login"));
}
if (authRegisterTab) {
  authRegisterTab.addEventListener("click", () => switchAuthTab("register"));
}

// ===== Account Recovery via Unique ID =====
const authRecoveryForm = document.getElementById("authRecoveryForm");
const authRecoveryLink = document.getElementById("authRecoveryLink");
const authBackToLoginLink = document.getElementById("authBackToLoginLink");
const authLoginFormEl = document.getElementById("authLoginForm");

if (authRecoveryLink) {
  authRecoveryLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (authLoginFormEl) authLoginFormEl.style.display = "none";
    if (authRecoveryForm) authRecoveryForm.style.display = "grid";
    if (authModalTitle) authModalTitle.textContent = "Account Recovery";
    if (authLoginTab) authLoginTab.classList.remove("active");
    if (authRegisterTab) authRegisterTab.classList.remove("active");
  });
}

if (authBackToLoginLink) {
  authBackToLoginLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (authLoginFormEl) authLoginFormEl.style.display = "grid";
    if (authRecoveryForm) authRecoveryForm.style.display = "none";
    if (authModalTitle) authModalTitle.textContent = "Sign In";
    if (authLoginTab) authLoginTab.classList.add("active");
  });
}

if (authRecoveryForm) {
  authRecoveryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uniqueId = authRecoveryForm.uniqueId?.value?.trim() || "";
    const email = authRecoveryForm.email?.value?.trim() || "";

    if (!uniqueId || !email) {
      showModalMessage("Please enter both your Unique ID and email.", "error");
      return;
    }

    try {
      // Look up the user by uniqueId in Firestore
      const usersSnap = await getDocs(collection(db, "users"));
      let foundUser = null;
      usersSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.uniqueId === uniqueId) {
          foundUser = { id: docSnap.id, email: data.email, ...data };
        }
      });

      if (!foundUser) {
        showModalMessage("No account found with this Unique ID.", "error");
        return;
      }

      if (foundUser.email !== email) {
        showModalMessage("The email does not match the account associated with this Unique ID.", "error");
        return;
      }

      // Send password reset email
      await sendPasswordResetEmail(auth, email);
      showModalMessage("✅ Password reset email sent! Check your inbox (including spam).", "success");
      authRecoveryForm.reset();
      setTimeout(() => {
        if (authBackToLoginLink) authBackToLoginLink.click();
      }, 3000);
    } catch (error) {
      console.error("Recovery error:", error);
      showModalMessage(error.message || "Recovery failed. Please try again.", "error");
    }
  });
}

// ===== Modal Login =====
if (authLoginForm) {
  authLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = authLoginForm.email?.value?.trim();
    const password = authLoginForm.password?.value;
    if (!email || !password) return;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      hideAuthModal();
    } catch (error) {
      showModalMessage(error.message || "Login failed.", "error");
    }
  });
}

// ===== Modal Register =====
if (authRegisterForm) {
  authRegisterForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const displayName = authRegisterForm.displayName?.value?.trim() || "";
    const email = authRegisterForm.email?.value?.trim() || "";
    const password = authRegisterForm.password?.value || "";
    const confirmPassword = authRegisterForm.confirmPassword?.value || "";

    if (password.length < 6) {
      showModalMessage("Password must be at least 6 characters.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showModalMessage("Passwords do not match.", "error");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await saveUserProfile(user, { displayName });
      await sendEmailVerification(user);
      showModalMessage("Account created! Please verify your email.", "success");
      setTimeout(() => switchAuthTab("login"), 2000);
    } catch (error) {
      showModalMessage(error.message || "Registration failed.", "error");
    }
  });
}

// ===== Google Sign-In Handler =====
export async function handleGoogleSignIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Save/update profile
    await saveUserProfile(user, {
      displayName: user.displayName || "",
      photoURL: user.photoURL || ""
    });

    console.log("User signed in successfully:", user);
    return user;
  } catch (error) {
    console.error("Google Auth Error:", error.code, error.message);
    alert("Google Sign-In Error: " + error.message);
  }
}

if (googleSignInBtn) {
  googleSignInBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const user = await handleGoogleSignIn();
    if (user) {
      hideAuthModal();
    }
  });
}

// ===== Original page forms (register.html / login.html) =====
const registerFormLegacy = document.getElementById("registerForm");
const loginFormLegacy = document.getElementById("loginForm");
const messageBoxLegacy = document.getElementById("messageBox");

function showMessage(text, type = "success") {
  if (!messageBoxLegacy) return;
  messageBoxLegacy.textContent = text;
  messageBoxLegacy.className = `message ${type}`;
}

function saveFlashMessage(text, type = "success") {
  sessionStorage.setItem("authFlashMessage", JSON.stringify({ text, type }));
}

function restoreFlashMessage() {
  const stored = sessionStorage.getItem("authFlashMessage");
  if (!stored) return;
  try {
    const { text, type } = JSON.parse(stored);
    showMessage(text, type);
  } catch (error) {
    console.error("Failed to restore auth flash message", error);
  } finally {
    sessionStorage.removeItem("authFlashMessage");
  }
}

async function saveUserProfile(user, extraData = {}) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);
  const userData = {
    uid: user.uid,
    email: user.email,
    createdAt: new Date().toISOString(),
    ...extraData
  };
  await setDoc(userRef, userData, { merge: true });
}

async function createUniqueMembershipId(firstName = "", lastName = "") {
  const firstInitial = (firstName || "").trim().charAt(0).toUpperCase();
  const lastInitial = (lastName || "").trim().charAt(0).toUpperCase();
  const initials = `${firstInitial}${lastInitial}`.trim();
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  const candidate = initials ? `GFHF-${randomNumber}-${initials}` : `GFHF-${randomNumber}`;
  const membershipRef = doc(db, "membershipIds", candidate);
  const membershipSnap = await getDoc(membershipRef);
  if (membershipSnap.exists()) {
    return createUniqueMembershipId(firstName, lastName);
  }
  await setDoc(membershipRef, { createdAt: new Date().toISOString() });
  return candidate;
}

if (registerFormLegacy) {
  registerFormLegacy.addEventListener("submit", async (event) => {
    event.preventDefault();
    const firstName = registerFormLegacy.firstName?.value.trim() || "";
    const lastName = registerFormLegacy.lastName?.value.trim() || "";
    const displayName = registerFormLegacy.displayName?.value.trim() || "";
    const email = registerFormLegacy.email?.value.trim() || "";
    const password = registerFormLegacy.password?.value || "";
    const confirmPassword = registerFormLegacy.confirmPassword?.value || "";

    if (password.length < 6) {
      showMessage("Password should be at least 6 characters.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showMessage("Passwords do not match.", "error");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const membershipId = await createUniqueMembershipId(firstName, lastName);
      await saveUserProfile(user, {
        firstName, lastName, displayName, membershipId,
        country: registerFormLegacy.country?.value.trim() || "",
        city: registerFormLegacy.city?.value.trim() || "",
        nationalTeam: registerFormLegacy.nationalTeam?.value.trim() || "",
        club: registerFormLegacy.club?.value.trim() || "",
        btc: registerFormLegacy.btc?.value.trim() || "",
        usdt: registerFormLegacy.usdt?.value.trim() || ""
      });
      await sendEmailVerification(user);
      saveFlashMessage("Account created successfully. Please verify your email before signing in.", "success");
      registerFormLegacy.reset();
      window.location.href = "login.html";
    } catch (error) {
      showMessage(error.message || "Registration failed.", "error");
    }
  });
}

if (loginFormLegacy) {
  loginFormLegacy.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = loginFormLegacy.email?.value.trim() || "";
    const password = loginFormLegacy.password?.value || "";
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      if (!user.emailVerified) {
        await signOut(auth);
        showMessage("Your email is not verified. Please check your inbox or spam for the verification email before signing in.", "error");
        return;
      }
      showMessage("Signed in successfully.", "success");
      window.location.href = "dashboard.html?goto=community";
    } catch (error) {
      showMessage(error.message || "Login failed.", "error");
    }
  });
}

restoreFlashMessage();

// ===== Profile Avatar Helper =====
function generateInitialsAvatar(name, size = 40) {
  const initials = (name || "?")
    .split(" ")
    .map(s => s[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "?";
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#0b2d4d");
  gradient.addColorStop(1, "#123f63");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${size * 0.4}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, size / 2, size / 2);
  return canvas.toDataURL("image/png");
}

// ===== Update user status with avatar =====
function updateUserStatus(user, profileData = null) {
  if (!userStatus) return;

  if (!user) {
    userStatus.innerHTML = `<span class="user-status-text">Login</span>`;
    userStatus.classList.remove("active");
    userStatus.style.cursor = "pointer";
    userStatus.onclick = showAuthModal;
    if (logoutBtn) logoutBtn.hidden = true;
    return;
  }

  const displayName = profileData?.displayName || user.displayName || user.email?.split("@")[0] || "Member";
  const photoURL = profileData?.photoURL || user.photoURL || "";

  let avatarHtml = "";
  if (photoURL) {
    avatarHtml = `<img src="${photoURL}" alt="" class="user-avatar" onerror="this.style.display='none'">`;
  } else {
    const dataUri = generateInitialsAvatar(displayName, 32);
    avatarHtml = `<img src="${dataUri}" alt="" class="user-avatar">`;
  }

  userStatus.innerHTML = `
    ${avatarHtml}
    <span class="user-status-text">${displayName}</span>
    <span class="user-status-dot"></span>
  `;
  userStatus.classList.add("active");
  userStatus.style.cursor = "default";
  userStatus.onclick = null;
  if (logoutBtn) logoutBtn.hidden = false;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    updateUserStatus(null);
    return;
  }

  const profileRef = doc(db, "users", user.uid);
  const profileSnap = await getDoc(profileRef);
  if (profileSnap.exists()) {
    const profileData = profileSnap.data();
    updateUserStatus(user, profileData);
  } else {
    updateUserStatus(user);
  }
});

window.logoutUser = async function () {
  await signOut(auth);
  window.location.href = "login.html";
};

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "index.html";
    } catch (error) {
      console.error("Logout failed", error);
    }
  });
}
