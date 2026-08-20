/**
 * GFHF Prediction League Module
 * ------------------------------
 * Renders match cards from the shared fixtures service
 * (services/fixturesService.js) — the exact same single source of truth used
 * by the Competition page. No local/mock fixture generation is used here.
 *
 * Each card lets a signed-in user submit ONE prediction — Home Win, Draw, or
 * Away Win. Buttons automatically lock as soon as the match goes LIVE, and
 * every prediction is written to Firestore as its own document
 * (`predictions/{fixtureId}_{uid}`), which makes duplicate submissions for
 * the same user + fixture impossible by construction.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, getDocs, collection, query, where, limit,
  updateDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFixturesByDate, getFixturesByIds, subscribeToFixtureUpdates
} from "../services/fixturesService.js";

// ===== DOM REFS (with existence checks) =====
function getEl(id) { return document.getElementById(id); }

const calendarEl = getEl("dateCalendar");
const fixturesContainer = getEl("predictionFixtures");
const leaderboardContainer = getEl("predictionLeaderboard");
const userStatus = getEl("predictionUserStatus");
const globalMsg = getEl("predictionGlobalMsg");
const historyContainer = getEl("predictionHistory");

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserUniqueId = "";

let selectedDateStr = "";
let latestFixtures = [];
let hasLoadedFixturesOnce = false;
/** @type {Map<string, object>} fixture_id -> the signed-in user's prediction doc */
let userPredictions = new Map();
let fixtureFetchInProgress = false;

let pollIntervalId = null;
let liveTickIntervalId = null;
let fixtureUnsubscribe = null;

// ===== CONSTANTS =====
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PICK_LABELS = { home: "Home Win", draw: "Draw", away: "Away Win" };
const PREDICTION_CORRECT_HP = 0.2; // Hope Points awarded for each correct prediction

// ===== HELPER FUNCTIONS =====
function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text ?? "";
  return d.innerHTML;
}

function showGlobalMsg(text, type = "success") {
  if (!globalMsg) return;
  globalMsg.textContent = text;
  globalMsg.className = `message ${type}`;
  globalMsg.style.display = "block";
  setTimeout(() => { globalMsg.style.display = "none"; }, 4000);
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function formatKickoff(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodayStr() {
  return toDateStr(new Date());
}

function isMatchLocked(status) {
  return status === "live" || status === "half_time" || status === "finished";
}

function getMatchOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "draw";
}

// ===== 1. 5-DAY ROLLING CALENDAR =====
function buildCalendar() {
  if (!calendarEl) return;
  const today = new Date();
  calendarEl.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);
    const label = i === 0 ? `Today (${formatDateShort(dateStr)})` : formatDateShort(dateStr);

    const btn = document.createElement("button");
    btn.className = "cal-tab";
    btn.dataset.date = dateStr;
    btn.textContent = `📅 ${label}`;
    btn.style.cssText = `
      padding:10px 18px;border-radius:999px;border:2px solid rgba(255,255,255,0.15);
      background:${selectedDateStr === dateStr ? "#00c853" : "rgba(255,255,255,0.06)"};
      color:${selectedDateStr === dateStr ? "#fff" : "rgba(255,255,255,0.8)"};
      font-weight:700;font-size:13px;cursor:pointer;transition:all 0.2s ease;
    `;

    btn.addEventListener("click", () => {
      calendarEl.querySelectorAll(".cal-tab").forEach(b => {
        b.style.background = "rgba(255,255,255,0.06)";
        b.style.color = "rgba(255,255,255,0.8)";
      });
      btn.style.background = "#00c853";
      btn.style.color = "#fff";
      selectedDateStr = dateStr;
      loadFixturesForDate();
    });

    calendarEl.appendChild(btn);

    // Auto-select first day (today) if none selected
    if (i === 0 && !selectedDateStr) {
      selectedDateStr = dateStr;
      btn.style.background = "#00c853";
      btn.style.color = "#fff";
    }
  }
}

// ===== 2. LOAD THE SIGNED-IN USER'S PREDICTIONS =====
async function loadUserPredictions() {
  userPredictions = new Map();
  if (!currentUser) return;

  try {
    const q = query(collection(db, "predictions"), where("userId", "==", currentUser.uid));
    const snap = await getDocs(q);
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      userPredictions.set(String(data.fixtureId), { id: docSnap.id, ...data });
    });
  } catch (err) {
    console.warn("Could not load user predictions:", err);
  }
}

// ===== 3. RENDER MATCH CARDS =====
function renderFixtures(fixtures) {
  latestFixtures = fixtures || [];
  if (!fixturesContainer) return;

  if (latestFixtures.length === 0) {
    fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">No fixtures available for this date.</p></div>';
    stopLiveTick();
    return;
  }

  fixturesContainer.innerHTML = latestFixtures.map(renderFixtureCard).join("");
  attachPickHandlers();
  startLiveTick();
}

function renderStatusBadge(match) {
  const status = match.status || "scheduled";
  if (status === "live") {
    return `<span class="match-status-badge live">LIVE</span>`;
  }
  if (status === "half_time") {
    return `<span class="match-status-badge ht">HT</span>`;
  }
  if (status === "finished") {
    return `<span class="match-status-badge ft">FT</span>`;
  }
  if (status === "postponed") {
    return `<span class="match-status-badge ft">POSTPONED</span>`;
  }
  return `<span class="match-status-badge" style="background:#f5a623;color:#1a1a1a;">Upcoming</span>`;
}

function renderLiveTimer(match) {
  const status = match.status || "scheduled";
  if (status !== "live" && status !== "half_time") return "";
  const minute = Number(match.minute) || 0;
  return `<span class="match-live-timer" data-status="${status}" data-minute="${minute}" data-tick="0">⏱ ${status === "half_time" ? "HT" : `${minute}'`}</span>`;
}

function renderFixtureCard(match) {
  const fixtureId = match.fixture_id;
  const prediction = userPredictions.get(String(fixtureId));
  const status = match.status || "scheduled";
  const locked = !!prediction || isMatchLocked(status);
  const kickoffLabel = formatKickoff(match.kickoff_time);
  const leagueLogo = match.league_logo || "";
  const homeLogo = match.home_team_logo || "";
  const awayLogo = match.away_team_logo || "";

  const buttons = ["home", "draw", "away"].map((pick) => {
    const isSelected = prediction?.pick === pick;
    const label = pick === "home" ? "1" : pick === "draw" ? "X" : "2";
    const team = pick === "home" ? match.home_team_name : pick === "away" ? match.away_team_name : "Draw";
    return `
      <button class="pred-btn pick-btn${isSelected ? " selected-btn" : ""}" data-fixture="${fixtureId}" data-pick="${pick}" ${locked ? "disabled" : ""}>
        <span class="pred-btn-label">${label}</span>
        <span class="pred-btn-team">${escapeHtml(team)}</span>
      </button>
    `;
  }).join("");

  return `
    <div class="odds-card${prediction ? " odds-card-selected" : ""}" data-fixture-id="${fixtureId}">
      <div class="odds-header">
        <span class="league-pill">${leagueLogo ? `<img src="${escapeHtml(leagueLogo)}" alt="" style="width:18px;height:18px;object-fit:contain;display:inline-block;vertical-align:middle;margin-right:6px;">` : "⚽"} ${escapeHtml(match.league_name || "League")}</span>
        <span class="odds-time">⏰ ${escapeHtml(kickoffLabel || "TBD")}</span>
      </div>
      <div class="odds-teams" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div class="odds-team" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
          ${homeLogo ? `<img src="${escapeHtml(homeLogo)}" alt="" style="width:32px;height:32px;object-fit:contain;">` : ""}
          <span>${escapeHtml(match.home_team_name)}</span>
        </div>
        <div class="odds-vs">vs</div>
        <div class="odds-team" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
          ${awayLogo ? `<img src="${escapeHtml(awayLogo)}" alt="" style="width:32px;height:32px;object-fit:contain;">` : ""}
          <span>${escapeHtml(match.away_team_name)}</span>
        </div>
      </div>
      <div class="prediction-section" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:rgba(255,255,255,0.75);">
        <span style="display:flex;align-items:center;gap:8px;">${renderStatusBadge(match)} ${renderLiveTimer(match)}</span>
        <span>⚽ ${match.home_score ?? 0} - ${match.away_score ?? 0}</span>
      </div>
      <div class="prediction-section">
        <div class="prediction-section-label">🎯 ${prediction ? "Your Prediction" : "Pick the Result"}</div>
        <div class="winner-buttons">
          ${buttons}
        </div>
        ${locked && !prediction ? '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;">🔒 Predictions are locked once the match kicks off.</div>' : ""}
      </div>
    </div>
  `;
}

// ===== 4. LIVE TIMER TICK (cosmetic seconds ticking between polls) =====
function startLiveTick() {
  stopLiveTick();
  liveTickIntervalId = setInterval(() => {
    document.querySelectorAll('.match-live-timer[data-status="live"]').forEach((el) => {
      const minute = Number(el.dataset.minute) || 0;
      const tick = (Number(el.dataset.tick) || 0) + 1;
      el.dataset.tick = String(tick);
      const extraMinutes = Math.floor(tick / 60);
      el.textContent = `⏱ ${minute + extraMinutes}'`;
    });
  }, 1000);
}

function stopLiveTick() {
  if (liveTickIntervalId) {
    clearInterval(liveTickIntervalId);
    liveTickIntervalId = null;
  }
}

// ===== 5. PICK HANDLER — SUBMIT INDIVIDUAL PREDICTION IMMEDIATELY =====
function attachPickHandlers() {
  fixturesContainer.querySelectorAll(".pick-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!currentUser) {
        const authModal = document.getElementById("authModal");
        if (authModal) authModal.classList.add("auth-modal--open");
        return;
      }
      submitPrediction(btn);
    });
  });
}

async function submitPrediction(btn) {
  const fixtureId = String(btn.dataset.fixture);
  const pick = btn.dataset.pick; // 'home' | 'draw' | 'away'
  const match = latestFixtures.find((f) => String(f.fixture_id) === fixtureId);
  if (!match) return;

  if (isMatchLocked(match.status)) {
    showGlobalMsg("This match has already kicked off — predictions are locked.", "error");
    return;
  }

  if (userPredictions.has(fixtureId)) {
    showGlobalMsg("You've already submitted a prediction for this match.", "error");
    return;
  }

  const card = btn.closest(".odds-card");
  if (card) card.querySelectorAll(".pick-btn").forEach((b) => { b.disabled = true; });

  const docId = `${fixtureId}_${currentUser.uid}`;
  const docRef = doc(db, "predictions", docId);

  try {
    // Re-check right before writing to guard against duplicate submissions
    // from another tab/session for the same user + fixture.
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      userPredictions.set(fixtureId, { id: docId, ...existing.data() });
      showGlobalMsg("You've already submitted a prediction for this match.", "error");
      renderFixtures(latestFixtures);
      return;
    }

    const data = {
      userId: currentUser.uid,
      userName: currentUserName,
      fixtureId,
      pick,
      league: match.league_name || "",
      homeTeam: match.home_team_name || "",
      awayTeam: match.away_team_name || "",
      kickoff: match.kickoff_time || null,
      status: "pending",
      pointsAwarded: 0,
      dateSubmitted: getTodayStr(),
      createdAt: serverTimestamp()
    };

    await setDoc(docRef, data);
    userPredictions.set(fixtureId, { id: docId, ...data });

    showGlobalMsg(`✅ Prediction saved: ${PICK_LABELS[pick]}`, "success");
    renderFixtures(latestFixtures);
    loadPredictionHistory();
  } catch (err) {
    console.error("Prediction submit error:", err);
    showGlobalMsg("❌ Failed to save your prediction. Please try again.", "error");
    renderFixtures(latestFixtures);
  }
}

// ===== 6. SETTLEMENT — mark finished matches correct/incorrect & award HP =====
async function settlePendingPredictions() {
  if (!currentUser) return;

  const pending = [...userPredictions.values()].filter((p) => p.status === "pending");
  if (pending.length === 0) return;

  try {
    const fixtures = await getFixturesByIds(pending.map((p) => p.fixtureId));
    let settledCount = 0;

    for (const prediction of pending) {
      const fixture = fixtures.find((f) => String(f.fixture_id) === String(prediction.fixtureId));
      if (!fixture || fixture.status !== "finished") continue;

      const homeScore = Number(fixture.home_score) || 0;
      const awayScore = Number(fixture.away_score) || 0;
      const outcome = getMatchOutcome(homeScore, awayScore);
      const correct = outcome === prediction.pick;

      await updateDoc(doc(db, "predictions", prediction.id), {
        status: correct ? "correct" : "incorrect",
        pointsAwarded: correct ? PREDICTION_CORRECT_HP : 0,
        finalScore: `${homeScore}-${awayScore}`
      });

      if (correct) {
        await updateDoc(doc(db, "users", currentUser.uid), {
          rewardPoints: increment(PREDICTION_CORRECT_HP),
          totalRewardsEarned: increment(PREDICTION_CORRECT_HP)
        });
      }

      settledCount++;
    }

    if (settledCount > 0) {
      showGlobalMsg(`🏆 ${settledCount} prediction(s) settled!`, "success");
      await loadUserPredictions();
      await loadPredictionHistory();
      await loadLeaderboard();
    }
  } catch (err) {
    console.warn("Settlement check error:", err);
  }
}

// ===== 7. PREDICTION HISTORY =====
async function loadPredictionHistory() {
  if (!historyContainer) return;

  if (!currentUser) {
    historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    return;
  }

  try {
    const q = query(
      collection(db, "predictions"),
      where("userId", "==", currentUser.uid),
      limit(100)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No predictions yet. Pick a result above to get started!</p>';
      return;
    }

    const docsSorted = snap.docs.slice().sort((a, b) => {
      const aMs = a.data().createdAt?.toMillis?.() || 0;
      const bMs = b.data().createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    }).slice(0, 30);

    historyContainer.innerHTML = docsSorted.map((docSnap) => {
      const p = docSnap.data();
      let statusText, statusClass;
      if (p.status === "correct") {
        statusText = `✅ Correct +${PREDICTION_CORRECT_HP} HP`;
        statusClass = "won";
      } else if (p.status === "incorrect") {
        statusText = "❌ Incorrect";
        statusClass = "lost";
      } else {
        statusText = "⏳ Pending";
        statusClass = "pending";
      }

      return `
        <div class="slip-history-item ${statusClass}">
          <div class="slip-history-header" style="cursor:default;">
            <div class="slip-history-header-left">
              <span><strong>${escapeHtml(p.homeTeam)} vs ${escapeHtml(p.awayTeam)}</strong></span>
              <span class="slip-history-status ${statusClass}">${statusText}</span>
            </div>
            <span style="font-size:12px;color:rgba(255,255,255,0.5);">${PICK_LABELS[p.pick] || p.pick}${p.finalScore ? ` · ${p.finalScore}` : ""}</span>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.warn("Load history error:", err);
    historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Could not load history.</p>';
  }
}

// ===== 8. LEADERBOARD =====
async function loadLeaderboard() {
  if (!leaderboardContainer) return;

  try {
    const q = query(collection(db, "predictions"), where("status", "==", "correct"), limit(500));
    const snap = await getDocs(q);

    const userStats = {};
    snap.docs.forEach((docSnap) => {
      const p = docSnap.data();
      if (!p.userId) return;
      if (!userStats[p.userId]) {
        userStats[p.userId] = { userId: p.userId, userName: p.userName || "Anonymous", correct: 0, hpEarned: 0 };
      }
      userStats[p.userId].correct++;
      userStats[p.userId].hpEarned += Number(p.pointsAwarded) || PREDICTION_CORRECT_HP;
    });

    const sorted = Object.values(userStats).sort((a, b) => b.hpEarned - a.hpEarned);
    const currentUserId = currentUser?.uid;

    if (sorted.length === 0) {
      leaderboardContainer.innerHTML = `
        <div class="leaderboard-table">
          <div class="leaderboard-header">
            <span>#</span><span>Player</span><span>HP 🏆</span><span>Correct</span>
          </div>
          <div class="leaderboard-row" style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.5);padding:30px 0;">
            <span>No correct predictions yet. Be the first! 🏆</span>
          </div>
        </div>
      `;
      return;
    }

    leaderboardContainer.innerHTML = `
      <div class="leaderboard-table">
        <div class="leaderboard-header">
          <span>#</span><span>Player</span><span>HP 🏆</span><span>Correct</span>
        </div>
        ${sorted.slice(0, 50).map((u, i) => {
          const isYou = u.userId === currentUserId;
          const rank = i + 1;
          const rankDisplay = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
          const displayName = isYou ? `${u.userName} (You)` : u.userName;
          return `
            <div class="leaderboard-row ${isYou ? "leaderboard-you" : ""}">
              <span class="leaderboard-rank">${rankDisplay}</span>
              <span class="leaderboard-name"><strong>${escapeHtml(displayName)}</strong></span>
              <span class="leaderboard-pts"><strong>${u.hpEarned.toFixed(1)} HP</strong></span>
              <span class="leaderboard-exact">${u.correct}</span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="leaderboard-legend">
        <p>🏆 Earn <strong>${PREDICTION_CORRECT_HP} HP</strong> for every correct prediction!</p>
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
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (userSnap.exists()) {
      const data = userSnap.data();
      currentUserUniqueId = data.uniqueId || "";
      currentUserName = data.displayName || data.firstName || currentUserName;
    }
  } catch (err) {
    console.warn("Could not load user profile:", err);
  }
}

// ===== FIXTURE LOADING FOR THE SELECTED CALENDAR DAY =====
async function loadFixturesForDate() {
  if (fixtureFetchInProgress || !selectedDateStr) return;
  fixtureFetchInProgress = true;

  try {
    const fixtures = await getFixturesByDate(selectedDateStr);
    await loadUserPredictions();
    renderFixtures(fixtures);
    hasLoadedFixturesOnce = true;
    await settlePendingPredictions();
  } catch (err) {
    console.error("Error loading fixtures:", err);
    renderFixtures([]);
    hasLoadedFixturesOnce = true;
  } finally {
    fixtureFetchInProgress = false;
  }
}

function wireFixtureSubscription() {
  if (fixtureUnsubscribe) return;
  fixtureUnsubscribe = subscribeToFixtureUpdates((fixtures, cacheKey) => {
    // Only re-render if the update matches the calendar day currently on screen.
    if (cacheKey === `date:${selectedDateStr}`) {
      renderFixtures(fixtures);
    }
  });
}

// ===== AUTO-REFRESH POLLING (every 30 seconds) =====
function startPolling() {
  stopPolling();
  pollIntervalId = setInterval(() => {
    loadFixturesForDate();
  }, 30000);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    currentUserName = user.displayName || user.email?.split("@")[0] || "Anonymous";
    await loadUserProfile();

    if (userStatus) {
      userStatus.textContent = `Signed in as ${currentUserName} ${currentUserUniqueId ? `· ${currentUserUniqueId}` : ""}`;
      userStatus.classList.add("active");
    }

    await loadUserPredictions();
    await loadPredictionHistory();
  } else {
    currentUserUniqueId = "";
    currentUserName = "Guest";
    userPredictions = new Map();
    if (userStatus) {
      userStatus.textContent = "Sign in to make predictions!";
      userStatus.classList.remove("active");
    }
    if (historyContainer) {
      historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    }
  }

  if (hasLoadedFixturesOnce) {
    renderFixtures(latestFixtures);
  }
  await loadLeaderboard();
});

// ===== INIT =====
window.addEventListener("load", () => {
  buildCalendar();
  wireFixtureSubscription();
  loadFixturesForDate();
  loadLeaderboard();
  startPolling();
});
