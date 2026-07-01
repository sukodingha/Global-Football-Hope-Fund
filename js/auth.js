import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const messageBox = document.getElementById("messageBox");
const userStatus = document.getElementById("userStatus");
const logoutBtn = document.getElementById("logoutBtn");

function showMessage(text, type = "success") {
  if (!messageBox) return;
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
}

function updateUserStatus(user, profileData = null) {
  if (!userStatus) return;

  if (!user) {
    userStatus.textContent = "Login";
    userStatus.classList.remove("active");
    if (logoutBtn) logoutBtn.hidden = true;
    return;
  }

  const displayName = profileData?.displayName || profileData?.firstName || user.displayName || user.email?.split("@")[0] || "Member";
  userStatus.textContent = `Welcome, ${displayName}`;
  userStatus.classList.add("active");
  if (logoutBtn) logoutBtn.hidden = false;
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

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const firstName = registerForm.firstName?.value.trim() || "";
    const lastName = registerForm.lastName?.value.trim() || "";
    const displayName = registerForm.displayName?.value.trim() || "";
    const email = registerForm.email?.value.trim() || "";
    const password = registerForm.password?.value || "";
    const confirmPassword = registerForm.confirmPassword?.value || "";

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
        firstName,
        lastName,
        displayName,
        membershipId,
        country: registerForm.country?.value.trim() || "",
        city: registerForm.city?.value.trim() || "",
        nationalTeam: registerForm.nationalTeam?.value.trim() || "",
        club: registerForm.club?.value.trim() || "",
        btc: registerForm.btc?.value.trim() || "",
        usdt: registerForm.usdt?.value.trim() || ""
      });

      await sendEmailVerification(user);
      saveFlashMessage("Account created successfully. Please verify your email before signing in.", "success");
      registerForm.reset();
      window.location.href = "login.html";
    } catch (error) {
      showMessage(error.message || "Registration failed.", "error");
    }
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = loginForm.email?.value.trim() || "";
    const password = loginForm.password?.value || "";

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (!user.emailVerified) {
        await signOut(auth);
        showMessage("Your email is not verified. Please check your inbox or spam for the verification email before signing in.", "error");
        return;
      }

      showMessage("Signed in successfully.", "success");
      window.location.href = "dashboard.html";
    } catch (error) {
      showMessage(error.message || "Login failed.", "error");
    }
  });
}

restoreFlashMessage();

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
    console.log("User profile loaded", profileData);
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
