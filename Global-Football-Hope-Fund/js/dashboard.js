import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const welcomeText = document.getElementById("welcomeText");
const userEmail = document.getElementById("userEmail");
const messageBox = document.getElementById("messageBox");
const profileSummary = document.getElementById("profileSummary");
const predictionSummary = document.getElementById("predictionSummary");

function showMessage(text, type = "success") {
  if (!messageBox) return;
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showMessage("Please sign in to access your dashboard.", "error");
    window.location.href = "login.html";
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("goto") === "community") {
    window.location.href = "community.html";
    return;
  }

  if (welcomeText) {
    welcomeText.textContent = `Welcome, ${user.displayName || "friend"}!`;
  }

  if (userEmail) {
    userEmail.textContent = user.email || "No email available";
  }

  const profileRef = doc(db, "users", user.uid);
  const profileSnap = await getDoc(profileRef);
  let profile = {};

  if (profileSnap.exists()) {
    profile = profileSnap.data();
    if (welcomeText) {
      welcomeText.textContent = `Welcome, ${profile.displayName || profile.firstName || "friend"}!`;
    }
  }

  if (profileSummary) {
    profileSummary.innerHTML = `
      <p><strong>Country:</strong> ${profile.country || "Not provided"}</p>
      <p><strong>City:</strong> ${profile.city || "Not provided"}</p>
      <p><strong>Favorite Team:</strong> ${profile.club || profile.nationalTeam || "Not provided"}</p>
    `;
  }

  const predictionsRef = collection(db, "predictions");
  const q = query(predictionsRef, where("userId", "==", user.uid));
  const predictionSnap = await getDocs(q);
  const predictions = predictionSnap.docs.map((docSnap) => docSnap.data());

  if (predictionSummary) {
    const totalPoints = predictions.reduce((sum, prediction) => sum + (prediction.points || 0), 0);
    predictionSummary.innerHTML = `
      <p><strong>Predictions submitted:</strong> ${predictions.length}</p>
      <p><strong>Current points:</strong> ${totalPoints}</p>
      <p><strong>Latest pick:</strong> ${predictions[0]?.champion || "No prediction yet"}</p>
    `;
  }
});
