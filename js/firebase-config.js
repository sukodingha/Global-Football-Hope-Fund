import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZZwZUTHqCqCvpIGnlB3Vzq-ZGWPH0Z7o",
  authDomain: "global-football-hope-fund.firebaseapp.com",
  projectId: "global-football-hope-fund",
  storageBucket: "global-football-hope-fund.firebasestorage.app",
  messagingSenderId: "861980418289",
  appId: "1:861980418289:web:70e9cd3c7b28411c79c950",
  measurementId: "G-T93FM6CP1K"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence with long polling to avoid QUIC protocol issues
try {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore persistence: multiple tabs open, persistence disabled.');
    } else if (err.code === 'unimplemented') {
      console.warn('Firestore persistence: not available in this browser.');
    }
  });
} catch (e) {
  console.warn('Firestore persistence init error:', e);
}

