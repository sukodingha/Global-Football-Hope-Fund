import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, serverTimestamp, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

const predictionForm = document.getElementById("predictionForm");
const messageBox = document.getElementById("predictionMessage");
const userStatus = document.getElementById("predictionStatus");
const leaderboardList = document.getElementById("leaderboardList");
const pointsSummary = document.getElementById("pointsSummary");

const controllerKey = "__GFHF_PREDICTION_CONTROLLER__";
if (window[controllerKey]) {
  throw new Error("Prediction controller already initialized");
}
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