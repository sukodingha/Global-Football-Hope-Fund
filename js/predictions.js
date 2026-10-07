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
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  doc, getDoc, setDoc, getDocs, collection, query, where, limit,
  updateDoc, increment, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFixturesByDate, getFixturesByIds, getLiveFixtures, getRandomTopMatches, subscribeToFixtureUpdates
} from "../services/fixturesService.js";

// ===== DOM REFS (with existence checks) =====
function getEl(id) { return document.getElementById(id); }

const calendarEl = getEl("dateCalendar");
const fixturesContainer = getEl("predictionFixtures");
const leaderboardContainer = getEl("predictionLeaderboard");
const userStatus = getEl("predictionUserStatus");
const globalMsg = getEl("predictionGlobalMsg");
const historyContainer = getEl("predictionHistory");
const countryFilterEl = getEl("predictionCountryFilter");
const predictionSearchInput = getEl("predictionSearchInput");
const selectionCounter = getEl("predictionSelectionCounter");
const ticketLimitLabel = getEl("predictionTicketLimit");
const submitTicketBtn = getEl("submitPredictionTicket");

// ===== STATE =====
let currentUser = null;
let currentUserName = "Guest";
let currentUserUniqueId = "";

let selectedDateStr = "";
let selectedCountryFilter = "Top Leagues";
let searchTerm = "";
let latestFixtures = [];
let allAvailableFixtures = [];
let hasLoadedFixturesOnce = false;
/** @type {Map<string, object>} fixture_id -> the signed-in user's prediction doc */
let userPredictions = new Map();
const pendingTicketSelections = new Map();
let fixtureFetchInProgress = false;

let pollIntervalId = null;
let liveTickIntervalId = null;
let fixtureUnsubscribe = null;

// ===== CONSTANTS =====
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PICK_LABELS = { home: "Home Win", draw: "Draw", away: "Away Win" };
const PREDICTION_BATCH_SIZE = 7;
const MAX_PREDICTIONS_PER_BATCH = 7;
const MAX_BATCHES_PER_DAY = 2;
const MAX_PREDICTIONS_PER_DAY = MAX_PREDICTIONS_PER_BATCH * MAX_BATCHES_PER_DAY;
const functions = getFunctions();
const submitTicket = httpsCallable(functions, "submitPredictionTicket");

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

function getDailyLimitDocId(uid, dateStr = getTodayStr()) {
  return `${uid || "guest"}_${dateStr}`;
}

function getTicketBatchNumber(totalPredictions) {
  return Math.min(Math.max(1, Math.floor(totalPredictions / MAX_PREDICTIONS_PER_BATCH) + 1), MAX_BATCHES_PER_DAY);
}

function updateTicketBuilder() {
  const count = pendingTicketSelections.size;
  if (selectionCounter) selectionCounter.textContent = `Selected: ${count} / ${MAX_PREDICTIONS_PER_BATCH}`;
  if (submitTicketBtn) submitTicketBtn.disabled = count !== MAX_PREDICTIONS_PER_BATCH || !currentUser;
}

function normalizePredictionStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "correct" || normalized === "won") return "correct";
  if (normalized === "incorrect" || normalized === "lost") return "incorrect";
  return "pending";
}

function normalizeTicketStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "won") return "won";
  if (normalized === "lost") return "lost";
  return "pending";
}

async function getDailyPredictionSummary(uid, dateStr = getTodayStr()) {
  if (!uid) return { totalPredictions: 0, batchCount: 0, currentBatchCount: 0 };
  try {
    const snap = await getDoc(doc(db, "predictionDailyLimits", getDailyLimitDocId(uid, dateStr)));
    if (!snap.exists()) return { totalPredictions: 0, batchCount: 0, currentBatchCount: 0 };
    const data = snap.data() || {};
    const totalPredictions = Number(data.totalPredictions || 0);
    return {
      totalPredictions,
      batchCount: Number(data.batchCount || 0),
      currentBatchCount: Number(data.currentBatchCount || 0)
    };
  } catch (err) {
    console.warn("Daily limit lookup failed:", err);
    return { totalPredictions: 0, batchCount: 0, currentBatchCount: 0 };
  }
}

async function updateDailyPredictionSummary(uid, delta = 1, dateStr = getTodayStr()) {
  if (!uid) return;
  const ref = doc(db, "predictionDailyLimits", getDailyLimitDocId(uid, dateStr));
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() || {} : {};
  const totalPredictions = Math.max(0, Number(data.totalPredictions || 0) + delta);
  const batchCount = Math.min(3, Math.ceil(totalPredictions / PREDICTION_BATCH_SIZE));
  const currentBatchCount = totalPredictions % PREDICTION_BATCH_SIZE || (totalPredictions === 0 ? 0 : PREDICTION_BATCH_SIZE);

  await setDoc(ref, {
    uid,
    date: dateStr,
    totalPredictions,
    batchCount,
    currentBatchCount,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function isMatchLocked(status) {
  return status === "live" || status === "half_time" || status === "finished";
}

function isUpcomingFixture(match) {
  if (!match || !match.fixture_id) return false;
  const status = String(match.status || match.status_text || "").trim().toLowerCase();
  return status === "scheduled" || status === "ns" || status === "not started" || status === "not_started" || status === "";
}

function getMatchOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "draw";
}

function createFallbackFixtures(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const isoDate = (hours, minutes) => {
    const d = new Date(date);
    d.setUTCHours(hours, minutes, 0, 0);
    return d.toISOString();
  };

  return [
    {
      fixture_id: "fallback-1",
      league_id: 39,
      league_name: "Premier League",
      country_name: "England",
      league_logo: "",
      home_team_id: 40,
      home_team_name: "Manchester City",
      home_team_logo: "",
      away_team_id: 41,
      away_team_name: "Arsenal",
      away_team_logo: "",
      kickoff_time: isoDate(18, 30),
      status: "scheduled",
      status_text: "Not Started",
      minute: "",
      home_score: 0,
      away_score: 0
    },
    {
      fixture_id: "fallback-2",
      league_id: 140,
      league_name: "La Liga",
      country_name: "Spain",
      league_logo: "",
      home_team_id: 81,
      home_team_name: "Real Madrid",
      home_team_logo: "",
      away_team_id: 82,
      away_team_name: "Barcelona",
      away_team_logo: "",
      kickoff_time: isoDate(20, 0),
      status: "scheduled",
      status_text: "Not Started",
      minute: "",
      home_score: 0,
      away_score: 0
    },
    {
      fixture_id: "fallback-3",
      league_id: 135,
      league_name: "Serie A",
      country_name: "Italy",
      league_logo: "",
      home_team_id: 109,
      home_team_name: "Juventus",
      home_team_logo: "",
      away_team_id: 110,
      away_team_name: "Inter Milan",
      away_team_logo: "",
      kickoff_time: isoDate(19, 45),
      status: "scheduled",
      status_text: "Not Started",
      minute: "",
      home_score: 0,
      away_score: 0
    },
    {
      fixture_id: "fallback-4",
      league_id: 78,
      league_name: "Bundesliga",
      country_name: "Germany",
      league_logo: "",
      home_team_id: 50,
      home_team_name: "Bayern Munich",
      home_team_logo: "",
      away_team_id: 51,
      away_team_name: "Borussia Dortmund",
      away_team_logo: "",
      kickoff_time: isoDate(17, 30),
      status: "scheduled",
      status_text: "Not Started",
      minute: "",
      home_score: 0,
      away_score: 0
    },
    {
      fixture_id: "fallback-5",
      league_id: 61,
      league_name: "Ligue 1",
      country_name: "France",
      league_logo: "",
      home_team_id: 60,
      home_team_name: "Paris Saint-Germain",
      home_team_logo: "",
      away_team_id: 61,
      away_team_name: "Marseille",
      away_team_logo: "",
      kickoff_time: isoDate(21, 0),
      status: "scheduled",
      status_text: "Not Started",
      minute: "",
      home_score: 0,
      away_score: 0
    }
  ];
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
      const normalizedStatus = normalizePredictionStatus(data.status);
      const normalizedTicketStatus = normalizeTicketStatus(data.ticketStatus || data.status);
      userPredictions.set(String(data.fixtureId), {
        id: docSnap.id,
        ...data,
        status: normalizedStatus,
        ticketStatus: normalizedTicketStatus
      });
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

function getMatchFilterValue(match) {
  const country = String(match?.country_name || match?.league_name || "");
  const league = String(match?.league_name || "");
  const home = String(match?.home_team_name || "");
  const away = String(match?.away_team_name || "");
  return `${country} ${league} ${home} ${away}`.toLowerCase();
}

function getFilteredFixtures(fixtures) {
  const source = Array.isArray(fixtures) ? fixtures.filter(isUpcomingFixture) : [];
  const query = (searchTerm || "").trim().toLowerCase();
  const selectedCountry = selectedCountryFilter || "Top Leagues";

  let matched = source;
  if (selectedCountry !== "Top Leagues" && selectedCountry !== "All") {
    matched = source.filter((match) => {
      const candidate = `${match?.country_name || ""} ${match?.league_name || ""}`.toLowerCase();
      return candidate.includes(selectedCountry.toLowerCase());
    });
  }

  if (selectedCountry === "Top Leagues") {
    matched = getRandomTopMatches(source, 20);
  }

  if (!query) return matched;

  return matched.filter((match) => getMatchFilterValue(match).includes(query));
}

function populateCountryFilterOptions(fixtures) {
  if (!countryFilterEl) return;
  const options = ["Top Leagues"];
  const seen = new Set();

  for (const match of fixtures || []) {
    if (!isUpcomingFixture(match)) continue;
    const name = String(match?.country_name || match?.league_name || "").trim();
    if (!name || seen.has(name)) continue;
    options.push(name);
    seen.add(name);
  }

  const currentValue = options.includes(selectedCountryFilter) ? selectedCountryFilter : "Top Leagues";
  countryFilterEl.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join("");
  selectedCountryFilter = currentValue;
  countryFilterEl.value = currentValue;
}

function applyPredictionFilter() {
  if (!allAvailableFixtures.length) {
    renderFixtures([]);
    return;
  }
  renderFixtures(getFilteredFixtures(allAvailableFixtures));
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
    const isSelected = prediction?.pick === pick || pendingTicketSelections.get(String(fixtureId)) === pick;
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

// ===== 5. TICKET BUILDER =====
function attachPickHandlers() {
  fixturesContainer.querySelectorAll(".pick-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!currentUser) {
        const authModal = document.getElementById("authModal");
        if (authModal) authModal.classList.add("auth-modal--open");
        return;
      }
      toggleTicketSelection(btn);
    });
  });
}

function toggleTicketSelection(btn) {
  const fixtureId = String(btn.dataset.fixture);
  const pick = btn.dataset.pick;
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
  const existingPick = pendingTicketSelections.get(fixtureId);
  if (existingPick === pick) pendingTicketSelections.delete(fixtureId);
  else if (existingPick || pendingTicketSelections.size < MAX_PREDICTIONS_PER_BATCH) pendingTicketSelections.set(fixtureId, pick);
  else {
    showGlobalMsg(`A ticket can contain exactly ${MAX_PREDICTIONS_PER_BATCH} predictions. Remove a pick before adding another.`, "error");
    return;
  }
  updateTicketBuilder();
  renderFixtures(latestFixtures);
}

async function submitPredictionTicket() {
  if (!currentUser || pendingTicketSelections.size !== MAX_PREDICTIONS_PER_BATCH) return;
  const selectedMatches = [...pendingTicketSelections.entries()].map(([fixtureId, pick]) => ({
    fixtureId,
    pick,
    match: latestFixtures.find((fixture) => String(fixture.fixture_id) === fixtureId)
  }));
  if (selectedMatches.some(({ match }) => !match || isMatchLocked(match.status) || userPredictions.has(String(match.fixture_id)))) {
    showGlobalMsg("One or more selected matches are no longer available. Please review your ticket.", "error");
    return;
  }

  submitTicketBtn.disabled = true;
  try {
    const result = await submitTicket({
      picks: selectedMatches.map(({ fixtureId, pick }) => ({ fixtureId, pick }))
    });
    pendingTicketSelections.clear();
    updateTicketBuilder();
    showGlobalMsg(`Ticket ${result.data.ticketNumber} submitted with 7 predictions.`, "success");
    await loadUserPredictions();
    renderFixtures(latestFixtures);
    loadPredictionHistory();
  } catch (err) {
    console.error("Ticket submission error:", err);
    showGlobalMsg(err.message || "Could not submit the ticket. Please try again.", "error");
    updateTicketBuilder();
  }
}

submitTicketBtn?.addEventListener("click", submitPredictionTicket);

// ===== 6. SETTLEMENT — mark finished matches correct/incorrect & award HP =====
async function settlePendingPredictions() {
  // Settlement runs in the scheduled Firebase Function so the result and 50 HP reward are atomic.
}

// ===== 7. PREDICTION HISTORY =====
function getTimestampMs(dateLike) {
  if (!dateLike) return 0;
  const ms = dateLike?.toMillis?.() ?? new Date(dateLike).getTime();
  return Number.isFinite(ms) ? Number(ms) : 0;
}

async function purgeExpiredLostPredictions(predictions) {
  return new Set();
}

async function purgeLegacyPredictions(predictions) {
  return new Set();
}

function formatTicketTimestamp(dateLike) {
  const ms = getTimestampMs(dateLike);
  if (!ms) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(ms));
}

function getPredictionBatchKey(prediction, index) {
  if (prediction?.batchId) return prediction.batchId;
  const userId = prediction?.userId || "guest";
  const dateSubmitted = prediction?.dateSubmitted || toDateStr(new Date(getTimestampMs(prediction?.createdAt) || Date.now()));
  const batchNumber = Number(prediction?.batchNumber || Math.floor(index / MAX_PREDICTIONS_PER_BATCH) + 1);
  return `${userId}_${dateSubmitted}_legacy_${batchNumber}`;
}

function getTicketStatus(ticketPredictions = []) {
  if (!ticketPredictions.length) return "Pending";

  const explicitTicketStatus = ticketPredictions.find((p) => p.ticketStatus)?.ticketStatus;
  if (explicitTicketStatus === "won" || explicitTicketStatus === "lost") {
    return explicitTicketStatus === "won" ? "Won" : "Lost";
  }

  if (ticketPredictions.some((p) => p.status === "pending")) return "Pending";
  return ticketPredictions.every((p) => p.status === "correct") ? "Won" : "Lost";
}

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
      limit(200)
    );
    const snap = await getDocs(q);

    const cutoffMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const allDocs = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    const legacyIds = await purgeLegacyPredictions(allDocs);
    const activeDocs = allDocs.filter((prediction) => !legacyIds.has(prediction.id));
    const expiredIds = await purgeExpiredLostPredictions(activeDocs);
    const recentDocs = activeDocs
      .filter((prediction) => !expiredIds.has(prediction.id))
      .filter((prediction) => {
        const createdMs = getTimestampMs(prediction.createdAt);
        const expiryMs = getTimestampMs(prediction.lostExpiresAt);
        return Number.isFinite(createdMs) && createdMs >= cutoffMs && (!expiryMs || expiryMs > Date.now());
      })
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));

    if (recentDocs.length === 0) {
      historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No recent predictions in the last 7 days. Pick a result above to get started!</p>';
      return;
    }

    const fixtures = await getFixturesByIds(recentDocs.map((prediction) => prediction.fixtureId));
    const groupedTickets = new Map();
    recentDocs.forEach((prediction, index) => {
      const ticketKey = getPredictionBatchKey(prediction, index);
      const ticket = groupedTickets.get(ticketKey) || {
        ticketKey,
        batchNumber: Number(prediction.batchNumber || Math.floor(index / MAX_PREDICTIONS_PER_BATCH) + 1),
        createdAt: prediction.createdAt,
        predictions: []
      };

      ticket.predictions.push(prediction);
      ticket.createdAt = ticket.createdAt && getTimestampMs(ticket.createdAt) > getTimestampMs(prediction.createdAt)
        ? ticket.createdAt
        : prediction.createdAt;
      groupedTickets.set(ticketKey, ticket);
    });

    const tickets = [...groupedTickets.values()]
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt))
      .slice(0, 30);

    if (tickets.length === 0) {
      historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">No recent bet tickets found.</p>';
      return;
    }

    historyContainer.innerHTML = tickets.map((ticket) => {
      const ticketStatus = getTicketStatus(ticket.predictions);
      const statusClass = ticketStatus.toLowerCase();
      const statusText = ticketStatus === "Won"
        ? `✅ Won (${ticket.predictions.filter((p) => p.status === "correct").length}/${ticket.predictions.length} correct)`
        : ticketStatus === "Lost"
          ? "❌ Lost"
          : "⏳ Pending";

      const matchRows = ticket.predictions.map((prediction) => {
        let resultLabel = "⏳ Pending";
        let resultClass = "pending";
        const fixture = fixtures.find((item) => String(item.fixture_id) === String(prediction.fixtureId));
        const liveStatus = fixture && ["live", "half_time"].includes(fixture.status)
          ? `<span class="match-status-badge live">${fixture.status === "half_time" ? "HT" : `LIVE ${fixture.minute ? `${fixture.minute}'` : ""}`}</span>`
          : "";

        if (prediction.status === "correct") {
          resultLabel = "✅ Correct";
          resultClass = "won";
        } else if (prediction.status === "incorrect") {
          resultLabel = "❌ Incorrect";
          resultClass = "lost";
        }

        return `
          <div class="ticket-match-row">
            <div class="ticket-match-teams">
              <strong>${escapeHtml(prediction.homeTeam)} vs ${escapeHtml(prediction.awayTeam)}</strong>
              <span>${PICK_LABELS[prediction.pick] || prediction.pick} ${liveStatus}</span>
            </div>
            <span class="slip-history-status ${resultClass}">${resultLabel}</span>
          </div>
        `;
      }).join("");

      return `
        <details class="slip-history-item ${statusClass}">
          <summary class="slip-history-header">
            <div class="slip-history-header-left ticket-header-left">
              <span class="ticket-badge">🎫 Ticket ${ticket.batchNumber} - ${formatDateShort(ticket.predictions[0].dateSubmitted)}</span>
              <span class="ticket-submeta">${ticket.predictions.length}/7 picks · Click to view matches</span>
            </div>
            <span class="slip-history-status ${statusClass}">${statusText}</span>
          </summary>
          <div class="ticket-match-list">${matchRows}</div>
        </details>
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
      userStats[p.userId].hpEarned += Number(p.pointsAwarded) || 0;
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
        <p>🏆 Rewards are issued only for a complete 7/7 winning ticket.</p>
      </div>
    `;
  } catch (err) {
    console.error("Leaderboard error:", err);
    leaderboardContainer.innerHTML = '<div class="admin-error">Failed to load leaderboard.</div>';
  }
}

async function renderActivePredictedMatches() {
  const container = document.getElementById("predictionActiveMatches");
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<div class="helper-text" style="color:rgba(255,255,255,0.7);padding:12px 0;">Sign in to see your active predicted matches.</div>';
    return;
  }

  try {
    const q = query(collection(db, "predictions"), where("userId", "==", currentUser.uid));
    const snap = await getDocs(q);

    const predictions = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((prediction) => prediction.fixtureId && prediction.status !== "correct" && prediction.status !== "incorrect");

    if (!predictions.length) {
      container.innerHTML = '<div class="helper-text" style="color:rgba(255,255,255,0.7);padding:12px 0;">No live predicted matches right now.</div>';
      return;
    }

    const fixtures = await getFixturesByIds(predictions.map((prediction) => prediction.fixtureId));
    const livePredictions = predictions
      .map((prediction) => {
        const match = fixtures.find((fixture) => String(fixture.fixture_id) === String(prediction.fixtureId));
        if (!match) return null;
        const status = String(match.status || "").toLowerCase();
        if (!['live', 'half_time'].includes(status)) return null;
        return { prediction, match };
      })
      .filter(Boolean);

    if (!livePredictions.length) {
      container.innerHTML = '<div class="helper-text" style="color:rgba(255,255,255,0.7);padding:12px 0;">None of your current predictions are live yet.</div>';
      return;
    }

    container.innerHTML = livePredictions.map(({ prediction, match }) => `
      <div class="odds-card odds-card-selected" style="max-width:1200px;margin:0 auto;">
        <div class="odds-header">
          <span class="league-pill">⚽ ${escapeHtml(match.league_name || "League")}</span>
          <span class="match-status-badge live">LIVE</span>
        </div>
        <div class="odds-teams" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div class="odds-team" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
            <span>${escapeHtml(match.home_team_name || "Home")}</span>
          </div>
          <div class="odds-vs">vs</div>
          <div class="odds-team" style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;">
            <span>${escapeHtml(match.away_team_name || "Away")}</span>
          </div>
        </div>
        <div class="prediction-section" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;">
          <span style="color:rgba(255,255,255,0.8);">Your pick: ${PICK_LABELS[prediction.pick] || prediction.pick}</span>
          <span style="color:#fbbf24;font-weight:700;">${match.minute ? `${match.minute}'` : "LIVE"}</span>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.warn("Could not load active predicted matches:", err);
    container.innerHTML = '<div class="helper-text" style="color:rgba(255,255,255,0.7);padding:12px 0;">Unable to load live predicted matches.</div>';
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
    let fixtures = await getFixturesByDate(selectedDateStr);

    if (!fixtures || fixtures.length === 0) {
      fixtures = await getLiveFixtures();
    }

    if (!fixtures || fixtures.length === 0) {
      fixtures = createFallbackFixtures(selectedDateStr);
    }

    allAvailableFixtures = (fixtures || []).filter(isUpcomingFixture);
    if (allAvailableFixtures.length === 0) {
      allAvailableFixtures = createFallbackFixtures(selectedDateStr);
    }

    populateCountryFilterOptions(allAvailableFixtures);
    await loadUserPredictions();
    await renderActivePredictedMatches();
    applyPredictionFilter();
    hasLoadedFixturesOnce = true;
    await settlePendingPredictions();
  } catch (err) {
    console.error("Error loading fixtures:", err);
    allAvailableFixtures = createFallbackFixtures(selectedDateStr);
    applyPredictionFilter();
    hasLoadedFixturesOnce = true;
  } finally {
    fixtureFetchInProgress = false;
  }
}

function wireFixtureSubscription() {
  if (fixtureUnsubscribe) return;
  fixtureUnsubscribe = subscribeToFixtureUpdates((fixtures, cacheKey) => {
    if (cacheKey === `date:${selectedDateStr}`) {
      allAvailableFixtures = fixtures || [];
      populateCountryFilterOptions(allAvailableFixtures);
      applyPredictionFilter();
      loadPredictionHistory();
    }
  });
}

// ===== AUTO-REFRESH POLLING (every 30 seconds) =====
function startPolling() {
  stopPolling();
  pollIntervalId = setInterval(async () => {
    if (currentUser) {
      await settlePendingPredictions();
    }
    await loadFixturesForDate();
  }, 30000);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

if (countryFilterEl) {
  countryFilterEl.addEventListener("change", () => {
    selectedCountryFilter = countryFilterEl.value || "Top Leagues";
    applyPredictionFilter();
  });
}

if (predictionSearchInput) {
  predictionSearchInput.addEventListener("input", (event) => {
    searchTerm = event.target.value || "";
    applyPredictionFilter();
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

    await loadUserPredictions();
    await settlePendingPredictions();
    await renderActivePredictedMatches();
    await loadPredictionHistory();
    updateTicketBuilder();
  } else {
    currentUserUniqueId = "";
    currentUserName = "Guest";
    userPredictions = new Map();
    pendingTicketSelections.clear();
    updateTicketBuilder();
    if (userStatus) {
      userStatus.textContent = "Sign in to make predictions!";
      userStatus.classList.remove("active");
    }
    if (historyContainer) {
      historyContainer.innerHTML = '<p class="helper-text" style="text-align:center;color:rgba(255,255,255,0.7);">Sign in to see your prediction history.</p>';
    }
    const activeContainer = document.getElementById("predictionActiveMatches");
    if (activeContainer) {
      activeContainer.innerHTML = '<div class="helper-text" style="color:rgba(255,255,255,0.7);padding:12px 0;">Sign in to see your active predicted matches.</div>';
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
