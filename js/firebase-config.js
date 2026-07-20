/**
 * GFHF Firebase Configuration — Centralized Single Source of Truth
 * Initializes Firebase app, Auth, Firestore, and Analytics.
 * All modules should import { auth, db } from this file.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZZwZUTHqCqCvptGnLB3Vzq-ZGWPHEZ7o",
  authDomain: "global-football-hope-fund.firebaseapp.com",
  projectId: "global-football-hope-fund",
  storageBucket: "global-football-hope-fund.firebasestorage.app",
  messagingSenderId: "861980418289",
  appId: "1:861980418289:web:365d21bead8c98f579c959",
  measurementId: "G-YHHC0V89D3"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

console.log("Firebase connected successfully ✔");

export { app, analytics, auth, db };

