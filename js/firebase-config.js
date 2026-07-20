import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
export const auth = getAuth(app);
export const db = getFirestore(app);
