/**
 * GFHF Match Prediction League Module (REBUILT)
 * - Fetches 10 upcoming fixtures (API + dynamic fallback)
 * - Users select Winner (1/X/2) + Total Goals per match
 * - Minimum 7 selections required to submit a slip
 * - Settlement engine rewards 2 HP for >=6 correct predictions
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, getDocs, addDoc, collection, query, where, orderBy, updateDoc, increment, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHPBadgeHTML, getUserHP } from "./rewards.js";

// ===== DOM REFS =====
const fixturesContainer = document.getElementById("predictionFixtures");
const leaderboardContainer = document.getElementById("predictionLeaderboard");
const userStatus = document.getElementById("predictionUserStatus");
const globalMsg = document.getElementById("predictionGlobalMsg");
const slipBanner = document.getElementById("slipBanner");
const slipCount = document.getElementById("slipCount");
const slipProgress = document.getElementById("slipProgress");
const slipSubmitBtn = document.getElementById("slipSubmitBtn");
const slipHistoryContainer = document.getElementById("slipHistory");

// ===== STATE =====
let currentUser = null;
let currentUserUniqueId = null;
let currentUserName = "Guest";
let fixtures = [];
let userSelections = {}; // { [fixtureId]: { winner: "1"|"X"|"2"|null, totalGoals: "over1.5"|"over2.5"|"under2.5"|"exact"|null, exactGoals: number|null } }
let isSubmitting = false;

// ===== 10 FALLBACK FIXTURES (dynamic dates) =====
function generateFallbackFixtures() {
  const now = Date.now();
  const DAY = 86400000;
  const teams = [
    { league: "Premier League", home: "Arsenal", away: "Chelsea" },
    { league: "La Liga", home: "Barcelona", away: "Real Madrid" },
    { league: "Serie A", home: "Inter Milan", away: "AC Milan" },
    { league: "Bundesliga", home: "Bayern Munich", away: "Borussia Dortmund" },
    { league: "Ligue 1", home: "PSG", away: "Marseille" },
    { league: "Premier League", home: "Liverpool", away: "Manchester City" },
    { league: "Premier League", home: "Manchester United", away: "Tottenham" },
    { league: "La Liga", home: "Atletico Madrid", away: "Sevilla" },
    { league: "Serie A", home: "Juventus", away: "AS Roma" },
    { league: "Premier League", home: "Newcastle", away: "Aston Villa" },
  ];
  return teams.map((t, i) => ({
    id: `fixture_${i + 1}`,
    league: t.league,
    homeTeam: t.home,
    awayTeam: t.away,
    date: new Date(now + (i + 1) * DAY).toISOString(),
    status: "upcoming"
  }));
}

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

function showGlobalMsg(text, type = "success") {
  if (!globalMsg) return;
  globalMsg.textContent = text;
  globalMsg.className = `message ${type}`;
  globalMsg.style.display = "block";
  setTimeout(() => { globalMsg.style.display = "none"; }, 4000);
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ===== SELECTION COUNT =====
function getSelectedCount() {
  return Object.keys(userSelections).filter(fid => {
    const s = userSelections[fid];
    return s && s.winner !== null && s.totalGoals !== null;
  }).length;
}

function canSubmitSlip() {
  return getSelectedCount() >= 7;
}

// ===== SLIP BANNER UPDATE =====
function updateSlipBanner() {
  if (!slipBanner || !slipCount || !slipProgress || !slipSubmitBtn) return;
  const count = getSelectedCount();
  slipCount.textContent = `${count}/10`;
  const pct = Math.min(100, Math.round((count / 10) * 100));
  slipProgress.style.width = `${pct}%`;
  slipProgress.textContent = `${pct}%`;
  const ready = canSubmitSlip();
  slipSubmitBtn.disabled = !ready || isSubmitting;
  slipSubmitBtn.textContent = isSubmitting ? "⏳ Submitting..." : ready
    ? `📋 Submit ${count} Predictions`
    : `📋 Select ${7 - count} more matches`;
  if (ready) {
    slipSubmitBtn.style.background = "linear-gradient(90deg, #00c853, #00b34a)";
  } else {
    slipSubmitBtn.style.background = "linear-gradient(90deg, #64748b, #475569)";
  }
}

// ===== RENDER FIXTURES =====
function renderFixtures(fixturesList) {
  if (!fixturesContainer) return;

  if (!fixturesList || fixturesList.length === 0) {
    fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">No upcoming fixtures available.</p></div>';
    return;
  }

  let html = '';
  fixturesList.forEach((match) => {
    const fid = match.id;
    const sel = userSelections[fid] || { winner: null, totalGoals: null, exactGoals: null };
    const selectionClass = (sel.winner !== null || sel.totalGoals !== null) ? ' odds-card-selected' : '';

    html += `
      <div class="odds-card${selectionClass}" data-fixture-id="${fid}">
        <div class="odds-header">
          <span class="league-pill">⚽ ${escapeHtml(match.league)}</span>
          <span class="odds-time">📅 ${formatDate(match.date)}</span>
        </div>
        <div class="odds-teams">
          <div class="odds-team">${escapeHtml(match.homeTeam)}</div>
          <div class="odds-vs">vs</div>
          <div class="odds-team">${escapeHtml(match.awayTeam)}</div>
        </div>

        <!-- Winner / Result Selection -->
        <div class="prediction-section">
          <div class="prediction-section-label">🎯 Winner / Result</div>
          <div class="winner-buttons">
            <button class="pred-btn winner-btn ${sel.winner === '1' ? 'active' : ''}" data-fixture="${fid}" data-winner="1">
              <span class="pred-btn-label">1</span>
              <span class="pred-btn-team">${escapeHtml(match.homeTeam)}</span>
            </button>
            <button class="pred-btn winner-btn ${sel.winner === 'X' ? 'active' : ''}" data-fixture="${fid}" data-winner="X">
              <span class="pred-btn-label">X</span>
              <span class="pred-btn-team">Draw</span>
            </button>
            <button class="pred-btn winner-btn ${sel.winner === '2' ? 'active' : ''}" data-fixture="${fid}" data-winner="2">
              <span class="pred-btn-label">2</span>
              <span class="pred-btn-team">${escapeHtml(match.awayTeam)}</span>
            </button>
          </div>
        </div>

        <!-- Total Goals Selection -->
        <div class="prediction-section">
          <div class="prediction-section-label">⚽ Total Goals</div>
          <div class="goals-buttons">
            <button class="pred-btn goals-btn ${sel.totalGoals === 'over1.5' ? 'active' : ''}" data-fixture="${fid}" data-goals="over1.5">Over 1.5</button>
            <button class="pred-btn goals-btn ${sel.totalGoals === 'over2.5' ? 'active' : ''}" data-fixture="${fid}" data-goals="over2.5">Over 2.5</button>
            <button class="pred-btn goals-btn ${sel.totalGoals === 'under2.5' ? 'active' : ''}" data-fixture="${fid}" data-goals="under2.5">Under 2.5</button>
            <button class="pred-btn goals-btn ${sel.totalGoals === 'exact' ? 'active' : ''}" data-fixture="${fid}" data-goals="exact">Exact</button>
          </div>
          <div class="exact-goals-input" style="display:${sel.totalGoals === 'exact' ? 'flex' : 'none'};margin-top:6px;gap:8px;align-items:center;">
            <span style="font-size:12px;color:rgba(255,255,255,0.6);">Exact goals:</span>
            <input type="number" class="exact-goals-num" data-fixture="${fid}" min="0" max="20" value="${sel.exactGoals !== null ? sel.exactGoals : ''}" placeholder="e.g. 3" style="width:60px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;text-align:center;font-size:14px;font-weight:700;">
          </div>
        </div>
      </div>
    `;
  });

  fixturesContainer.innerHTML = html;

  // ===== ATTACH EVENT HANDLERS =====

  // Winner buttons
  fixturesContainer.querySelectorAll('.winner-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
      const fid = btn.dataset.fixture;
      const winner = btn.dataset.winner;
      if (!userSelections[fid]) userSelections[fid] = { winner: null, totalGoals: null, exactGoals: null };
      // Toggle: if same winner clicked, deselect
      if (userSelections[fid].winner === winner) {
        userSelections[fid].winner = null;
      } else {
        userSelections[fid].winner = winner;
      }
      // Update card highlight
      const card = btn.closest('.odds-card');
      const sel = userSelections[fid];
      if (sel.winner !== null || sel.totalGoals !== null) {
        card.classList.add('odds-card-selected');
      } else {
        card.classList.remove('odds-card-selected');
      }
      // Update button states
      card.querySelectorAll('.winner-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.winner === userSelections[fid].winner);
      });
      updateSlipBanner();
    });
  });

  // Goals buttons
  fixturesContainer.querySelectorAll('.goals-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser) { document.getElementById("authModal")?.classList.add("auth-modal--open"); return; }
      const fid = btn.dataset.fixture;
      const goals = btn.dataset.goals;
      if (!userSelections[fid]) userSelections[fid] = { winner: null, totalGoals: null, exactGoals: null };
      // Toggle: if same goals clicked, deselect
      if (userSelections[fid].totalGoals === goals) {
        userSelections[fid].totalGoals = null;
        userSelections[fid].exactGoals = null;
      } else {
        userSelections[fid].totalGoals = goals;
        if (goals !== 'exact') userSelections[fid].exactGoals = null;
      }
      // Update card highlight
      const card = btn.closest('.odds-card');
      const sel = userSelections[fid];
      if (sel.winner !== null || sel.totalGoals !== null) {
        card.classList.add('odds-card-selected');
      } else {
        card.classList.remove('odds-card-selected');
      }
      // Update button states
      card.querySelectorAll('.goals-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.goals === userSelections[fid].totalGoals);
      });
      // Show/hide exact goals input
      const exactDiv = card.querySelector('.exact-goals-input');
      if (exactDiv) {
        exactDiv.style.display = userSelections[fid].totalGoals === 'exact' ? 'flex' : 'none';
      }
      updateSlipBanner();
    });
  });

  // Exact goals number input
  fixturesContainer.querySelectorAll('.exact-goals-num').forEach(input => {
    input.addEventListener('input', () => {
      const fid = input.dataset.fixture;
      const val = input.value.trim();
      if (userSelections[fid]) {
        userSelections[fid].exactGoals = val !== '' ? parseInt(val, 10) : null;
      }
    });
  });
}

// ===== SUBMIT SLIP =====
async function submitSlip() {
  if (!currentUser) { showGlobalMsg("Please sign in first.", "error"); return; }
  if (isSubmitting) return;
  if (!canSubmitSlip()) { showGlobalMsg("Select at least 7 matches with both winner and total goals.", "error"); return; }

  // Validate all selected entries have both winner and total goals
  const selectedFixtures = Object.keys(userSelections).filter(fid => {
    const s = userSelections[fid];
    return s && s.winner !== null && s.totalGoals !== null;
  });

  if (selectedFixtures.length < 7) {
    showGlobalMsg("Select at least 7 matches with both winner and total goals.", "error");
    return;
  }

  // Build selections array
  const selections = selectedFixtures.map(fid => {
    const match = fixtures.find(f => f.id === fid);
    const s = userSelections[fid];
    return {
      fixtureId: fid,
      homeTeam: match ? match.homeTeam : "Home",
      awayTeam: match ? match.awayTeam : "Away",
      league: match ? match.league : "",
      winner: s.winner,
      totalGoals: s.totalGoals,
      exactGoals: s.totalGoals === 'exact' ? s.exactGoals : null
    };
  });

  isSubmitting = true;
  slipSubmitBtn.disabled = true;
  slipSubmitBtn.textContent = "⏳ Submitting...";

  try {
    await addDoc(collection(db, "prediction_slips"), {
      userId: currentUser.uid,
      userName: currentUserName,
      userUniqueId: currentUserUniqueId || "",
      selections: selections,
      totalMatches: selections.length,
      correctCount: 0,
      status: "pending",
      rewarded: false,
      createdAt: serverTimestamp()
    });

    showGlobalMsg(`✅ Prediction slip submitted! ${selections.length} predictions saved. Good luck!`, "success");

    // Clear selections
    userSelections = {};
    updateSlipBanner();
    renderFixtures(fixtures);

    // Refresh slip history
    loadSlipHistory();
  } catch (err) {
    console.error("Slip submit error:", err);
    showGlobalMsg("Failed to submit slip. Try again.", "error");
  } finally {
    isSubmitting = false;
    updateSlipBanner();
  }
}

// ===== SETTLEMENT ENGINE =====
/**
 * Mock results for settlement - in production, fetch from fixture_results/{fixtureId}
 */
function getMockResult(fixtureId) {
  // Use deterministic but varied results based on fixture ID
  const hash = fixtureId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const homeScore = hash % 5; // 0-4
  const awayScore = (hash * 3) % 4; // 0-3
  return { homeScore, awayScore };
}

/**
 * Determine winner from scores
 */
function getScoreWinner(home, away) {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

/**
 * Determine total goals category
 */
function getGoalsCategory(home, away) {
  const total = home + away;
  if (total > 2.5) return "over2.5";
  if (total > 1.5) return "over1.5";
  return "under2.5";
}

/**
 * Settle a single prediction slip
 */
async function settleSlip(slipDoc) {
  const slip = slipDoc.data();
  const slipId = slipDoc.id;

  if (slip.status !== "pending" || slip.rewarded) return;

  let correctCount = 0;
  const results = [];

  slip.selections.forEach(sel => {
    const result = getMockResult(sel.fixtureId);
    const correctWinner = getScoreWinner(result.homeScore, result.awayScore);
    const correctGoals = getGoalsCategory(result.homeScore, result.awayScore);

    let winnerCorrect = sel.winner === correctWinner;
    let goalsCorrect = sel.totalGoals === 'exact'
      ? (result.homeScore + result.awayScore) === sel.exactGoals
      : sel.totalGoals === correctGoals;

    if (winnerCorrect && goalsCorrect) {
      correctCount++;
    }

    results.push({
      fixtureId: sel.fixtureId,
      homeTeam: sel.homeTeam,
      awayTeam: sel.awayTeam,
      actualScore: `${result.homeScore}-${result.awayScore}`,
      winnerCorrect,
      goalsCorrect
    });
  });

  const totalMatches = slip.selections.length;
  const rewarded = correctCount >= 6 && totalMatches >= 7;

  try {
    // Update slip status
    await updateDoc(doc(db, "prediction_slips", slipId), {
      status: "settled",
      correctCount,
      results,
      settledAt: serverTimestamp(),
      rewarded
    });

    // Award HP if qualified
    if (rewarded) {
      await updateDoc(doc(db, "users", slip.userId), {
        hopePoints: increment(2)
      });

      // Record in point_history
      try {
        await addDoc(collection(db, "point_history"), {
          userId: slip.userId,
          points: 2,
          type: "earned",
          reason: `🏆 Prediction Reward: ${correctCount}/${totalMatches} correct!`,
          slipId,
          timestamp: serverTimestamp()
        });
      } catch (e) { console.warn("Could not log point history:", e); }
    }

    return { slipId, correctCount, totalMatches, rewarded };
  } catch (err) {
    console.error("Settlement error for slip", slipId, err);
    return null;
  }
}

/**
 * Check and settle all pending slips (called on page load)
 */
async function settleAllPendingSlips() {
  try {
    const q = query(
      collection(db, "prediction_slips"),
      where("status", "==", "pending"),
      limit(50)
    );
    const snap = await getDocs(q);
    const results = [];
    for (const docSnap of snap.docs) {
      const result = await settleSlip(docSnap);
      if (result) results.push(result);
    }
    if (results.length > 0) {
      const rewarded = results.filter(r => r.rewarded);
      if (rewarded.length > 0) {
        showGlobalMsg(`🏆 ${rewarded.length} slip(s) rewarded! Check your HP balance.`, "success");
      }
      loadSlipHistory();
      loadLeaderboard();
    }
  } catch (err) {
    console.warn("Settlement check error:", err);
  }
}

// ===== LOAD SLIP HISTORY =====
async function loadSlipHistory() {
  if (!slipHistoryContainer || !currentUser) return;

  try {
    const q = query(
      collection(db, "prediction_slips"),
      where("userId", "==", currentUser.uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No prediction slips yet. Select 7+ matches and submit!</p>';
      return;
    }

    let html = '';
    snap.docs.forEach(docSnap => {
      const slip = docSnap.data();
      const timestamp = slip.createdAt?.toMillis ? slip.createdAt.toMillis() : Date.now();
      const dateStr = new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const statusIcon = slip.status === 'settled' ? (slip.rewarded ? '✅' : '❌') : '⏳';
      const rewardText = slip.rewarded ? ' +2 HP 🏆' : '';

      html += `
        <div class="slip-history-item">
          <div class="slip-history-header">
            <span>${statusIcon} <strong>${slip.totalMatches} predictions</strong></span>
            <span style="font-size:12px;color:rgba(255,255,255,0.5);">${dateStr}</span>
          </div>
          <div style="font-size:13px;color:rgba(255,255,255,0.7);">
            Status: ${slip.status === 'settled' ? `Settled (${slip.correctCount || 0}/${slip.totalMatches} correct)${rewardText}` : 'Pending ⏳'}
          </div>
        </div>
      `;
    });

    slipHistoryContainer.innerHTML = html;
  } catch (err) {
    console.warn("Could not load slip history:", err);
    slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Could not load history.</p>';
  }
}

// ===== FETCH FIXTURES =====
async function fetchFixtures() {
  if (!fixturesContainer) return;

  let fetchedFixtures = [];

  // Try API-Football
  try {
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
      method: "GET",
      headers: {
        "x-rapidapi-host": "v3.football.api-sports.io",
        "x-rapidapi-key": "6e2987eec8066be0a986f648fe4a9cf7"
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.response && data.response.length > 0) {
        fetchedFixtures = data.response.slice(0, 10).map(m => ({
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
    console.warn("API fetch failed, using fallback fixtures:", err.message);
  }

  // Fallback
  if (fetchedFixtures.length === 0) {
    fetchedFixtures = generateFallbackFixtures();
  }

  fixtures = fetchedFixtures;
  renderFixtures(fixtures);
  updateSlipBanner();
}

// ===== LEADERBOARD =====
async function loadLeaderboard() {
  if (!leaderboardContainer) return;

  try {
    // Aggregate from settled, rewarded prediction_slips
    const q = query(
      collection(db, "prediction_slips"),
      where("rewarded", "==", true),
      limit(100)
    );
    const snap = await getDocs(q);

    const userRewards = {};
    snap.docs.forEach(docSnap => {
      const slip = docSnap.data();
      if (!slip.userId) return;
      if (!userRewards[slip.userId]) {
        userRewards[slip.userId] = {
          userId: slip.userId,
          userName: slip.userName || "Anonymous",
          userUniqueId: slip.userUniqueId || "",
          totalSlips: 0,
          hpEarned: 0,
          correctTotal: 0,
          matchTotal: 0
        };
      }
      userRewards[slip.userId].totalSlips++;
      userRewards[slip.userId].hpEarned += 2; // Each rewarded slip = 2 HP
      userRewards[slip.userId].correctTotal += slip.correctCount || 0;
      userRewards[slip.userId].matchTotal += slip.totalMatches || 0;
    });

    const sortedUsers = Object.values(userRewards).sort((a, b) => b.hpEarned - a.hpEarned);

    // Fallback mock data if no real data
    let displayUsers = sortedUsers;
    if (displayUsers.length === 0) {
      displayUsers = [
        { userId: "mock_1", userName: "Alex M.", userUniqueId: "#GFHF-A1B2", totalSlips: 5, hpEarned: 8, correctTotal: 28, matchTotal: 40 },
        { userId: "mock_2", userName: "Sarah K.", userUniqueId: "#GFHF-C3D4", totalSlips: 4, hpEarned: 6, correctTotal: 22, matchTotal: 35 },
        { userId: "mock_3", userName: "Marco R.", userUniqueId: "#GFHF-E5F6", totalSlips: 3, hpEarned: 4, correctTotal: 18, matchTotal: 30 },
        { userId: "mock_4", userName: "Yuki T.", userUniqueId: "#GFHF-G7H8", totalSlips: 3, hpEarned: 4, correctTotal: 16, matchTotal: 28 },
        { userId: "mock_5", userName: "Emma W.", userUniqueId: "#GFHF-I9J0", totalSlips: 2, hpEarned: 2, correctTotal: 10, matchTotal: 20 },
      ];
    }

    const currentUserId = currentUser?.uid;
    let displayUniqueId = currentUserUniqueId || "";

    leaderboardContainer.innerHTML = `
      <div class="leaderboard-table">
        <div class="leaderboard-header">
          <span>#</span>
          <span>Player</span>
          <span>HP 🏆</span>
          <span>Slips</span>
          <span>Accuracy</span>
        </div>
        ${displayUsers.map((user, i) => {
          const isYou = user.userId === currentUserId;
          const accuracy = user.matchTotal > 0 ? Math.round((user.correctTotal / user.matchTotal) * 100) : 0;
          const rank = i + 1;
          const rankDisplay = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
          const displayName = isYou ? `${user.userName} (You)` : user.userName;
          const uid = isYou && displayUniqueId ? displayUniqueId : (user.userUniqueId || "");
          return `
            <div class="leaderboard-row ${isYou ? "leaderboard-you" : ""}">
              <span class="leaderboard-rank">${rankDisplay}</span>
              <span class="leaderboard-name">
                <strong>${displayName}</strong>
                ${uid ? `<span style="display:block;font-size:11px;color:rgba(255,255,255,0.5);">${uid}</span>` : ''}
              </span>
              <span class="leaderboard-pts"><strong>${user.hpEarned} HP</strong></span>
              <span class="leaderboard-exact">${user.totalSlips}</span>
              <span class="leaderboard-winrate">${accuracy}%</span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="leaderboard-legend">
        <p>🏆 Get at least 6/10 correct predictions to earn <strong>2 HP</strong> per slip!</p>
        ${currentUser ? `<p style="margin-top:8px;font-size:13px;color:rgba(255,255,255,0.5);">Your ID: <strong style="color:#00c853;">${displayUniqueId || 'Set in Dashboard'}</strong></p>` : ''}
      </div>
    `;
  } catch (err) {
    console.error("Leaderboard error:", err);
    leaderboardContainer.innerHTML = '<div class="admin-error">Failed to load leaderboard.</div>';
  }
}

// ===== LOAD USER PROFILE =====
async function loadUserProfile() {
  if (!currentUser) return;
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const data = userSnap.data();
      currentUserUniqueId = data.uniqueId || "";
      currentUserName = data.displayName || data.firstName || currentUserName;
    }
  } catch (err) {
    console.warn("Could not load user profile:", err);
  }
}

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    currentUserName = user.displayName || user.email?.split("@")[0] || "Anonymous";
    await loadUserProfile();

    if (userStatus) {
      userStatus.textContent = `Signed in as ${currentUserName} ${currentUserUniqueId ? `· ${currentUserUniqueId}` : ''}`;
      userStatus.classList.add("active");
    }

    // Load history
    await loadSlipHistory();

    // Settle any pending slips
    await settleAllPendingSlips();
  } else {
    currentUserUniqueId = null;
    currentUserName = "Guest";
    if (userStatus) {
      userStatus.textContent = "Sign in to make predictions!";
      userStatus.classList.remove("active");
    }
    if (slipHistoryContainer) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    }
  }

  // Load fixtures and leaderboard
  await fetchFixtures();
  await loadLeaderboard();
  updateSlipBanner();
});

// ===== SLIP SUBMIT BUTTON =====
if (slipSubmitBtn) {
  slipSubmitBtn.addEventListener("click", submitSlip);
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  updateSlipBanner();
});

window.addEventListener("load", () => {
  if (fixturesContainer && fixturesContainer.innerHTML.includes("Loading")) {
    fetchFixtures();
    loadLeaderboard();
  }
  updateSlipBanner();
});

