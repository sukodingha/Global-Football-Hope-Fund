/**
 * GFHF Prediction League Module (OVERHAULED)
 * - 5-day rolling calendar tab selector
 * - 20 fixtures per date with future kick-off times
 * - userSlip array (7 picks required)
 * - Save to Firestore "user_predictions" collection
 * - Settlement engine: >=6/7 correct → 2 HP
 * - History query without orderBy to prevent index crashes
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, getDocs, addDoc, collection, query, where, updateDoc, increment, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHPBadgeHTML, getUserHP } from "./rewards.js";

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

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserUniqueId = "";

/** @type {{ matchId: string, winner: "1"|"X"|"2", goals: "over2.5"|"under2.5", homeTeam: string, awayTeam: string, league: string, kickoff: string }[]} */
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
      // Update active tab styling
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

    // Auto-select first day (today) if none selected
    if (i === 0 && !selectedDateStr) {
      selectedDateStr = dateStr;
      btn.style.background = "#00c853";
      btn.style.color = "#fff";
    }
  }
}

// ===== 2. GENERATE 20 FIXTURES PER DATE (dynamic times + shuffled pairings per day) =====
const TEAMS_POOL = [
  { league: "Premier League", home: "Arsenal", away: "Chelsea" },
  { league: "Premier League", home: "Liverpool", away: "Manchester City" },
  { league: "Premier League", home: "Manchester United", away: "Tottenham" },
  { league: "Premier League", home: "Newcastle", away: "Aston Villa" },
  { league: "Premier League", home: "West Ham", away: "Brighton" },
  { league: "La Liga", home: "Barcelona", away: "Real Madrid" },
  { league: "La Liga", home: "Atletico Madrid", away: "Sevilla" },
  { league: "La Liga", home: "Valencia", away: "Real Sociedad" },
  { league: "Serie A", home: "Inter Milan", away: "AC Milan" },
  { league: "Serie A", home: "Juventus", away: "AS Roma" },
  { league: "Serie A", home: "Napoli", away: "Lazio" },
  { league: "Bundesliga", home: "Bayern Munich", away: "Borussia Dortmund" },
  { league: "Bundesliga", home: "RB Leipzig", away: "Bayer Leverkusen" },
  { league: "Bundesliga", home: "Eintracht Frankfurt", away: "Borussia M'gladbach" },
  { league: "Ligue 1", home: "PSG", away: "Marseille" },
  { league: "Ligue 1", home: "Monaco", away: "Lyon" },
  { league: "Premier League", home: "Crystal Palace", away: "Everton" },
  { league: "La Liga", home: "Athletic Bilbao", away: "Villarreal" },
  { league: "Serie A", home: "Fiorentina", away: "Atalanta" },
  { league: "Premier League", home: "Wolves", away: "Fulham" },
];

/**
 * Deterministic shuffle based on a seed string (dateStr).
 * Produces a rotated copy of the teams array so each date shows different pairings.
 */
function getShuffledTeamsForDate(dateStr) {
  // Compute a numeric seed from the date string
  let seed = 0;
  for (let i = 0; i < dateStr.length; i++) {
    seed = (seed * 31 + dateStr.charCodeAt(i)) | 0;
  }
  const rotateBy = ((seed % 20) + 20) % 20; // 0-19 rotation offset

  // Rotate the pool by this offset
  const pool = [...TEAMS_POOL];
  const rotated = [];
  for (let i = 0; i < pool.length; i++) {
    rotated.push(pool[(i + rotateBy) % pool.length]);
  }
  return rotated;
}

/**
 * Generate 20 fixtures for a given date with dynamic kick-off times.
 * For TODAY: starts from currentHour + 1, spreads across remaining hours up to 23:00.
 * For FUTURE dates: uses standard time slots (12:00, 14:30, 17:00, 19:30, 21:00).
 * Filters out any match whose kick-off has already passed.
 */
function generateFixturesForDate(dateStr) {
  const now = Date.now();
  const isTodayDate = isToday(dateStr);
  const shuffled = getShuffledTeamsForDate(dateStr);

  // Build dynamic kick-off slots based on whether it's today or future
  const slots = [];

  if (isTodayDate) {
    // TODAY: start from currentHour + 1, spread across remaining hours up to 23:00
    const currentHour = new Date().getHours();
    let startHour = currentHour + 1; // strictly after current time
    if (startHour < 10) startHour = 10; // earliest reasonable slot

    const possibleMinutes = [0, 15, 30, 45];
    let slotIndex = 0;
    for (let h = startHour; h <= 22; h++) {
      const m = possibleMinutes[slotIndex % possibleMinutes.length];
      slots.push({ hour: h, minute: m });
      slotIndex++;
      if (slotIndex >= 20) break; // max 20 slots
    }
  } else {
    // FUTURE DATE: standard time slots across the day
    const futureSlots = [
      { hour: 12, minute: 0 },
      { hour: 12, minute: 30 },
      { hour: 14, minute: 0 },
      { hour: 14, minute: 30 },
      { hour: 16, minute: 0 },
      { hour: 16, minute: 30 },
      { hour: 17, minute: 0 },
      { hour: 17, minute: 30 },
      { hour: 18, minute: 0 },
      { hour: 18, minute: 30 },
      { hour: 19, minute: 0 },
      { hour: 19, minute: 30 },
      { hour: 20, minute: 0 },
      { hour: 20, minute: 30 },
      { hour: 21, minute: 0 },
      { hour: 21, minute: 30 },
      { hour: 22, minute: 0 },
      { hour: 22, minute: 30 },
      { hour: 23, minute: 0 },
      { hour: 23, minute: 30 },
    ];
    slots.push(...futureSlots);
  }

  const results = [];
  const baseDate = new Date(dateStr + "T00:00:00");

  for (let i = 0; i < shuffled.length && i < slots.length; i++) {
    const t = shuffled[i];
    const slot = slots[i];
    const kickoff = new Date(baseDate);
    kickoff.setHours(slot.hour, slot.minute, 0, 0);

    // Filter out matches whose kick-off time has already passed
    if (kickoff.getTime() <= now) continue;

    results.push({
      id: `fix_${dateStr.replace(/-/g,"")}_${i + 1}`,
      league: t.league,
      homeTeam: t.home,
      awayTeam: t.away,
      date: kickoff.toISOString(),
      status: "upcoming"
    });
  }

  // If too many were filtered (e.g. late hour today), pad with future-dated fallback slots
  if (results.length < 7) {
    // Push remaining shuffled teams into late-night slots (all in the future)
    const padDate = new Date(now + 3600000 * (results.length + 1));
    for (let i = results.length; i < shuffled.length; i++) {
      const t = shuffled[i];
      const kickoff = new Date(padDate);
      kickoff.setHours(19 + (i % 4), (i % 2) * 30, 0, 0);
      if (kickoff.getTime() <= now) {
        kickoff.setTime(kickoff.getTime() + 7200000); // +2h
      }
      results.push({
        id: `fix_${dateStr.replace(/-/g,"")}_${i + 1}`,
        league: t.league,
        homeTeam: t.home,
        awayTeam: t.away,
        date: kickoff.toISOString(),
        status: "upcoming"
      });
    }
  }

  return results;
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
          <div class="prediction-section-label">🎯 Winner</div>
          <div class="winner-buttons">
            <button class="pred-btn pick-btn${slipEntry && slipEntry.winner === "1" ? " active" : ""}" data-match="${matchId}" data-pick="winner_1">
              <span class="pred-btn-label">1</span>
              <span class="pred-btn-team">${escapeHtml(match.homeTeam)}</span>
            </button>
            <button class="pred-btn pick-btn${slipEntry && slipEntry.winner === "X" ? " active" : ""}" data-match="${matchId}" data-pick="winner_X">
              <span class="pred-btn-label">X</span>
              <span class="pred-btn-team">Draw</span>
            </button>
            <button class="pred-btn pick-btn${slipEntry && slipEntry.winner === "2" ? " active" : ""}" data-match="${matchId}" data-pick="winner_2">
              <span class="pred-btn-label">2</span>
              <span class="pred-btn-team">${escapeHtml(match.awayTeam)}</span>
            </button>
          </div>
        </div>
        <!-- Goals selection -->
        <div class="prediction-section">
          <div class="prediction-section-label">⚽ Total Goals</div>
          <div class="goals-buttons">
            <button class="pred-btn pick-btn${slipEntry && slipEntry.goals === "over2.5" ? " active" : ""}" data-match="${matchId}" data-pick="goals_over2.5">Over 2.5</button>
            <button class="pred-btn pick-btn${slipEntry && slipEntry.goals === "under2.5" ? " active" : ""}" data-match="${matchId}" data-pick="goals_under2.5">Under 2.5</button>
          </div>
        </div>
      </div>
    `;
  });

  fixturesContainer.innerHTML = html;

  // Attach pick button handlers
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

// ===== 4. PICK HANDLER — toggle/swap logic =====
function handlePick(btn) {
  const matchId = btn.dataset.match;
  const pick = btn.dataset.pick; // e.g. "winner_1" or "goals_over2.5"

  // Find match data from rendered fixtures
  const card = btn.closest(".odds-card");
  const teamEls = card.querySelectorAll(".odds-team");
  const leagueEl = card.querySelector(".league-pill");
  const timeEl = card.querySelector(".odds-time");
  const homeTeam = teamEls[0]?.textContent || "Home";
  const awayTeam = teamEls[1]?.textContent || "Away";
  const league = leagueEl?.textContent?.replace("⚽ ", "") || "";
  const kickoff = ""; // not critical for submission

  // Determine category and value
  let category, value;
  if (pick.startsWith("winner_")) {
    category = "winner";
    value = pick.replace("winner_", ""); // "1", "X", or "2"
  } else if (pick.startsWith("goals_")) {
    category = "goals";
    value = pick.replace("goals_", ""); // "over2.5" or "under2.5"
  } else {
    return;
  }

  // Find existing entry for this match in the slip
  const existingIdx = userSlip.findIndex(s => s.matchId === matchId);

  if (existingIdx === -1) {
    // No existing entry — create one
    const entry = {
      matchId,
      winner: category === "winner" ? value : null,
      goals: category === "goals" ? value : null,
      homeTeam,
      awayTeam,
      league,
      kickoff
    };
    userSlip.push(entry);
  } else {
    const entry = userSlip[existingIdx];

    if (category === "winner") {
      if (entry.winner === value) {
        // Same winner clicked → deselect entirely
        entry.winner = null;
      } else {
        // Different winner → swap
        entry.winner = value;
      }
    } else if (category === "goals") {
      if (entry.goals === value) {
        // Same goals clicked → deselect entirely
        entry.goals = null;
      } else {
        // Different goals → swap
        entry.goals = value;
      }
    }

    // If both winner and goals are null, remove the entry entirely
    if (entry.winner === null && entry.goals === null) {
      userSlip.splice(existingIdx, 1);
    }
  }

  // Update all visual states for this match
  updateCardVisuals(matchId);
  updateSlipBanner();
}

function updateCardVisuals(matchId) {
  const card = document.querySelector(`.odds-card[data-match-id="${matchId}"]`);
  if (!card) return;

  const entry = userSlip.find(s => s.matchId === matchId);

  // Update winner buttons
  card.querySelectorAll('[data-pick^="winner_"]').forEach(b => {
    const val = b.dataset.pick.replace("winner_", "");
    b.classList.toggle("active", entry ? entry.winner === val : false);
  });

  // Update goals buttons
  card.querySelectorAll('[data-pick^="goals_"]').forEach(b => {
    const val = b.dataset.pick.replace("goals_", "");
    b.classList.toggle("active", entry ? entry.goals === val : false);
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

// ===== 6. SUBMISSION ENGINE =====
async function submitSlip() {
  if (!currentUser) { showGlobalMsg("Please sign in first.", "error"); return; }
  if (isSubmitting) return;
  if (userSlip.length !== 7) { showGlobalMsg("You must select exactly 7 matches.", "error"); return; }

  // Validate all entries have both winner and goals
  const invalid = userSlip.some(s => !s.winner || !s.goals);
  if (invalid) {
    showGlobalMsg("Each match needs both a winner pick AND goals pick.", "error");
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

    // Re-render fixtures to clear visual selections
    if (selectedDateStr) loadFixturesForDate(selectedDateStr);

    // Refresh history
    loadSlipHistory();
  } catch (err) {
    console.error("Submit error:", err);
    showGlobalMsg("Failed to submit slip. Try again.", "error");
  } finally {
    isSubmitting = false;
    updateSlipBanner();
  }
}

// ===== 7. SETTLEMENT ENGINE =====
function getMockResult(matchId) {
  const hash = matchId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const homeScore = hash % 5;       // 0-4
  const awayScore = (hash * 3) % 4; // 0-3
  return { homeScore, awayScore };
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

  data.slip.forEach(sel => {
    const result = getMockResult(sel.matchId);
    const correctWinner = getScoreWinner(result.homeScore, result.awayScore);
    const total = result.homeScore + result.awayScore;
    const correctGoals = total > 2.5 ? "over2.5" : "under2.5";

    const winnerOk = sel.winner === correctWinner;
    const goalsOk = sel.goals === correctGoals;
    if (winnerOk && goalsOk) correctCount++;
  });

  const scoreStr = `${correctCount}/7`;

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

    return { slipId, correctCount, rewarded: correctCount >= 6 };
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

// ===== 8. HISTORY (NO orderBy — prevents index crash) =====
async function loadSlipHistory() {
  if (!slipHistoryContainer || !currentUser) return;

  try {
    // No orderBy to prevent composite index requirement
    const q = query(
      collection(db, "user_predictions"),
      where("userId", "==", currentUser.uid),
      limit(50)
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

    let html = "";
    docs.forEach(slip => {
      const dateStr = slip.dateSubmitted || "—";
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

      html += `
        <div class="slip-history-item ${statusClass}">
          <div class="slip-history-header">
            <span><strong>${dateStr}</strong></span>
            <span style="font-size:12px;color:rgba(255,255,255,0.5);">${slip.slip?.length || 0} picks</span>
          </div>
          <div style="font-size:13px;">${statusText}</div>
        </div>
      `;
    });

    slipHistoryContainer.innerHTML = html;
  } catch (err) {
    console.warn("Load history error:", err);
    slipHistoryContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Could not load history.</p>';
  }
}

// ===== 9. FETCH FIXTURES PER DATE =====
function loadFixturesForDate(dateStr) {
  if (!fixturesContainer) return;
  fixturesContainer.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7);"><p style="padding:40px 0;">⏳ Loading fixtures...</p></div>';

  // Generate 20 fixtures for the selected date
  const fixtures = generateFixturesForDate(dateStr);
  renderFixtures(fixtures);
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

    const userRewards = {};
    snap.docs.forEach(docSnap => {
      const slip = docSnap.data();
      if (!slip.userId) return;
      if (!userRewards[slip.userId]) {
        userRewards[slip.userId] = {
          userId: slip.userId,
          userName: slip.userName || "Anonymous",
          totalSlips: 0,
          hpEarned: 0
        };
      }
      userRewards[slip.userId].totalSlips++;
      userRewards[slip.userId].hpEarned += 2;
    });

    const sorted = Object.values(userRewards).sort((a, b) => b.hpEarned - a.hpEarned);

    // Mock fallback if empty
    let displayUsers = sorted;
    if (displayUsers.length === 0) {
      displayUsers = [
        { userId: "mock_1", userName: "Alex M.", totalSlips: 5, hpEarned: 8 },
        { userId: "mock_2", userName: "Sarah K.", totalSlips: 4, hpEarned: 6 },
        { userId: "mock_3", userName: "Marco R.", totalSlips: 3, hpEarned: 4 },
        { userId: "mock_4", userName: "Yuki T.", totalSlips: 3, hpEarned: 4 },
        { userId: "mock_5", userName: "Emma W.", totalSlips: 2, hpEarned: 2 },
      ];
    }

    const currentUserId = currentUser?.uid;

    leaderboardContainer.innerHTML = `
      <div class="leaderboard-table">
        <div class="leaderboard-header">
          <span>#</span>
          <span>Player</span>
          <span>HP 🏆</span>
          <span>Slips</span>
        </div>
        ${displayUsers.map((u, i) => {
          const isYou = u.userId === currentUserId;
          const rank = i + 1;
          const rankDisplay = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
          const displayName = isYou ? `${u.userName} (You)` : u.userName;
          return `
            <div class="leaderboard-row ${isYou ? "leaderboard-you" : ""}">
              <span class="leaderboard-rank">${rankDisplay}</span>
              <span class="leaderboard-name"><strong>${displayName}</strong></span>
              <span class="leaderboard-pts"><strong>${u.hpEarned} HP</strong></span>
              <span class="leaderboard-exact">${u.totalSlips}</span>
            </div>
          `;
        }).join("")}
      </div>
      <div class="leaderboard-legend">
        <p>🏆 Get <strong>6/7</strong> correct predictions to earn <strong>2 HP</strong> per slip!</p>
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
  } else {
    currentUserUniqueId = "";
    currentUserName = "Guest";
    if (userStatus) {
      userStatus.textContent = "Sign in to make predictions!";
      userStatus.classList.remove("active");
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

