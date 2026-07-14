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
const API_KEY = "6e2987eec8066be0a986f648fe4a9cf7"; // Put your API-Sports key here
const API_HOST = "v3.football.api-sports.io";

async function fetchLiveScores() {
    const feedContainer = document.getElementById('live-scores-feed');
    if (!feedContainer) return;

    try {
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?live=all`, {
            method: "GET",
            headers: {
                "x-rapidapi-host": API_HOST,
                "x-rapidapi-key": API_KEY
            }
        });

        const data = await response.json();
        
        if (!data.response || data.response.length === 0) {
            feedContainer.innerHTML = "<p class='no-matches'>No live matches currently in progress.</p>";
            return;
        }

        // Clear loading text
        feedContainer.innerHTML = "";

        // Render up to 4 current live matches to keep the dashboard clean
        data.response.slice(0, 4).forEach(match => {
            const homeTeam = match.teams.home.name;
            const homeLogo = match.teams.home.logo;
            const awayTeam = match.teams.away.name;
            const awayLogo = match.teams.away.logo;
            const homeGoals = match.goals.home ?? 0;
            const awayGoals = match.goals.away ?? 0;
            const elapsed = match.fixture.status.elapsed;
            const leagueName = match.league.name;

            const matchCard = document.createElement('div');
            matchCard.className = 'match-card';
            matchCard.innerHTML = `
                <div class="match-league">${leagueName} - <span class="live-badge">${elapsed}' Live</span></div>
                <div class="match-teams">
                    <div class="team">
                        <img src="${homeLogo}" alt="${homeTeam}" width="20" height="20">
                        <span>${homeTeam}</span>
                    </div>
                    <div class="score">${homeGoals} - ${awayGoals}</div>
                    <div class="team">
                        <img src="${awayLogo}" alt="${awayTeam}" width="20" height="20">
                        <span>${awayTeam}</span>
                    </div>
                </div>
            `;
            feedContainer.appendChild(matchCard);
        });

    } catch (error) {
        console.error("Error fetching live matches:", error);
        feedContainer.innerHTML = "<p class='error-text'>Failed to load live match data.</p>";
    }
}

// Kick off the fetch when the dashboard loads
document.addEventListener('DOMContentLoaded', fetchLiveScores);