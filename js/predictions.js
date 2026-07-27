/**
 * GFHF Prediction League Module (OVERHAULED — LIVE API DATA)
 * - 5-day rolling calendar tab selector
 * - Real fixtures fetched from football API-Sports
 * - userSlip array (7 picks required)
 * - Save to Firestore "user_predictions" collection
 * - Settlement engine: >=6/7 correct → 2 HP
 * - History query without orderBy to prevent index crashes
 * FEATURES:
 *   1. Expandable slip history (click to view picks)
 *   2. View Winning Slip button in leaderboard
 *   3. 3-day expiry for non-winning slips
 *   4. Daily 3-slip submission limit
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, getDocs, addDoc, collection, query, where, updateDoc, increment, serverTimestamp, limit, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHPBadgeHTML, getUserHP } from "./rewards.js";

// ===== API CONFIG (Same API key as competition/dashboard) =====
const API_KEY = "6e2987eec8066be0a986f648fe4a9cf7";
const API_HOST = "v3.football.api-sports.io";

// ===== DOM REFS =====
const calendarEl = document.getElementById("dateCalendar");
const fixturesContainer = document.getElementById("predictionFixtures");
const leaderboardContainer = document.getElementById("predictionLeaderboard");
const userStatus = document.getElementById("predictionUserStatus");
const globalMsg = document.getElementById("predictionGlobalMsg");
const slipBanner = document.getElementById("slipBanner");
const slipCount = document.getElementById("slipCount");
const slipProgress = document.getElementById("slipProgress");
const slipSubmitBtn = document.getElementById("slipSubmitBtn");
const slipHistoryContainer = document.getElementById("slipHistory");
const dailyLimitContainer = document.getElementById("dailyLimitCounter");

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserUniqueId = "";
let todaySlipCount = 0;

/** @type {{ matchId: string, pick: string, homeTeam: string, awayTeam: string, league: string, kickoff: string }[]} */
let userSlip = [];

let isSubmitting = false;
let selectedDateStr = ""; // "YYYY-MM-DD"

// ===== MONTH NAMES =====
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ===== HELPERS =====
function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
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
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isToday(dateStr) {
  return dateStr === toDateStr(new Date());
}

/** Format pick value into a friendly string */
function formatPick(pick) {
  if (!pick) return "—";
  if (pick === "winner_1") return "Winner: 1 (Home)";
  if (pick === "winner_X") return "Winner: Draw (X)";
  if (pick === "winner_2") return "Winner: 2 (Away)";
  if (pick === "goals_over2.5") return "Total Goals: Over 2.5";
  if (pick === "goals_under2.5") return "Total Goals: Under 2.5";
  return pick;
}

/** Generate a unique slip ID for client-side tracking */
function generateSlipDisplayId() {
  return 'slip_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
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
      loadFixturesForDate(dateStr);
    });

    calendarEl.appendChild(btn);

    if (i === 0 && !selectedDateStr) {
      selectedDateStr = dateStr;
      btn.style.background = "#00c853";
      btn.style.color = "#fff";
    }
  }
}

// ===== 3. RENDER FIXTURES WITH SELECTION UI =====
function renderFixtures(fixturesList) {
  if (!fixturesContainer) return;

  if (!fixturesList || fixturesList.length === 0) {
    fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">No fixtures available for this date.</p></div>';
    return;
  }

  let html = "";
  fixturesList.forEach((match) => {
    const matchId = match.id;
    const slipEntry = userSlip.find(s => s.matchId === matchId);
    const selectedClass = slipEntry ? " odds-card-selected" : "";
    const selectedPick = slipEntry ? slipEntry.pick : null;

    html += `
      <div class="odds-card${selectedClass}" data-match-id="${matchId}">
        <div class="odds-header">
          <span class="league-pill">⚽ ${escapeHtml(match.league)}</span>
          <span class="odds-time">⏰ ${formatKickoff(match.date)}</span>
        </div>
        <div class="odds-teams">
          <div class="odds-team">${escapeHtml(match.homeTeam)}</div>
          <div class="odds-vs">vs</div>
          <div class="odds-team">${escapeHtml(match.awayTeam)}</div>
        </div>
        <!-- Winner selection -->
        <div class="prediction-section">
          <div class="prediction-section-label">🎯 Pick Winner</div>
          <div class="winner-buttons">
            <button class="pred-btn pick-btn${selectedPick === "winner_1" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="winner_1">
              <span class="pred-btn-label">1</span>
              <span class="pred-btn-team">${escapeHtml(match.homeTeam)}</span>
            </button>
            <button class="pred-btn pick-btn${selectedPick === "winner_X" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="winner_X">
              <span class="pred-btn-label">X</span>
              <span class="pred-btn-team">Draw</span>
            </button>
            <button class="pred-btn pick-btn${selectedPick === "winner_2" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="winner_2">
              <span class="pred-btn-label">2</span>
              <span class="pred-btn-team">${escapeHtml(match.awayTeam)}</span>
            </button>
          </div>
        </div>
        <!-- Goals selection -->
        <div class="prediction-section">
          <div class="prediction-section-label">⚽ Pick Total Goals</div>
          <div class="goals-buttons">
            <button class="pred-btn pick-btn${selectedPick === "goals_over2.5" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="goals_over2.5">Over 2.5</button>
            <button class="pred-btn pick-btn${selectedPick === "goals_under2.5" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="goals_under2.5">Under 2.5</button>
          </div>
        </div>
      </div>
    `;
  });

  fixturesContainer.innerHTML = html;

  fixturesContainer.querySelectorAll(".pick-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!currentUser) {
        document.getElementById("authModal")?.classList.add("auth-modal--open");
        return;
      }
      handlePick(btn);
    });
  });
}

// ===== 4. PICK HANDLER =====
function handlePick(btn) {
  const matchId = btn.dataset.match;
  const pick = btn.dataset.pick;

  const card = btn.closest(".odds-card");
  const teamEls = card.querySelectorAll(".odds-team");
  const leagueEl = card.querySelector(".league-pill");
  const homeTeam = teamEls[0]?.textContent || "Home";
  const awayTeam = teamEls[1]?.textContent || "Away";
  const league = leagueEl?.textContent?.replace("⚽ ", "") || "";
  const kickoff = "";

  const existingIdx = userSlip.findIndex(s => s.matchId === matchId);

  if (existingIdx !== -1 && userSlip[existingIdx].pick === pick) {
    userSlip.splice(existingIdx, 1);
  } else if (existingIdx !== -1) {
    userSlip[existingIdx].pick = pick;
  } else {
    userSlip.push({
      matchId,
      pick,
      homeTeam,
      awayTeam,
      league,
      kickoff
    });
  }

  updateCardVisuals(matchId);
  updateSlipBanner();
}

function updateCardVisuals(matchId) {
  const card = document.querySelector(`.odds-card[data-match-id="${matchId}"]`);
  if (!card) return;

  const entry = userSlip.find(s => s.matchId === matchId);

  card.querySelectorAll(".pick-btn").forEach(b => {
    b.classList.toggle("selected-btn", entry ? entry.pick === b.dataset.pick : false);
  });

  card.classList.toggle("odds-card-selected", !!entry);
}

// ===== 5. SLIP BANNER =====
function updateSlipBanner() {
  if (!slipCount || !slipProgress || !slipSubmitBtn) return;

  const count = userSlip.length;
  slipCount.textContent = `${count} / 7`;

  const pct = Math.min(100, Math.round((count / 7) * 100));
  slipProgress.style.width = `${pct}%`;
  slipProgress.textContent = `${pct}%`;

  const ready = count === 7;
  slipSubmitBtn.disabled = !ready || isSubmitting;

  if (isSubmitting) {
    slipSubmitBtn.textContent = "⏳ Submitting...";
    slipSubmitBtn.style.background = "linear-gradient(90deg, #64748b, #475569)";
  } else if (ready) {
    slipSubmitBtn.textContent = "📋 Submit Predictions";
    slipSubmitBtn.style.background = "linear-gradient(90deg, #00c853, #00b34a)";
  } else {
    slipSubmitBtn.textContent = `📋 Select ${7 - count} more matches`;
    slipSubmitBtn.style.background = "linear-gradient(90deg, #64748b, #475569)";
  }
}

// ===== FEATURE 4: DAILY SLIP LIMIT COUNTER =====
async function updateDailyLimitCounter() {
  if (!dailyLimitContainer || !currentUser) return;
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const q = query(
      collection(db, "user_predictions"),
      where("userId", "==", currentUser.uid),
      where("dateSubmitted", "==", todayStr)
    );
    const snap = await getDocs(q);
    todaySlipCount = snap.size;
    const remaining = 3 - todaySlipCount;
    const limitReached = remaining <= 0;

    dailyLimitContainer.textContent = `Today's Submissions: ${todaySlipCount} / 3`;
    dailyLimitContainer.className = `daily-limit-counter${limitReached ? ' limit-reached' : ''}`;

    // Also disable submit if limit reached
    if (slipSubmitBtn && limitReached) {
      slipSubmitBtn.disabled = true;
    }
  } catch (err) {
    console.warn("Daily limit counter error:", err);
  }
}

// ===== 6. SUBMISSION ENGINE (Feature 4: 3-slip daily limit) =====
async function submitSlip() {
  if (!currentUser) { showGlobalMsg("Please sign in first.", "error"); return; }
  if (isSubmitting) return;
  if (userSlip.length !== 7) { showGlobalMsg("You must select exactly 7 matches.", "error"); return; }

  // Validate all entries have a pick selected
  const invalid = userSlip.some(s => !s.pick);
  if (invalid) {
    showGlobalMsg("Each match needs a pick selected.", "error");
    return;
  }

  // FEATURE 4: Check daily 3-slip limit
  const todayStr = new Date().toISOString().split('T')[0];
  try {
    const todayQ = query(
      collection(db, "user_predictions"),
      where("userId", "==", currentUser.uid),
      where("dateSubmitted", "==", todayStr)
    );
    const todaySnap = await getDocs(todayQ);
    if (todaySnap.size >= 3) {
      showGlobalMsg("You have reached your limit of 3 prediction slips for today! Please return tomorrow.", "error");
      return;
    }
  } catch (limitErr) {
    console.warn("Daily limit check error:", limitErr);
  }

  isSubmitting = true;
  slipSubmitBtn.disabled = true;
  slipSubmitBtn.textContent = "⏳ Submitting...";

  try {
    await addDoc(collection(db, "user_predictions"), {
      userId: currentUser.uid,
      userName: currentUser.displayName || "Anonymous",
      slip: userSlip,
      status: "pending",
      dateSubmitted: todayStr,
      createdAt: serverTimestamp()
    });

    showGlobalMsg("✅ Prediction Slip Submitted Successfully!", "success");

    userSlip = [];
    updateSlipBanner();

    if (selectedDateStr) loadFixturesForDate(selectedDateStr);

    loadSlipHistory();
    updateDailyLimitCounter();
  } catch (err) {
    console.error("Submit error:", err);
    showGlobalMsg("Failed to submit slip. Try again.", "error");
  } finally {
    isSubmitting = false;
    updateSlipBanner();
  }
}

// ===== 7. SETTLEMENT ENGINE (Real API-based) =====
async function fetchRealFixtureResult(matchId) {
  try {
    const response = await fetch(`https://${API_HOST}/fixtures?id=${matchId}`, {
      method: "GET",
      headers: {
        "x-rapidapi-host": API_HOST,
        "x-rapidapi-key": API_KEY
      }
    });
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;
    const fixture = data.response[0];
    if (fixture.fixture.status.short !== "FT") return null;
    return {
      homeScore: fixture.goals.home ?? 0,
      awayScore: fixture.goals.away ?? 0
    };
  } catch (err) {
    console.warn(`Failed to fetch result for match ${matchId}:`, err);
    return null;
  }
}

function getScoreWinner(home, away) {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

async function settleSlip(slipDoc) {
  const data = slipDoc.data();
  const slipId = slipDoc.id;

  if (data.status !== "pending") return;

  let correctCount = 0;
  let settledCount = 0;

  for (const sel of data.slip) {
    const result = await fetchRealFixtureResult(sel.matchId);
    if (!result) {
      continue;
    }
    settledCount++;

    let pickCategory = null, pickValue = null;
    if (sel.pick) {
      if (sel.pick.startsWith("winner_")) {
        pickCategory = "winner";
        pickValue = sel.pick.replace("winner_", "");
      } else if (sel.pick.startsWith("goals_")) {
        pickCategory = "goals";
        pickValue = sel.pick.replace("goals_", "");
      }
    }
    if (!pickCategory) {
      pickCategory = "winner";
      pickValue = sel.winner;
    }

    if (pickCategory === "winner") {
      const correctWinner = getScoreWinner(result.homeScore, result.awayScore);
      if (pickValue === correctWinner) correctCount++;
    } else if (pickCategory === "goals") {
      const total = result.homeScore + result.awayScore;
      const correctGoals = total > 2.5 ? "over2.5" : "under2.5";
      if (pickValue === correctGoals) correctCount++;
    }
  }

  if (settledCount === 0) return;

  const scoreStr = `${correctCount}/${settledCount}`;

  try {
    if (correctCount >= 6) {
      const userRef = doc(db, "users", data.userId);
      await updateDoc(userRef, {
        hpBalance: increment(2),
        totalRewardsEarned: increment(2)
      });

      await updateDoc(doc(db, "user_predictions", slipId), {
        status: "won",
        pointsAwarded: 2,
        score: scoreStr
      });
    } else {
      await updateDoc(doc(db, "user_predictions", slipId), {
        status: "lost",
        pointsAwarded: 0,
        score: scoreStr
      });
    }

    return { slipId, correctCount, rewarded: correctCount >= 6, settledCount };
  } catch (err) {
    console.error("Settlement error:", err);
  }
}

async function settleAllPendingSlips() {
  try {
    const q = query(
      collection(db, "user_predictions"),
      where("status", "==", "pending"),
      limit(50)
    );
    const snap = await getDocs(q);
    let settledCount = 0;
    for (const docSnap of snap.docs) {
      const result = await settleSlip(docSnap);
      if (result) settledCount++;
    }
    if (settledCount > 0) {
      showGlobalMsg(`🏆 ${settledCount} slip(s) settled!`, "success");
      loadSlipHistory();
      loadLeaderboard();
    }
  } catch (err) {
    console.warn("Settlement check error:", err);
  }
}

// ===== FEATURE 1: EXPANDABLE SLIP HISTORY + FEATURE 3: 3-DAY EXPIRY =====
async function loadSlipHistory() {
  if (!slipHistoryContainer) return;
  if (!currentUser) {
    slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    return;
  }

  slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">⏳ Loading history...</p>';

  try {
    // Query without orderBy to prevent index crashes
    const q = query(
      collection(db, "user_predictions"),
      where("userId", "==", currentUser.uid),
      limit(100)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No prediction slips yet. Select 7 matches and submit!</p>';
      return;
    }

    // Sort client-side by createdAt descending
    const docs = [];
    snap.docs.forEach(d => docs.push({ id: d.id, ...d.data() }));
    docs.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.dateSubmitted ? new Date(a.dateSubmitted).getTime() : 0);
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.dateSubmitted ? new Date(b.dateSubmitted).getTime() : 0);
      return tb - ta;
    });

    // FEATURE 3: 3-day expiry for non-winning slips
    const filteredDocs = docs.filter(slip => {
      if (slip.status === "won") return true; // Always show won slips

      const createdAt = slip.createdAt?.toMillis ? slip.createdAt.toMillis() : (slip.dateSubmitted ? new Date(slip.dateSubmitted).getTime() : Date.now());
      const ageInDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);

      if (ageInDays > 3) {
        // FEATURE 3 OPTIONAL: Delete expired doc from Firestore
        deleteDoc(doc(db, "user_predictions", slip.id)).catch(err => console.warn("Failed to delete expired slip:", err));
        return false; // Filter it out
      }
      return true;
    });

    if (filteredDocs.length === 0) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No prediction slips yet. Select 7 matches and submit!</p>';
      return;
    }

    let html = "";
    filteredDocs.forEach((slip, index) => {
      const dateStr = slip.dateSubmitted || "—";
      const displayId = generateSlipDisplayId();

      let statusText, statusClass;
      if (slip.status === "won") {
        statusText = `✅ Won (${slip.score || "?"}) +2 HP 🏆`;
        statusClass = "won";
      } else if (slip.status === "lost") {
        statusText = `❌ Lost (${slip.score || "?"})`;
        statusClass = "lost";
      } else {
        statusText = "⏳ Pending";
        statusClass = "pending";
      }

      // FEATURE 1: Build expandable picks HTML
      let picksHtml = "";
      if (slip.slip && slip.slip.length > 0) {
        picksHtml = slip.slip.map(pick => {
          const homeTeam = pick.homeTeam || "Home";
          const awayTeam = pick.awayTeam || "Away";
          return `
            <div class="slip-pick-row">
              <div class="slip-pick-team home">${escapeHtml(homeTeam)}</div>
              <div class="slip-pick-vs">vs</div>
              <div class="slip-pick-team away">${escapeHtml(awayTeam)}</div>
              <div class="slip-pick-detail">
                <span class="slip-pick-label">🎯 Pick</span>
                <span class="slip-pick-value">${escapeHtml(formatPick(pick.pick))}</span>
              </div>
            </div>
          `;
        }).join("");
      } else {
        picksHtml = '<div style="font-size:12px;color:rgba(255,255,255,0.5);padding:8px;">No picks data available</div>';
      }

      html += `
        <div class="slip-history-item ${statusClass}">
          <div class="slip-history-header" data-target="${displayId}">
            <div class="slip-history-header-left">
              <span><strong>${dateStr}</strong></span>
              <span class="slip-history-status ${statusClass}">${statusText}</span>
            </div>
            <span style="font-size:12px;color:rgba(255,255,255,0.5);">${slip.slip?.length || 0} picks</span>
            <button class="slip-toggle-btn" data-target="${displayId}">🔽 View Picks</button>
          </div>
          <div id="${displayId}" class="slip-expanded-content" style="display:none;">
            ${picksHtml}
          </div>
        </div>
      `;
    });

    slipHistoryContainer.innerHTML = html;

    // FEATURE 1: Attach toggle click handlers
    slipHistoryContainer.querySelectorAll('.slip-toggle-btn, .slip-history-header').forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't toggle if clicking the button itself (it's handled)
        if (e.target.classList.contains('slip-toggle-btn')) return;
        const targetId = el.dataset.target;
        if (targetId) toggleSlipExpand(targetId);
      });
    });

    slipHistoryContainer.querySelectorAll('.slip-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = btn.dataset.target;
        if (targetId) toggleSlipExpand(targetId);
      });
    });
  } catch (err) {
    console.warn("Load history error:", err);
    slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Could not load history.</p>';
  }
}

/** Toggle expand/collapse for a slip history item */
function toggleSlipExpand(targetId) {
  const content = document.getElementById(targetId);
  if (!content) return;
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'grid' : 'none';

  // Update toggle button text
  const btn = document.querySelector(`.slip-toggle-btn[data-target="${targetId}"]`);
  if (btn) {
    btn.textContent = isHidden ? '🔼 Hide Picks' : '🔽 View Picks';
  }
}

// ===== 2. FETCH REAL FIXTURES FROM API =====
async function fetchFixturesFromAPI(dateStr) {
  try {
    const response = await fetch(`https://${API_HOST}/fixtures?date=${dateStr}`, {
      method: "GET",
      headers: {
        "x-rapidapi-host": API_HOST,
        "x-rapidapi-key": API_KEY
      }
    });
    const data = await response.json();
    if (!data.response || data.response.length === 0) return [];

    return data.response.map(fixture => ({
      id: fixture.fixture.id.toString(),
      league: fixture.league.name,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      date: fixture.fixture.date,
      status: fixture.fixture.status.short === "FT" ? "finished"
             : fixture.fixture.status.short === "LIVE" || fixture.fixture.status.elapsed ? "live"
             : "upcoming"
    }));
  } catch (err) {
    console.error("API fetch error:", err);
    return [];
  }
}

// ===== 9. FETCH FIXTURES PER DATE =====
async function loadFixturesForDate(dateStr) {
  if (!fixturesContainer) return;
  fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">⏳ Loading fixtures...</p></div>';

  try {
    let fixtures = await fetchFixturesFromAPI(dateStr);

    if (isToday(dateStr)) {
      const now = new Date();
      fixtures = fixtures.filter(match => {
        const kickoffTime = new Date(match.date);
        return kickoffTime > now;
      });

      if (fixtures.length === 0) {
        fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">⏰ No more upcoming matches scheduled for today. Please select tomorrow\'s tab!</p></div>';
        return;
      }
    }

    renderFixtures(fixtures);
  } catch (err) {
    console.error("loadFixturesForDate error:", err);
    fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">⚠️ Failed to load fixtures. Please try again.</p></div>';
  }
}

// ===== FEATURE 2: VIEW WINNING SLIP MODAL =====
/**
 * Open a modal showing a user's winning slip details.
 * @param {string} userName - Name of the user
 * @param {string} slipId - The Firestore doc ID of the winning slip
 */
async function openWinningSlipModal(userName, slipId) {
  // Remove any existing modal first
  const oldModal = document.getElementById('winningSlipModal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.id = 'winningSlipModal';
  modal.className = 'fb-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="fb-modal-overlay" id="winningSlipModalOverlay"></div>
    <div class="fb-modal-card" style="max-width:500px;">
      <div class="fb-modal-header">
        <h3>🏆 Winning Prediction Slip</h3>
        <button class="fb-modal-close" id="winningSlipModalClose">&times;</button>
      </div>
      <div class="winning-slip-modal-body">
        <div style="text-align:center;padding:30px 0;color:#64748b;">⏳ Loading slip details...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close handlers
  document.getElementById('winningSlipModalClose').addEventListener('click', () => modal.remove());
  document.getElementById('winningSlipModalOverlay').addEventListener('click', () => modal.remove());

  // Fetch the slip data
  try {
    const slipSnap = await getDoc(doc(db, "user_predictions", slipId));
    if (!slipSnap.exists()) {
      modal.querySelector('.winning-slip-modal-body').innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;">Slip not found.</div>';
      return;
    }
    const slip = slipSnap.data();

    const dateStr = slip.dateSubmitted || "—";
    const scoreStr = slip.score || "?";
    const picksCount = slip.slip?.length || 0;

    let picksHtml = "";
    if (slip.slip && slip.slip.length > 0) {
      picksHtml = slip.slip.map(pick => {
        const homeTeam = pick.homeTeam || "Home";
        const awayTeam = pick.awayTeam || "Away";
        return `
          <div class="winning-slip-pick">
            <div class="winning-slip-pick-team home">${escapeHtml(homeTeam)}</div>
            <div class="winning-slip-pick-vs">vs</div>
            <div class="winning-slip-pick-team away">${escapeHtml(awayTeam)}</div>
            <div class="winning-slip-pick-detail">
              <span class="winning-slip-pick-label">🎯 Pick</span>
              <span class="winning-slip-pick-value">${escapeHtml(formatPick(pick.pick))}</span>
            </div>
          </div>
        `;
      }).join("");
    } else {
      picksHtml = '<div style="text-align:center;padding:12px;color:#94a3b8;">No picks data available</div>';
    }

    modal.querySelector('.winning-slip-modal-body').innerHTML = `
      <div class="winning-slip-user">
        <div class="winning-slip-avatar">🏆</div>
        <div>
          <div class="winning-slip-name">${escapeHtml(userName)}</div>
          <div class="winning-slip-date">Submitted: ${dateStr} · Score: ${scoreStr}</div>
        </div>
      </div>
      <div class="winning-slip-ticket">
        <div class="winning-slip-ticket-header">
          <span>🎯 Winning Ticket (${picksCount} picks)</span>
          <span>✅ ${scoreStr} correct</span>
        </div>
        ${picksHtml}
      </div>
      <div class="winning-slip-badge">
        🏆 +2 HP Awarded for 6+ correct predictions!
      </div>
    `;
  } catch (err) {
    console.error("Winning slip fetch error:", err);
    modal.querySelector('.winning-slip-modal-body').innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;">Failed to load slip details.</div>';
  }
}

// ===== 10. LEADERBOARD (Feature 2: View Winning Slip button) =====
async function loadLeaderboard() {
  if (!leaderboardContainer) return;

  try {
    const q = query(
      collection(db, "user_predictions"),
      where("status", "==", "won"),
      limit(100)
    );
    const snap = await getDocs(q);

    // Build user aggregates AND store winning slip IDs
    const userRewards = {};
    snap.docs.forEach(docSnap => {
      const slip = docSnap.data();
      if (!slip.userId) return;
      if (!userRewards[slip.userId]) {
        userRewards[slip.userId] = {
          userId: slip.userId,
          userName: slip.userName || "Anonymous",
          totalSlips: 0,
          hpEarned: 0,
          winningSlipIds: [] // FEATURE 2: store winning slip IDs
        };
      }
      userRewards[slip.userId].totalSlips++;
      userRewards[slip.userId].hpEarned += 2;
      userRewards[slip.userId].winningSlipIds.push(docSnap.id);
    });

    const sorted = Object.values(userRewards).sort((a, b) => b.hpEarned - a.hpEarned);

    const currentUserId = currentUser?.uid;

    if (sorted.length === 0) {
      leaderboardContainer.innerHTML = `
        <div class="leaderboard-table">
          <div class="leaderboard-header">
            <span>#</span>
            <span>Player</span>
            <span>HP 🏆</span>
            <span>Slips</span>
          </div>
          <div class="leaderboard-row" style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.5);padding:30px 0;">
            <span>No winners yet. Be the first to get 6/7 correct! 🏆</span>
          </div>
        </div>
        <div class="leaderboard-legend">
          <p>🏆 Get <strong>6/7</strong> correct predictions to earn <strong>2 HP</strong> per slip!</p>
        </div>
      `;
      return;
    }

    // Update leaderboard header to include a "View" column
    leaderboardContainer.innerHTML = `
      <div class="leaderboard-table">
        <div class="leaderboard-header">
          <span>#</span>
          <span>Player</span>
          <span>HP 🏆</span>
          <span>Slips</span>
          <span></span>
        </div>
        ${sorted.map((u, i) => {
          const isYou = u.userId === currentUserId;
          const rank = i + 1;
          const rankDisplay = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
          const displayName = isYou ? `${u.userName} (You)` : u.userName;
          const firstWinningSlipId = u.winningSlipIds[0] || null;
          return `
            <div class="leaderboard-row ${isYou ? "leaderboard-you" : ""}">
              <span class="leaderboard-rank">${rankDisplay}</span>
              <span class="leaderboard-name"><strong>${displayName}</strong></span>
              <span class="leaderboard-pts"><strong>${u.hpEarned} HP</strong></span>
              <span class="leaderboard-exact">${u.totalSlips}</span>
              <span class="leaderboard-exact">
                ${firstWinningSlipId ? `<button class="leaderboard-view-btn" data-user="${escapeHtml(u.userName)}" data-slip="${firstWinningSlipId}">🏆 View</button>` : ''}
              </span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="leaderboard-legend">
        <p>🏆 Get <strong>6/7</strong> correct predictions to earn <strong>2 HP</strong> per slip!</p>
      </div>
    `;

    // FEATURE 2: Attach click handlers for View Winning Slip buttons
    leaderboardContainer.querySelectorAll('.leaderboard-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userName = btn.dataset.user;
        const slipId = btn.dataset.slip;
        if (slipId) {
          openWinningSlipModal(userName, slipId);
        }
      });
    });
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

    await loadSlipHistory();
    await settleAllPendingSlips();
    await updateDailyLimitCounter();
  } else {
    currentUserUniqueId = "";
    currentUserName = "Guest";
    todaySlipCount = 0;
    if (userStatus) {
      userStatus.textContent = "Sign in to make predictions!";
      userStatus.classList.remove("active");
    }
    if (dailyLimitContainer) {
      dailyLimitContainer.textContent = "";
    }
    if (slipHistoryContainer) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    }
  }

  // Always build calendar + load initial fixtures + leaderboard
  buildCalendar();
  if (selectedDateStr) loadFixturesForDate(selectedDateStr);
  await loadLeaderboard();
  updateSlipBanner();
});

// ===== SUBMIT BUTTON =====
if (slipSubmitBtn) {
  slipSubmitBtn.addEventListener("click", submitSlip);
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  updateSlipBanner();
});

window.addEventListener("load", () => {
  if (fixturesContainer && fixturesContainer.innerHTML.includes("Loading")) {
    buildCalendar();
    if (selectedDateStr) loadFixturesForDate(selectedDateStr);
    loadLeaderboard();
  }
  updateSlipBanner();
});

