/**
 * GFHF Live Odds & Match Prediction Module
 * Fetches live odds from The Odds API → fallback to mock data
 * Score prediction game with localStorage persistence + leaderboard
 */

const ODDS_API_KEY = "0ac4c6b9cc83ba958211e05c0acdbb44";
const ODDS_URL = `https://api.the-odds-api.com/v4/sports/upcoming/odds/?regions=us,uk&markets=h2h&apiKey=${ODDS_API_KEY}`;

const PREDICTIONS_KEY = "gfhf_score_predictions";
const LEADERBOARD_KEY = "gfhf_prediction_leaderboard";

// DOM refs
const oddsContainer = document.getElementById("oddsContainer");
const oddsStatus = document.getElementById("oddsStatus");
const oddsLeaderboard = document.getElementById("oddsLeaderboard");

// ===== MOCK FALLBACK DATA =====
const MOCK_MATCHES = [
  {
    id: "mock_1",
    sport_title: "Football",
    home_team: "Manchester City",
    away_team: "Arsenal",
    commence_time: new Date(Date.now() + 86400000 * 2).toISOString(),
    bookmakers: [{ markets: [{ outcomes: [
      { name: "Manchester City", price: 1.85 },
      { name: "Draw", price: 3.40 },
      { name: "Arsenal", price: 4.20 }
    ]}]}]
  },
  {
    id: "mock_2",
    sport_title: "Football",
    home_team: "Barcelona",
    away_team: "Real Madrid",
    commence_time: new Date(Date.now() + 86400000 * 3).toISOString(),
    bookmakers: [{ markets: [{ outcomes: [
      { name: "Barcelona", price: 2.30 },
      { name: "Draw", price: 3.20 },
      { name: "Real Madrid", price: 3.10 }
    ]}]}]
  },
  {
    id: "mock_3",
    sport_title: "Football",
    home_team: "Bayern Munich",
    away_team: "Borussia Dortmund",
    commence_time: new Date(Date.now() + 86400000).toISOString(),
    bookmakers: [{ markets: [{ outcomes: [
      { name: "Bayern Munich", price: 1.55 },
      { name: "Draw", price: 4.00 },
      { name: "Borussia Dortmund", price: 5.50 }
    ]}]}]
  },
  {
    id: "mock_4",
    sport_title: "Football",
    home_team: "PSG",
    away_team: "Marseille",
    commence_time: new Date(Date.now() + 86400000 * 4).toISOString(),
    bookmakers: [{ markets: [{ outcomes: [
      { name: "PSG", price: 1.40 },
      { name: "Draw", price: 4.50 },
      { name: "Marseille", price: 6.00 }
    ]}]}]
  },
  {
    id: "mock_5",
    sport_title: "Basketball",
    home_team: "LA Lakers",
    away_team: "Boston Celtics",
    commence_time: new Date(Date.now() + 86400000 * 1.5).toISOString(),
    bookmakers: [{ markets: [{ outcomes: [
      { name: "LA Lakers", price: 2.10 },
      { name: "Draw", price: 0 },
      { name: "Boston Celtics", price: 1.80 }
    ]}]}]
  },
  {
    id: "mock_6",
    sport_title: "Football",
    home_team: "Liverpool",
    away_team: "Chelsea",
    commence_time: new Date(Date.now() + 86400000 * 5).toISOString(),
    bookmakers: [{ markets: [{ outcomes: [
      { name: "Liverpool", price: 2.05 },
      { name: "Draw", price: 3.50 },
      { name: "Chelsea", price: 3.60 }
    ]}]}]
  }
];

// ===== MOCK LEADERBOARD =====
const MOCK_LEADERBOARD_USERS = [
  { name: "Alex M.", points: 42, exact: 8, played: 15 },
  { name: "Sarah K.", points: 38, exact: 6, played: 14 },
  { name: "Marco R.", points: 35, exact: 5, played: 13 },
  { name: "Yuki T.", points: 31, exact: 4, played: 12 },
  { name: "Emma W.", points: 28, exact: 3, played: 11 },
  { name: "Carlos D.", points: 25, exact: 2, played: 10 },
  { name: "Aisha N.", points: 22, exact: 2, played: 9 },
  { name: "David L.", points: 18, exact: 1, played: 8 }
];

// ===== HELPERS =====
function formatMatchDate(dateStr) {
  if (!dateStr) return "TBD";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch { return dateStr; }
}

function getSavedPredictions() {
  try {
    return JSON.parse(localStorage.getItem(PREDICTIONS_KEY) || "{}");
  } catch { return {}; }
}

function savePrediction(matchId, homeScore, awayScore) {
  const predictions = getSavedPredictions();
  predictions[matchId] = {
    homeScore: parseInt(homeScore, 10) || 0,
    awayScore: parseInt(awayScore, 10) || 0,
    submittedAt: new Date().toISOString()
  };
  localStorage.setItem(PREDICTIONS_KEY, JSON.stringify(predictions));
}

// ===== RENDER ODDS CARDS =====
function renderOddsCards(matches) {
  if (!oddsContainer) return;
  const predictions = getSavedPredictions();

  if (!matches || matches.length === 0) {
    oddsContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;"><p style="padding:40px 0;color:#64748b;">No upcoming matches available.</p></div>';
    return;
  }

  oddsContainer.innerHTML = matches.map((match) => {
    const matchId = match.id;
    const homeTeam = match.home_team || "Home";
    const awayTeam = match.away_team || "Away";
    const matchTime = formatMatchDate(match.commence_time);
    const sportIcon = match.sport_title?.toLowerCase().includes("basket") ? "🏀" : "⚽";

    // Extract odds from bookmaker
    let homeOdds = "-", drawOdds = "-", awayOdds = "-";
    if (match.bookmakers && match.bookmakers.length > 0) {
      const market = match.bookmakers[0]?.markets?.[0];
      if (market?.outcomes) {
        market.outcomes.forEach((outcome) => {
          if (outcome.name === homeTeam) homeOdds = outcome.price?.toFixed(2);
          else if (outcome.name === awayTeam) awayOdds = outcome.price?.toFixed(2);
          else if (outcome.name === "Draw") drawOdds = outcome.price?.toFixed(2);
        });
      }
    }

    // Check saved prediction
    const saved = predictions[matchId] || {};
    const savedHome = saved.homeScore ?? "";
    const savedAway = saved.awayScore ?? "";

    return `
      <div class="card odds-card" data-match-id="${matchId}">
        <div class="odds-header">
          <span class="league-pill">${sportIcon} ${match.sport_title || "Sports"}</span>
          <span class="odds-time">📅 ${matchTime}</span>
        </div>
        <div class="odds-teams">
          <div class="odds-team">${homeTeam}</div>
          <div class="odds-vs">vs</div>
          <div class="odds-team">${awayTeam}</div>
        </div>
        <div class="odds-prices">
          <div class="odds-price ${homeOdds > 0 && homeOdds < 2.0 ? 'odds-fav' : ''}">
            <span class="odds-label">Home</span>
            <span class="odds-value">${homeOdds !== "-" ? homeOdds : "-"}</span>
          </div>
          <div class="odds-price ${drawOdds > 0 && drawOdds < 2.5 ? 'odds-fav' : ''}">
            <span class="odds-label">Draw</span>
            <span class="odds-value">${drawOdds !== "-" ? drawOdds : "-"}</span>
          </div>
          <div class="odds-price ${awayOdds > 0 && awayOdds < 2.0 ? 'odds-fav' : ''}">
            <span class="odds-label">Away</span>
            <span class="odds-value">${awayOdds !== "-" ? awayOdds : "-"}</span>
          </div>
        </div>
        <div class="odds-prediction-form">
          <div class="predict-label">🎯 Predict Score</div>
          <div class="predict-inputs">
            <div class="predict-team">
              <span class="predict-team-name">${homeTeam}</span>
              <input type="number" class="predict-score-input home-score" min="0" max="20" value="${savedHome}" placeholder="0" ${savedHome !== "" ? "disabled" : ""}>
            </div>
            <span class="predict-dash">-</span>
            <div class="predict-team">
              <span class="predict-team-name">${awayTeam}</span>
              <input type="number" class="predict-score-input away-score" min="0" max="20" value="${savedAway}" placeholder="0" ${savedAway !== "" ? "disabled" : ""}>
            </div>
          </div>
          <button class="btn submit-prediction-btn" data-match-id="${matchId}" ${savedHome !== "" ? "disabled" : ""}>
            ${savedHome !== "" ? `✅ ${savedHome}‑${savedAway} Saved` : "Submit Prediction"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Attach prediction submit handlers
  oddsContainer.querySelectorAll(".submit-prediction-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const matchId = btn.dataset.matchId;
      const card = btn.closest(".odds-card");
      const homeInput = card.querySelector(".home-score");
      const awayInput = card.querySelector(".away-score");
      const homeVal = homeInput.value.trim();
      const awayVal = awayInput.value.trim();

      if (!homeVal || !awayVal) {
        setOddsStatus("Please enter both scores.", true);
        return;
      }

      const homeNum = parseInt(homeVal, 10);
      const awayNum = parseInt(awayVal, 10);
      if (isNaN(homeNum) || isNaN(awayNum) || homeNum < 0 || awayNum < 0 || homeNum > 20 || awayNum > 20) {
        setOddsStatus("Enter valid scores (0-20).", true);
        return;
      }

      savePrediction(matchId, homeNum, awayNum);
      setOddsStatus(`✅ Prediction saved: ${homeNum} - ${awayNum}`);
      renderOddsCards(getCurrentMatches());
      renderLeaderboard();
    });
  });
}

let currentMatches = [];

function getCurrentMatches() {
  return currentMatches;
}

function setOddsStatus(message, isError = false) {
  if (!oddsStatus) return;
  oddsStatus.textContent = message;
  oddsStatus.style.color = isError ? "#b42318" : "#4b5563";
}

// ===== LEADERBOARD =====
function renderLeaderboard() {
  if (!oddsLeaderboard) return;

  // Combine localStorage predictions with mock leaderboard
  const predictions = getSavedPredictions();
  const userPredCount = Object.keys(predictions).length;

  let combined = [...MOCK_LEADERBOARD_USERS];

  // Add current user if they made predictions
  if (userPredCount > 0) {
    const userName = "You";
    const exactMatches = Math.floor(Math.random() * 3); // Simulated
    const totalPlayed = userPredCount;
    const points = exactMatches * 3 + (totalPlayed - exactMatches) * 1;
    combined.push({ name: userName, points, exact: exactMatches, played: totalPlayed });
  }

  // Sort by points descending
  combined.sort((a, b) => b.points - a.points);

  // Keep top 10
  combined = combined.slice(0, 10);

  oddsLeaderboard.innerHTML = `
    <div class="leaderboard-table">
      <div class="leaderboard-header">
        <span>#</span>
        <span>Player</span>
        <span>Pts</span>
        <span>Exact</span>
        <span>Win%</span>
      </div>
      ${combined.map((user, i) => {
        const winRate = user.played > 0 ? Math.round((user.exact / user.played) * 100) : 0;
        const isYou = user.name === "You";
        return `
          <div class="leaderboard-row ${isYou ? "leaderboard-you" : ""}">
            <span class="leaderboard-rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</span>
            <span class="leaderboard-name"><strong>${user.name}</strong></span>
            <span class="leaderboard-pts"><strong>${user.points}</strong></span>
            <span class="leaderboard-exact">${user.exact}</span>
            <span class="leaderboard-winrate">${winRate}%</span>
          </div>
        `;
      }).join("")}
    </div>
    <div class="leaderboard-legend">
      <p>+3 pts exact score · +1 pt correct outcome</p>
    </div>
  `;
}

// ===== FETCH ODDS =====
async function fetchOdds() {
  if (!oddsContainer) return;
  setOddsStatus("Loading odds...");
  oddsContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;"><p style="padding:40px 0;">⏳ Fetching live odds...</p></div>';

  let matches = [];

  // Primary: The Odds API
  try {
    const response = await fetch(ODDS_URL, { method: "GET" });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Odds API ${response.status}: ${errText}`);
    }
    const data = await response.json();
    matches = data || [];
    // Filter to only football/soccer
    matches = matches.filter(m =>
      m.sport_title?.toLowerCase().includes("football") ||
      m.sport_title?.toLowerCase().includes("soccer") ||
      m.sport_title?.toLowerCase().includes("basket")
    );
    // Limit to 8
    matches = matches.slice(0, 8);
  } catch (apiError) {
    console.warn("Odds API failed, using mock data:", apiError.message);
    setOddsStatus("Using mock odds data (API unavailable)");
  }

  // Fallback to mock if no matches
  if (matches.length === 0) {
    matches = MOCK_MATCHES;
    setOddsStatus("Showing mock match odds for demo");
  } else {
    setOddsStatus(`Loaded ${matches.length} matches`);
  }

  currentMatches = matches;
  renderOddsCards(matches);
  renderLeaderboard();
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  fetchOdds();
});
