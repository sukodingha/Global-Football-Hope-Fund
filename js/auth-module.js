/**
 * Production-grade Firebase Authentication Module
 * Supports: Google Sign-In, Email/Password sign-up/sign-in
 * Features: Error recovery, user profile initialization, session persistence
 */

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const googleProvider = new GoogleAuthProvider();
const functions = getFunctions();

/**
 * Authentication error messages for user-friendly display
 */
const AUTH_ERRORS = {
  "auth/email-already-in-use": "Email already registered. Please sign in instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-not-found": "Email not registered. Please sign up first.",
  "auth/wrong-password": "Incorrect password. Please try again.",
  "auth/too-many-requests": "Too many failed attempts. Please try again later.",
  "auth/account-exists-with-different-credential": "This email is already registered with another sign-in method.",
  "auth/cancelled-popup-request": "Sign-in popup cancelled. Please try again.",
  "auth/popup-blocked": "Sign-in popup was blocked. Please check your browser settings.",
  "auth/operation-not-allowed": "Google Sign-In is not enabled. Contact support.",
};

/**
 * Get user-friendly error message
 */
function getErrorMessage(code, fallback = "Authentication failed. Please try again.") {
  return AUTH_ERRORS[code] || fallback;
}

/**
 * Initialize user profile on first sign-in (calls backend function)
 */
async function initializeUserProfile(uid, email, displayName) {
  try {
    const initProfile = httpsCallable(functions, "initializeProfile");
    const result = await initProfile({ displayName });
    console.log("Profile initialized:", result.data);
    return result.data;
  } catch (err) {
    console.error("Profile init error:", err);
    // Non-fatal: profile may already exist
    return null;
  }
}

/**
 * Sign up with email and password
 * Creates auth account → creates user profile → sets auth state
 */
export async function signUpWithEmail(email, password, displayName = "") {
  try {
    // Validate input
    if (!email || !password) {
      throw { code: "invalid-argument", message: "Email and password required." };
    }

    // Create auth account
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Auth account created:", userCred.user.uid);

    // Update display name if provided
    if (displayName) {
      await updateProfile(userCred.user, { displayName });
    }

    // Initialize user profile in Firestore (backend-driven)
    await initializeUserProfile(userCred.user.uid, email, displayName);

    return {
      success: true,
      user: {
        uid: userCred.user.uid,
        email: userCred.user.email,
        displayName: userCred.user.displayName || displayName,
      },
    };
  } catch (err) {
    console.error("Sign-up error:", err.code, err.message);
    const message = getErrorMessage(err.code, err.message);
    throw new Error(message);
  }
}

/**
 * Sign in with email and password
 * Validates credentials → restores session
 */
export async function signInWithEmail(email, password) {
  try {
    if (!email || !password) {
      throw { code: "invalid-argument", message: "Email and password required." };
    }

    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Signed in:", userCred.user.uid);

    return {
      success: true,
      user: {
        uid: userCred.user.uid,
        email: userCred.user.email,
        displayName: userCred.user.displayName,
      },
    };
  } catch (err) {
    console.error("Sign-in error:", err.code, err.message);
    const message = getErrorMessage(err.code, err.message);
    throw new Error(message);
  }
}

/**
 * Sign in with Google
 * Opens popup → authenticates with Google → creates/links user profile
 */
export async function signInWithGoogle() {
  try {
    // Enable persistence first
    await setPersistence(auth, browserLocalPersistence);

    // Trigger Google Sign-In popup
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    console.log("Google Sign-In successful:", user.uid);

    // Initialize user profile on first sign-in
    await initializeUserProfile(user.uid, user.email, user.displayName);

    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      },
    };
  } catch (err) {
    console.error("Google Sign-In error:", err.code, err.message);
    
    // Special handling for popup errors
    if (err.code === "auth/popup-blocked") {
      throw new Error("Pop-up blocker detected. Please allow pop-ups for this site.");
    }
    if (err.code === "auth/cancelled-popup-request") {
      throw new Error("Sign-in cancelled. Please try again.");
    }

    const message = getErrorMessage(err.code, err.message);
    throw new Error(message);
  }
}

/**
 * Send password reset email
 * Allows users to reset forgotten passwords
 */
export async function sendPasswordReset(email) {
  try {
    if (!email) {
      throw { code: "invalid-argument", message: "Email is required." };
    }

    await sendPasswordResetEmail(auth, email);
    console.log("Password reset email sent:", email);

    return {
      success: true,
      message: "Check your email for password reset instructions.",
    };
  } catch (err) {
    console.error("Password reset error:", err.code, err.message);
    const message = getErrorMessage(err.code, err.message);
    throw new Error(message);
  }
}

/**
 * Sign out current user
 */
export async function logOut() {
  try {
    await signOut(auth);
    console.log("User signed out");
    return { success: true };
  } catch (err) {
    console.error("Sign-out error:", err);
    throw new Error("Sign-out failed. Please try again.");
  }
}

/**
 * Monitor auth state changes
 * Callback receives: { user: {uid, email, displayName} | null, loading: boolean }
 */
export function onAuthChange(callback) {
  let isFirstCall = true;

  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    if (isFirstCall) {
      isFirstCall = false;
      // Initial load complete
      callback({ user: null, loading: false });
    }

    if (user) {
      console.log("Auth state: user signed in", user.uid);
      callback({
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
        },
        loading: false,
      });
    } else {
      console.log("Auth state: user signed out");
      callback({ user: null, loading: false });
    }
  });

  return unsubscribe;
}

/**
 * Get current user
 */
export function getCurrentUser() {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  };
}

/**
 * Check if user is authenticated
 */
export function isUserAuthenticated() {
  return auth.currentUser !== null;
}

/**
 * Enable session persistence (call on app init)
 */
export async function enableSessionPersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    console.log("Session persistence enabled");
  } catch (err) {
    console.warn("Could not enable persistence:", err.message);
  }
}
