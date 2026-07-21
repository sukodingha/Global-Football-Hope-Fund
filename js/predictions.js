/**
 * GFHF Match Prediction League Module
 * - Displays upcoming fixtures from live scores API
 * - Users predict home/away scores and save to Firestore under predictions/{uid}_{matchId}
 * - Community Leaderboard with Unique IDs (#GFHF-XXXX)
 * - Points: +3 for exact score, +1 for correct outcome
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, collection, query, where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== DOM REFS =====
const fixturesContainer = document.getElementById("predictionFixtures");
const leaderboardContainer = document.getElementById("predictionLeaderboard");
const userStatus = document.getElementById("predictionUserStatus");
const globalMsg = document.getElementById("predictionGlobalMsg");

// ===== STATE =====
let currentUser = null;
let currentUserUniqueId = null;
let currentUserName = "Guest";

// ===== MOCK UPCOMING FIXTURES =====
const MOCK_FIXTURES = [
  {
    id: "fixture_1",
    league: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    date: new Date(Date.now() + 86400000 * 2).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_2",
    league: "La Liga",
    homeTeam: "Barcelona",
    awayTeam: "Real Madrid",
    date: new Date(Date.now() + 86400000 * 3).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_3",
    league: "Serie A",
    homeTeam: "Inter Milan",
    awayTeam: "AC Milan",
    date: new Date(Date.now() + 86400000 * 4).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_4",
    league: "Bundesliga",
    homeTeam: "Bayern Munich",
    awayTeam: "Borussia Dortmund",
    date: new Date(Date.now() + 86400000).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_5",
    league: "Ligue 1",
    homeTeam: "PSG",
    awayTeam: "Marseille",
    date: new Date(Date.now() + 86400000 * 5).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_6",
    league: "Premier League",
    homeTeam: "Liverpool",
    awayTeam: "Manchester City",
    date: new Date(Date.now() + 86400000 * 6).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_7",
    league: "Premier League",
    homeTeam: "Manchester United",
    awayTeam: "Tottenham",
    date: new Date(Date.now() + 86400000 * 7).toISOString(),
    status: "upcoming"
  },
  {
    id: "fixture_8",
    league: "La Liga",
    homeTeam: "Atletico Madrid",
    awayTeam: "Sevilla",
    date: new Date(Date.now() + 86400000 * 4).toISOString(),
    status: "upcoming"
  }
];

// ===== HELPERS =====
function formatDate(dateStr) {
  if (!dateStr) return "TBD";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch { return dateStr; }
}

function getFixtureId(matchId) {
  return `${currentUser?.uid || "anon"}_${matchId}`;
}

function showGlobalMsg(text, type = "success") {
  if (!globalMsg) return;
  globalMsg.textContent = text;
  globalMsg.className = `message ${type}`;
  setTimeout(() => { globalMsg.className = "message"; }, 4000);
}

// ===== RENDER FIXTURES =====
function renderFixtures(fixtures) {
  if (!fixturesContainer) return;

  if (!fixtures || fixtures.length === 0) {
    fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">No upcoming fixtures available.</p></div>';
    return;
  }

  fixturesContainer.innerHTML = fixtures.map((match) => {
    const matchId = match.id;
    const fixtureDate = formatDate(match.date);
    const isPast = new Date(match.date) < new Date();

    return `
      <div class="card odds-card" data-fixture-id="${matchId}">
        <div class="odds-header">
          <span class="league-pill">⚽ ${match.league}</span>
          <span class="odds-time">📅 ${fixtureDate}</span>
        </div>
        <div class="odds-teams">
          <div class="odds-team">${match.homeTeam}</div>
          <div class="odds-vs">vs</div>
          <div class="odds-team">${match.awayTeam}</div>
        </div>
        <div class="odds-prediction-form">
          <div class="predict-label">🎯 Predict Score${isPast ? ' (Closed)' : ''}</div>
          <div class="predict-inputs">
            <div class="predict-team">
              <span class="predict-team-name">${match.homeTeam}</span>
              <input type="number" class="predict-score-input home-score" data-fixture="${matchId}" min="0" max="20" placeholder="0" ${isPast ? "disabled" : ""}>
            </div>
            <span class="predict-dash">-</span>
            <div class="predict-team">
              <span class="predict-team-name">${match.awayTeam}</span>
              <input type="number" class="predict-score-input away-score" data-fixture="${matchId}" min="0" max="20" placeholder="0" ${isPast ? "disabled" : ""}>
            </div>
          </div>
          <button class="btn submit-prediction-btn" data-fixture-id="${matchId}" ${isPast ? "disabled" : ""}>
            ${isPast ? "⏰ Closed" : "Submit Prediction"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Attach prediction submit handlers
  fixturesContainer.querySelectorAll(".submit-prediction-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!currentUser) {
        showGlobalMsg("Please sign in to make predictions.", "error");
        return;
      }

      const fixtureId = btn.dataset.fixtureId;
      const card = btn.closest(".odds-card");
      const homeInput = card.querySelector(".home-score");
      const awayInput = card.querySelector(".away-score");
      const homeVal = homeInput.value.trim();
      const awayVal = awayInput.value.trim();

      if (!homeVal || !awayVal) {
        showGlobalMsg("Please enter both scores.", "error");
        return;
      }

      const homeNum = parseInt(homeVal, 10);
      const awayNum = parseInt(awayVal, 10);
      if (isNaN(homeNum) || isNaN(awayNum) || homeNum < 0 || awayNum > 20) {
        showGlobalMsg("Enter valid scores (0-20).", "error");
        return;
      }

      await submitPrediction(fixtureId, homeNum, awayNum, btn);
    });
  });
}

// ===== SUBMIT PREDICTION =====
async function submitPrediction(fixtureId, homeScore, awayScore, btnElement) {
  if (!currentUser) return;

  btnElement.disabled = true;
  btnElement.textContent = "Saving...";

  try {
    const predictionId = getFixtureId(fixtureId);
    const predictionRef = doc(db, "predictions", predictionId);

    await setDoc(predictionRef, {
      userId: currentUser.uid,
      userEmail: currentUser.email,
      userName: currentUserName,
      userUniqueId: currentUserUniqueId || "",
      fixtureId: fixtureId,
      homeScore: homeScore,
      awayScore: awayScore,
      points: 0, // Points awarded when results are verified
      exactMatch: false,
      correctOutcome: false,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    // Update UI
    btnElement.textContent = `✅ ${homeScore}‑${awayScore} Saved`;
    btnElement.style.background = "linear-gradient(90deg, #059669, #047857)";

    // Disable inputs
    const card = btnElement.closest(".odds-card");
    card.querySelectorAll(".predict-score-input").forEach(inp => inp.disabled = true);

    showGlobalMsg("✅ Prediction saved! Check the leaderboard.", "success");

    // Refresh leaderboard
    await loadLeaderboard();
  } catch (err) {
    console.error("Prediction save error:", err);
    showGlobalMsg("Failed to save prediction. Please try again.", "error");
    btnElement.disabled = false;
    btnElement.textContent = "Submit Prediction";
  }
}

// ===== LOAD EXISTING PREDICTIONS =====
async function loadUserPredictions() {
  if (!currentUser) return;

  try {
    const predictionsRef = collection(db, "predictions");
    const q = query(predictionsRef, where("userId", "==", currentUser.uid));
    const snapshot = await getDocs(q);

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const fixtureId = data.fixtureId;

      // Find the card and populate
      if (fixtureId) {
        const card = fixturesContainer?.querySelector(`.odds-card[data-fixture-id="${fixtureId}"]`);
        if (card) {
          const homeInput = card.querySelector(".home-score");
          const awayInput = card.querySelector(".away-score");
          const btn = card.querySelector(".submit-prediction-btn");

          if (homeInput) homeInput.value = data.homeScore;
          if (awayInput) awayInput.value = data.awayScore;
          if (homeInput) homeInput.disabled = true;
          if (awayInput) awayInput.disabled = true;
          if (btn) {
            btn.textContent = `✅ ${data.homeScore}‑${data.awayScore} Saved`;
            btn.disabled = true;
            btn.style.background = "linear-gradient(90deg, #059669, #047857)";
          }
        }
      }
    });
  } catch (err) {
    console.warn("Could not load user predictions:", err);
  }
}

// ===== LEADERBOARD =====
async function loadLeaderboard() {
  if (!leaderboardContainer) return;

  try {
    const predictionsRef = collection(db, "predictions");
    const snapshot = await getDocs(predictionsRef);

    // Aggregate predictions by user
    const userStats = {};

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data.userId) return;

      if (!userStats[data.userId]) {
        userStats[data.userId] = {
          userId: data.userId,
          userName: data.userName || "Anonymous",
          userUniqueId: data.userUniqueId || "",
          totalPredictions: 0,
          points: 0,
          exactMatches: 0,
          correctOutcomes: 0
        };
      }

      userStats[data.userId].totalPredictions++;
      userStats[data.userId].points += data.points || 0;
      if (data.exactMatch) userStats[data.userId].exactMatches++;
      if (data.correctOutcome) userStats[data.userId].correctOutcomes++;
    });

    // Sort by points descending
    const sortedUsers = Object.values(userStats).sort((a, b) => b.points - a.points);

    // Also add mock users to fill the leaderboard visually
    const mockTopUsers = [
      { userName: "Alex M.", userUniqueId: "#GFHF-A1B2", totalPredictions: 15, points: 42, exactMatches: 8, correctOutcomes: 6 },
      { userName: "Sarah K.", userUniqueId: "#GFHF-C3D4", totalPredictions: 14, points: 38, exactMatches: 6, correctOutcomes: 8 },
      { userName: "Marco R.", userUniqueId: "#GFHF-E5F6", totalPredictions: 13, points: 35, exactMatches: 5, correctOutcomes: 7 },
      { userName: "Yuki T.", userUniqueId: "#GFHF-G7H8", totalPredictions: 12, points: 31, exactMatches: 4, correctOutcomes: 6 },
      { userName: "Emma W.", userUniqueId: "#GFHF-I9J0", totalPredictions: 11, points: 28, exactMatches: 3, correctOutcomes: 5 }
    ];

    // Only show mock users if there are no real predictions yet
    let displayUsers = sortedUsers;
    if (displayUsers.length === 0) {
      displayUsers = mockTopUsers.map(u => ({ ...u, userId: `mock_${Math.random()}` }));
    }

    // Highlight current user
    const currentUserId = currentUser?.uid;

    // Build unique ID for current user in leaderboard
    let displayUniqueId = currentUserUniqueId || "";

    if (leaderboardContainer) {
      leaderboardContainer.innerHTML = `
        <div class="leaderboard-table">
          <div class="leaderboard-header">
            <span>#</span>
            <span>Player</span>
            <span>Pts</span>
            <span>Exact</span>
            <span>Total</span>
          </div>
          ${displayUsers.map((user, i) => {
            const isYou = user.userId === currentUserId;
            const winRate = user.totalPredictions > 0 ? Math.round((user.exactMatches / user.totalPredictions) * 100) : 0;
            const rank = i + 1;
            const rankDisplay = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
            const displayName = isYou ? `${user.userName} (You)` : user.userName;
            const uniqueId = isYou && displayUniqueId ? displayUniqueId : (user.userUniqueId || "");
            return `
              <div class="leaderboard-row ${isYou ? "leaderboard-you" : ""}">
                <span class="leaderboard-rank">${rankDisplay}</span>
                <span class="leaderboard-name">
                  <strong>${displayName}</strong>
                  ${uniqueId ? `<span style="display:block;font-size:11px;color:rgba(255,255,255,0.5);">${uniqueId}</span>` : ''}
                </span>
                <span class="leaderboard-pts"><strong>${user.points}</strong></span>
                <span class="leaderboard-exact">${user.exactMatches}</span>
                <span class="leaderboard-winrate">${winRate}%</span>
              </div>
            `;
          }).join("")}
        </div>
        <div class="leaderboard-legend">
          <p>+3 pts exact score · +1 pt correct outcome · Predict more to climb!</p>
          ${currentUser ? `<p style="margin-top:8px;font-size:13px;color:rgba(255,255,255,0.5);">Your Unique ID: <strong style="color:#00c853;">${displayUniqueId || 'Set in Dashboard'}</strong></p>` : ''}
        </div>
      `;
    }
  } catch (err) {
    console.error("Leaderboard load error:", err);
    if (leaderboardContainer) {
      leaderboardContainer.innerHTML = '<div class="admin-error">Failed to load leaderboard.</div>';
    }
  }
}

// ===== FETCH UPCOMING FIXTURES =====
async function fetchFixtures() {
  if (!fixturesContainer) return;

  let fixtures = [];

  // Try to fetch from API-Football first
  try {
    const response = await fetch("https://v3.football.api-sports.io/fixtures?date=" + new Date().toISOString().split("T")[0], {
      method: "GET",
      headers: {
        "x-rapidapi-host": "v3.football.api-sports.io",
        "x-rapidapi-key": "6e2987eec8066be0a986f648fe4a9cf7"
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.response && data.response.length > 0) {
        fixtures = data.response.slice(0, 8).map(m => ({
          id: `api_${m.fixture.id}`,
          league: m.league?.name || "International",
          homeTeam: m.teams?.home?.name || "Home",
          awayTeam: m.teams?.away?.name || "Away",
          date: m.fixture?.date || new Date().toISOString(),
          status: "upcoming"
        }));
      }
    }
  } catch (err) {
    console.warn("API fetch failed, using mock fixtures:", err.message);
  }

  // Fallback to mock
  if (fixtures.length === 0) {
    fixtures = MOCK_FIXTURES;
  }

  renderFixtures(fixtures);

  // Load existing predictions for the user
  if (currentUser) {
    await loadUserPredictions();
  }
}

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    currentUserName = user.displayName || user.email?.split("@")[0] || "Anonymous";

    // Load user's unique ID from Firestore
    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        currentUserUniqueId = data.uniqueId || "";
        currentUserName = data.displayName || data.firstName || currentUserName;
      }
    } catch (err) {
      console.warn("Could not load user profile:", err);
    }

    if (userStatus) {
      userStatus.textContent = `Signed in as ${currentUserName} ${currentUserUniqueId ? `· ${currentUserUniqueId}` : ''}`;
    }
  } else {
    currentUserUniqueId = null;
    currentUserName = "Guest";
    if (userStatus) {
      userStatus.textContent = "Sign in to make predictions!";
    }
  }

  // Load fixtures and leaderboard
  await fetchFixtures();
  await loadLeaderboard();
});

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  // If auth is already loaded, the onAuthStateChanged will handle it
});

// Also run on load
window.addEventListener("load", () => {
  if (fixturesContainer && fixturesContainer.innerHTML.includes("Loading")) {
    fetchFixtures();
    loadLeaderboard();
  }
});

