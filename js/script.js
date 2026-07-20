/**
 * GFHF Shared Utilities — Navigation, Leaderboard
 * This module does NOT initialize Firebase (delegated to firebase-config.js)
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, serverTimestamp, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== Active Navigation Link =====
function setActiveNavigationLink() {
  const currentPath = window.location.pathname.toLowerCase();
  document.querySelectorAll('header nav a, .mobile-bottom-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    try {
      const resolved = new URL(href, window.location.origin + window.location.pathname);
      if (resolved.pathname.toLowerCase() === currentPath) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    } catch (error) {
      // ignore invalid hrefs
    }
  });
}

window.addEventListener('load', setActiveNavigationLink);

// ===== Prediction System (for competition.html) =====
const predictionForm = document.getElementById("predictionForm");
const messageBox = document.getElementById("predictionMessage");
const userStatus = document.getElementById("predictionStatus");
const leaderboardList = document.getElementById("leaderboardList");
const pointsSummary = document.getElementById("pointsSummary");

const controllerKey = "__GFHF_PREDICTION_CONTROLLER__";
if (window[controllerKey]) {
  // Already initialized on this page
} else {
  window[controllerKey] = true;

  const officialResults = {
    champion: "Argentina",
    runnerUp: "France",
    goldenBoot: "Kylian Mbappé",
    goldenGlove: "Emiliano Martínez"
  };

  const scoringRules = [
    { label: "Champion", points: 15 },
    { label: "Runner-up", points: 10 },
    { label: "Golden Boot", points: 8 },
    { label: "Golden Glove", points: 7 }
  ];

  function showMessage(text, type = "success") {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.className = `message ${type}`;
  }

  function normalize(value) {
    return (value || "").toString().trim().toLowerCase();
  }

  function calculatePoints(prediction) {
    let points = 0;
    if (normalize(prediction.champion) === normalize(officialResults.champion)) points += 15;
    if (normalize(prediction.runnerUp) === normalize(officialResults.runnerUp)) points += 10;
    if (normalize(prediction.goldenBoot) === normalize(officialResults.goldenBoot)) points += 8;
    if (normalize(prediction.goldenGlove) === normalize(officialResults.goldenGlove)) points += 7;
    return points;
  }

  async function loadLeaderboard() {
    if (!leaderboardList) return;
    const predictionsRef = collection(db, "predictions");
    const snapshot = await getDocs(predictionsRef);
    const rows = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    rows.sort((a, b) => (b.points || 0) - (a.points || 0));
    leaderboardList.innerHTML = "";

    if (pointsSummary) {
      pointsSummary.innerHTML = scoringRules.map((rule) => `<p><strong>${rule.label}:</strong> ${rule.points} pts</p>`).join("");
    }

    if (!rows.length) {
      leaderboardList.innerHTML = '<li class="leaderboard-empty">No predictions yet.</li>';
      return;
    }

    rows.slice(0, 8).forEach((entry, index) => {
      const item = document.createElement("li");
      item.className = "leaderboard-item";
      item.innerHTML = `<strong>#${index + 1}</strong> ${entry.userName || "Anonymous"} — ${entry.points || 0} pts`;
      leaderboardList.appendChild(item);
    });
  }

  function setPredictionFormEnabled(enabled) {
    if (!predictionForm) return;
    predictionForm.querySelectorAll("input, button").forEach((element) => {
      element.disabled = !enabled;
    });
  }

  if (predictionForm) {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (userStatus) userStatus.textContent = "Please sign in to submit predictions.";
        setPredictionFormEnabled(false);
        return;
      }
      if (userStatus) userStatus.textContent = `Signed in as ${user.email}`;
      setPredictionFormEnabled(true);
    });

    predictionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = auth.currentUser;
      if (!user) {
        showMessage("Please sign in first.", "error");
        return;
      }
      const formData = new FormData(predictionForm);
      const predictionData = {
        champion: formData.get("champion")?.toString().trim() || "",
        runnerUp: formData.get("runnerUp")?.toString().trim() || "",
        goldenBoot: formData.get("goldenBoot")?.toString().trim() || "",
        goldenGlove: formData.get("goldenGlove")?.toString().trim() || ""
      };
      const payload = {
        ...predictionData,
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email,
        points: calculatePoints(predictionData),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      try {
        await setDoc(doc(db, "predictions", user.uid), payload, { merge: true });
        showMessage("Predictions saved successfully.", "success");
        predictionForm.reset();
        await loadLeaderboard();
      } catch (error) {
        showMessage(error.message || "Could not save predictions.", "error");
      }
    });
  }

  loadLeaderboard();
}

