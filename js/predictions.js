/**
 * GFHF Prediction League Module
 * Renders prediction cards from the shared live fixture service used by the competition page.
 * No local fixture generation or mock results are used.
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, getDocs, addDoc, collection, query, where, updateDoc, increment, serverTimestamp, limit, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHPBadgeHTML, getUserHP, formatHP } from "./rewards.js";
import { getLiveFixtures, subscribeToFixtureUpdates } from "./fixturesService.js";


// ===== DOM REFS (with existence checks) =====
function getEl(id) { return document.getElementById(id); }

const calendarEl = getEl("dateCalendar");
const fixturesContainer = getEl("predictionFixtures");
const leaderboardContainer = getEl("predictionLeaderboard");
const userStatus = getEl("predictionUserStatus");
const globalMsg = getEl("predictionGlobalMsg");
const slipBanner = getEl("slipBanner");
const slipCount = getEl("slipCount");
const slipProgress = getEl("slipProgress");
const slipSubmitBtn = getEl("slipSubmitBtn");
const slipHistoryContainer = getEl("slipHistory");
const dailyLimitCounter = getEl("dailyLimitCounter");
const winningSlipModal = getEl("winningSlipModal");
const winningSlipModalBody = getEl("winningSlipModalBody");
const winningSlipModalOverlay = getEl("winningSlipModalOverlay");
const winningSlipModalClose = getEl("winningSlipModalClose");

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserUniqueId = "";

/** @type {{ matchId: string, pick: string, homeTeam: string, awayTeam: string, league: string, kickoff: string }[]} */
let userSlip = [];

let isSubmitting = false;
let todaySlipCount = 0;
let selectedDateStr = "";

let fixtureCache = { current: [] };
let fixtureFetchInProgress = { current: false };

// ===== CONSTANTS =====
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ===== HELPER FUNCTIONS =====
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

function getTodayStr() {
  return toDateStr(new Date());
}

function formatPick(pick) {
  if (!pick) return "—";
  if (pick.startsWith("winner_")) {
    const val = pick.replace("winner_", "");
    if (val === "1") return "Winner: 1 (Home)";
    if (val === "2") return "Winner: 2 (Away)";
    if (val === "X") return "Winner: X (Draw)";
    return `Winner: ${val}`;
  }
  if (pick.startsWith("goals_")) {
    const val = pick.replace("goals_", "");
    if (val === "over2.5") return "Total Goals: Over 2.5";
    if (val === "under2.5") return "Total Goals: Under 2.5";
    return `Goals: ${val}`;
  }
  return pick;
}

function generateSlipDisplayId() {
  return 'slip_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

function normalizePredictionFixture(fixture) {
  return {
    fixture_id: fixture?.fixture_id ?? fixture?.id,
    league: fixture?.league_name ?? fixture?.league,
    league_logo: fixture?.league_logo ?? fixture?.leagueLogo ?? "",
    homeTeam: fixture?.home_team_name ?? fixture?.homeTeam?.name ?? fixture?.homeTeam ?? "Home",
    homeTeamLogo: fixture?.home_team_logo ?? fixture?.homeTeamLogo ?? "",
    awayTeam: fixture?.away_team_name ?? fixture?.awayTeam?.name ?? fixture?.awayTeam ?? "Away",
    awayTeamLogo: fixture?.away_team_logo ?? fixture?.awayTeamLogo ?? "",
    date: fixture?.kickoff_time ?? fixture?.date ?? fixture?.kickoff ?? null,
    kickoff: fixture?.kickoff_time ?? fixture?.date ?? fixture?.kickoff ?? null,
    status: fixture?.status ?? "scheduled",
    minute: fixture?.minute ?? "",
    homeScore: fixture?.home_score ?? fixture?.homeScore?.current ?? fixture?.homeScore ?? 0,
    awayScore: fixture?.away_score ?? fixture?.awayScore?.current ?? fixture?.awayScore ?? 0
  };
}

async function fetchFixturesFromAPI() {
  const fixtures = await getLiveFixtures();
  return fixtures.map(normalizePredictionFixture);
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

// ===== 3. RENDER FIXTURES WITH SELECTION UI =====
function renderFixtures(fixturesList) {
  if (!fixturesContainer) return;

  if (!fixturesList || fixturesList.length === 0) {
    fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">No live fixtures available right now.</p></div>';
    return;
  }

  let html = "";
  fixturesList.forEach((match) => {
    const matchId = match.fixture_id || match.id;
    const slipEntry = userSlip.find(s => s.matchId === matchId);
    const selectedClass = slipEntry ? " odds-card-selected" : "";
    const selectedPick = slipEntry ? slipEntry.pick : null;
    const kickoffLabel = formatKickoff(match.date || match.kickoff);
    const matchStatus = match.status || "scheduled";
    const isLocked = matchStatus === "live" || matchStatus === "half_time" || matchStatus === "finished";
    const leagueLogo = match.league_logo || match.leagueLogo || "";
    const homeLogo = match.homeTeamLogo || match.home_logo || "";
    const awayLogo = match.awayTeamLogo || match.away_logo || "";

    html += `
      <div class="odds-card${selectedClass}" data-match-id="${matchId}">
        <div class="odds-header">
          <span class="league-pill">${leagueLogo ? `<img src="${escapeHtml(leagueLogo)}" alt="" style="width:18px;height:18px;object-fit:contain;display:inline-block;vertical-align:middle;margin-right:6px;">` : "⚽"} ${escapeHtml(match.league || "League")}</span>
          <span class="odds-time">⏰ ${escapeHtml(kickoffLabel || "TBD")}</span>
        </div>
        <div class="odds-teams" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div class="odds-team" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
            ${homeLogo ? `<img src="${escapeHtml(homeLogo)}" alt="" style="width:32px;height:32px;object-fit:contain;">` : ""}
            <span>${escapeHtml(match.homeTeam)}</span>
          </div>
          <div class="odds-vs">vs</div>
          <div class="odds-team" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
            ${awayLogo ? `<img src="${escapeHtml(awayLogo)}" alt="" style="width:32px;height:32px;object-fit:contain;">` : ""}
            <span>${escapeHtml(match.awayTeam)}</span>
          </div>
        </div>
        <div class="prediction-section" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:rgba(255,255,255,0.75);">
          <span>📊 ${escapeHtml(matchStatus === "live" ? `Live ${match.minute ? `${match.minute}'` : ""}` : matchStatus === "finished" ? "Finished" : "Scheduled")}</span>
          <span>⚽ ${match.homeScore ?? 0} - ${match.awayScore ?? 0}</span>
        </div>
        <div class="prediction-section">
          <div class="prediction-section-label">🎯 Pick Winner</div>
          <div class="winner-buttons">
            <button class="pred-btn pick-btn${selectedPick === "winner_1" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="winner_1" ${isLocked ? "disabled" : ""}>
              <span class="pred-btn-label">1</span>
              <span class="pred-btn-team">${escapeHtml(match.homeTeam)}</span>
            </button>
            <button class="pred-btn pick-btn${selectedPick === "winner_X" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="winner_X" ${isLocked ? "disabled" : ""}>
              <span class="pred-btn-label">X</span>
              <span class="pred-btn-team">Draw</span>
            </button>
            <button class="pred-btn pick-btn${selectedPick === "winner_2" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="winner_2" ${isLocked ? "disabled" : ""}>
              <span class="pred-btn-label">2</span>
              <span class="pred-btn-team">${escapeHtml(match.awayTeam)}</span>
            </button>
          </div>
        </div>
        <div class="prediction-section">
          <div class="prediction-section-label">⚽ Pick Total Goals</div>
          <div class="goals-buttons">
            <button class="pred-btn pick-btn${selectedPick === "goals_over2.5" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="goals_over2.5" ${isLocked ? "disabled" : ""}>Over 2.5</button>
            <button class="pred-btn pick-btn${selectedPick === "goals_under2.5" ? " selected-btn" : ""}" data-match="${matchId}" data-pick="goals_under2.5" ${isLocked ? "disabled" : ""}>Under 2.5</button>
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
        const authModal = document.getElementById("authModal");
        if (authModal) authModal.classList.add("auth-modal--open");
        return;
      }
      handlePick(btn);
    });
  });
}

// ===== 4. PICK HANDLER — 1 PICK PER MATCH (toggle on/off) =====
function handlePick(btn) {
  const matchId = btn.dataset.match;
  const pick = btn.dataset.pick; // e.g. "winner_1" or "goals_over2.5"

  // Find match data from rendered fixtures
  const card = btn.closest(".odds-card");
  if (!card) return;
  const teamEls = card.querySelectorAll(".odds-team");
  const leagueEl = card.querySelector(".league-pill");
  const homeTeam = teamEls[0]?.textContent || "Home";
  const awayTeam = teamEls[1]?.textContent || "Away";
  const league = leagueEl?.textContent?.replace("⚽ ", "") || "";
  const kickoff = "";

  // Find existing entry for this match in the slip
  const existingIdx = userSlip.findIndex(s => s.matchId === matchId);

  if (existingIdx !== -1 && userSlip[existingIdx].pick === pick) {
    // Same pick clicked again → DESELECT (remove from slip)
    userSlip.splice(existingIdx, 1);
  } else if (existingIdx !== -1) {
    // Different pick clicked on same match → SWAP the pick value
    userSlip[existingIdx].pick = pick;
  } else {
    // No existing entry — create one with the single pick field
    userSlip.push({
      matchId,
      pick,
      homeTeam,
      awayTeam,
      league,
      kickoff
    });
  }

  // Update all visual states for this match
  updateCardVisuals(matchId);
  updateSlipBanner();
}

function updateCardVisuals(matchId) {
  const card = document.querySelector(`.odds-card[data-match-id="${matchId}"]`);
  if (!card) return;

  const entry = userSlip.find(s => s.matchId === matchId);

  // Update ALL pick buttons in this card: only the selected pick gets .selected-btn
  card.querySelectorAll(".pick-btn").forEach(b => {
    b.classList.toggle("selected-btn", entry ? entry.pick === b.dataset.pick : false);
  });

  // Card highlight
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

// ===== 4b. UPDATE DAILY LIMIT COUNTER =====
async function updateDailyLimitCounter() {
  if (!dailyLimitCounter || !currentUser) {
    if (dailyLimitCounter) dailyLimitCounter.textContent = "";
    return 0;
  }

  try {
    const todayStr = getTodayStr();
    const q = query(
      collection(db, "user_predictions"),
      where("userId", "==", currentUser.uid),
      where("dateSubmitted", "==", todayStr)
    );
    const snap = await getDocs(q);
    const count = snap.docs.length;
    const limitReached = count >= 3;

    dailyLimitCounter.textContent = `Today's Submissions: ${count} / 3${limitReached ? " (Limit Reached)" : ""}`;
    dailyLimitCounter.className = `daily-limit-counter${limitReached ? " limit-reached" : ""}`;

    return count;
  } catch (err) {
    console.warn("Could not check daily limit:", err);
    return 0;
  }
}

// ===== 6. SUBMISSION ENGINE =====
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

  // ===== Daily 3-Slip Limit Check =====
  const todayCount = await updateDailyLimitCounter();
  if (todayCount >= 3) {
    showGlobalMsg("You have reached your limit of 3 prediction slips for today! Please return tomorrow.", "error");
    return;
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
      dateSubmitted: new Date().toISOString().split('T')[0],
      createdAt: serverTimestamp()
    });

    showGlobalMsg("✅ Prediction Slip Submitted Successfully!", "success");

    // Clear slip
    userSlip = [];
    updateSlipBanner();
    await updateDailyLimitCounter();

    await loadFixturesForDate();

    // Refresh history
    loadSlipHistory();
  } catch (err) {
    console.error("Submit error:", err);
    showGlobalMsg("❌ Failed to submit slip. Please try again.", "error");
  } finally {
    isSubmitting = false;
    updateSlipBanner();
  }
}

// ===== 7. SETTLEMENT ENGINE =====
function getScoreWinner(home, away) {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

async function settleSlip(slipDoc, fixtures = []) {
  const data = slipDoc.data();
  const slipId = slipDoc.id;

  if (data.status !== "pending") return;

  let correctCount = 0;
  let settledCount = 0;

  for (const sel of data.slip || []) {
    const fixture = fixtures.find((item) => String(item.fixture_id) === String(sel.matchId));
    if (!fixture) continue;

    const status = String(fixture.status || "").toLowerCase();
    if (!["finished", "ft", "ended"].includes(status)) continue;

    const homeScore = Number(fixture.home_score ?? fixture.homeScore?.current ?? 0);
    const awayScore = Number(fixture.away_score ?? fixture.awayScore?.current ?? 0);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

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
      const correctWinner = getScoreWinner(homeScore, awayScore);
      if (pickValue === correctWinner) correctCount++;
    } else if (pickCategory === "goals") {
      const total = homeScore + awayScore;
      const correctGoals = total > 2.5 ? "over2.5" : "under2.5";
      if (pickValue === correctGoals) correctCount++;
    }
  }

  if (settledCount === 0) return;

  const scoreStr = `${correctCount}/${settledCount}`;

  try {
    if (correctCount >= 6) {
      // Award 2 HP
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
    const fixtures = await getLiveFixtures();
    let settledCount = 0;
    for (const docSnap of snap.docs) {
      const result = await settleSlip(docSnap, fixtures);
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

// ===== 8. LOAD SLIP HISTORY (with expandable picks) =====
async function loadSlipHistory() {
  if (!slipHistoryContainer) return;

  if (!currentUser) {
    slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    return;
  }

  try {
    const q = query(
      collection(db, "user_predictions"),
      where("userId", "==", currentUser.uid)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No prediction slips yet. Select 7 matches and submit!</p>';
      return;
    }

    // Process documents into a usable array
    const filteredDocs = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

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

      // Build expandable picks HTML
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

    // Attach toggle click handlers
    slipHistoryContainer.querySelectorAll('.slip-toggle-btn, .slip-history-header').forEach(el => {
      el.addEventListener('click', (e) => {
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

let pollIntervalId = null;
let fixtureSubscription = null;

async function loadFixturesForDate() {
    if (fixtureFetchInProgress.current) return;
    fixtureFetchInProgress.current = true;

    try {
        const fixtures = await fetchFixturesFromAPI();
        fixtureCache.current = fixtures;
        renderFixtures(fixtures);
    } catch (err) {
        console.error("Error loading fixtures:", err);
        renderFixtures([]);
    } finally {
        fixtureFetchInProgress.current = false;
    }
}
// ===== FEATURE 2: VIEW WINNING SLIP MODAL =====
/**
 * Open a modal showing a user's winning slip details.
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
  const closeBtn = document.getElementById('winningSlipModalClose');
  const overlay = document.getElementById('winningSlipModalOverlay');
  if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());
  if (overlay) overlay.addEventListener('click', () => modal.remove());

  // Fetch the slip data
  try {
    const slipSnap = await getDoc(doc(db, "user_predictions", slipId));
    if (!slipSnap.exists()) {
      const body = modal.querySelector('.winning-slip-modal-body');
      if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;">Slip not found.</div>';
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

    const body = modal.querySelector('.winning-slip-modal-body');
    if (body) {
      body.innerHTML = `
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
    }
  } catch (err) {
    console.error("Winning slip fetch error:", err);
    const body = modal.querySelector('.winning-slip-modal-body');
    if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;">Failed to load slip details.</div>';
  }
}

// ===== 10. LEADERBOARD =====
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
          winningSlipIds: []
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
              <span class="leaderboard-name"><strong>${escapeHtml(displayName)}</strong></span>
              <span class="leaderboard-pts"><strong>${formatHP(u.hpEarned)} HP</strong></span>
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

    // Attach click handlers for View Winning Slip buttons
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

function wireFixtureSubscription() {
  if (fixtureSubscription) return;
  fixtureSubscription = subscribeToFixtureUpdates((fixtures) => {
    fixtureCache.current = fixtures;
    renderFixtures(fixtures.map((fixture) => ({
      fixture_id: fixture.fixture_id,
      league: fixture.league_name,
      league_logo: fixture.league_logo,
      homeTeam: fixture.home_team_name,
      homeTeamLogo: fixture.home_team_logo,
      awayTeam: fixture.away_team_name,
      awayTeamLogo: fixture.away_team_logo,
      date: fixture.kickoff_time,
      kickoff: fixture.kickoff_time,
      status: fixture.status,
      minute: fixture.minute,
      homeScore: fixture.home_score,
      awayScore: fixture.away_score
    })));
  });
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
    if (dailyLimitCounter) {
      dailyLimitCounter.textContent = "";
    }
    if (slipHistoryContainer) {
      slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    }
  }

  buildCalendar();
  wireFixtureSubscription();
  await loadFixturesForDate();
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
    wireFixtureSubscription();
    loadFixturesForDate();
    loadLeaderboard();
  }
  updateSlipBanner();
  startPolling();
});

// ===== AUTO-REFRESH POLLING (every 45 seconds) =====
function startPolling() {
    stopPolling();
    pollIntervalId = setInterval(() => {
        loadFixturesForDate();
    }, 45000);
}

function stopPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }
}
