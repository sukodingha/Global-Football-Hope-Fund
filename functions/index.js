const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { initializeUserProfile, convertHopePointsToWallet, isAdminUser } = require("./auth.js");

admin.initializeApp();
const db = admin.firestore();
const API_FOOTBALL_KEY = defineSecret("API_FOOTBALL_KEY");
const MAX_TICKETS_PER_DAY = 2;
const PICKS_PER_TICKET = 7;
const TICKET_REWARD_HP = 50;

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function fixtureOutcome(fixture) {
  const home = Number(fixture.goals?.home ?? 0);
  const away = Number(fixture.goals?.away ?? 0);
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function normalizeStatus(shortStatus) {
  if (["FT", "AET", "PEN"].includes(String(shortStatus || "").toUpperCase())) return "finished";
  return "scheduled";
}

function normalizeFixtureItem(item) {
  const fixture = item?.fixture || {};
  const league = item?.league || {};
  const teams = item?.teams || {};
  const goals = item?.goals || {};
  const status = fixture?.status || {};

  const shortStatus = String(status?.short || "NS").toUpperCase();
  let normalizedStatus = "scheduled";
  if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(shortStatus)) normalizedStatus = "live";
  else if (shortStatus === "HT") normalizedStatus = "half_time";
  else if (["FT", "AET", "PEN"].includes(shortStatus)) normalizedStatus = "finished";
  else if (["TBD", "NS"].includes(shortStatus)) normalizedStatus = "scheduled";
  else if (["PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"].includes(shortStatus)) normalizedStatus = "postponed";

  return {
    fixture_id: String(fixture?.id ?? item?.fixture_id ?? ""),
    league_id: league?.id ?? null,
    league_name: league?.name || "League",
    country_name: league?.country || "Global",
    league_logo: league?.logo || "",
    home_team_id: teams?.home?.id ?? null,
    home_team_name: teams?.home?.name || "Home",
    home_team_logo: teams?.home?.logo || "",
    away_team_id: teams?.away?.id ?? null,
    away_team_name: teams?.away?.name || "Away",
    away_team_logo: teams?.away?.logo || "",
    kickoff_time: fixture?.date || null,
    status: normalizedStatus,
    status_text: status?.long || "Not Started",
    minute: status?.elapsed ?? "",
    home_score: Number(goals?.home ?? 0) || 0,
    away_score: Number(goals?.away ?? 0) || 0,
    raw: item
  };
}

async function fetchFixtures(ids) {
  const response = await fetch(`https://v3.football.api-sports.io/fixtures?ids=${ids.join("-")}`, {
    headers: { "x-apisports-key": API_FOOTBALL_KEY.value() }
  });
  if (!response.ok) throw new HttpsError("unavailable", "Fixture service is unavailable.");
  const payload = await response.json();
  return Array.isArray(payload.response) ? payload.response : [];
}

async function buildFixturesPayload(payload = {}) {
  const live = payload.live === true;
  const date = typeof payload.date === "string" ? payload.date.trim() : "";
  const rawIds = Array.isArray(payload.ids) ? payload.ids : typeof payload.ids === "string" ? [payload.ids] : [];
  const ids = [...new Set(rawIds.map(String).filter(Boolean))].slice(0, 20);
  const limit = Math.max(1, Math.min(Number(payload.limit) || 40, 120));

  if (!live && !date && ids.length === 0) {
    throw new HttpsError("invalid-argument", "Please provide a date, live=true, or a list of fixture IDs.");
  }

  const query = new URLSearchParams();
  if (live) query.set("live", "all");
  if (date) query.set("date", date);
  if (ids.length) query.set("ids", ids.join("-"));

  const response = await fetch(`https://v3.football.api-sports.io/fixtures?${query.toString()}`, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY.value(),
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new HttpsError("unavailable", `Fixture service returned ${response.status}.`);
  }

  const json = await response.json();
  const responseItems = Array.isArray(json?.response) ? json.response : [];
  const fixtures = responseItems.slice(0, limit).map(normalizeFixtureItem).filter((fixture) => fixture.fixture_id);

  return {
    fixtures,
    count: fixtures.length,
    live,
    date,
    ids,
  };
}

exports.getFixtures = onCall({ secrets: [API_FOOTBALL_KEY] }, async (request) => {
  return buildFixturesPayload(request.data || {});
});

exports.getFixturesHttp = onRequest({ cors: true, secrets: [API_FOOTBALL_KEY] }, async (req, res) => {
  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const result = await buildFixturesPayload(payload);
    res.status(200).json(result);
  } catch (err) {
    console.error("getFixturesHttp error:", err);
    res.status(err.code === "invalid-argument" ? 400 : 500).json({
      error: err.message || "Fixture lookup failed"
    });
  }
});

exports.submitPredictionTicket = onCall({ secrets: [API_FOOTBALL_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to submit a ticket.");
  const picks = Array.isArray(request.data?.picks) ? request.data.picks : [];
  if (picks.length !== PICKS_PER_TICKET) {
    throw new HttpsError("invalid-argument", "A ticket must contain exactly 7 predictions.");
  }

  const fixtureIds = picks.map((pick) => String(pick.fixtureId || "")).filter(Boolean);
  const validPicks = new Set(["home", "draw", "away"]);
  if (new Set(fixtureIds).size !== PICKS_PER_TICKET || picks.some((pick) => !validPicks.has(pick.pick))) {
    throw new HttpsError("invalid-argument", "Ticket selections are invalid.");
  }

  const fixtures = await fetchFixtures(fixtureIds);
  if (fixtures.length !== PICKS_PER_TICKET || fixtures.some((fixture) => normalizeStatus(fixture.fixture?.status?.short) !== "scheduled")) {
    throw new HttpsError("failed-precondition", "One or more selected matches are no longer available.");
  }

  const fixtureById = new Map(fixtures.map((fixture) => [String(fixture.fixture.id), fixture]));
  const uid = request.auth.uid;
  const dateSubmitted = utcDateString();
  const summaryRef = db.collection("predictionDailyLimits").doc(`${uid}_${dateSubmitted}`);
  const userRef = db.collection("users").doc(uid);
  const batchId = `${uid}_${dateSubmitted}`;

  const ticketNumber = await db.runTransaction(async (transaction) => {
    const summarySnap = await transaction.get(summaryRef);
    const batchCount = Number(summarySnap.data()?.batchCount || 0);
    if (batchCount >= MAX_TICKETS_PER_DAY) {
      throw new HttpsError("resource-exhausted", "You have already submitted two tickets today.");
    }

    const nextTicket = batchCount + 1;
    const ticketId = `${batchId}_ticket_${nextTicket}`;
    for (const selection of picks) {
      const fixture = fixtureById.get(String(selection.fixtureId));
      const predictionRef = db.collection("predictions").doc(`${selection.fixtureId}_${uid}`);
      const existing = await transaction.get(predictionRef);
      if (existing.exists) throw new HttpsError("already-exists", "A selected fixture already has a prediction.");
      transaction.set(predictionRef, {
        userId: uid,
        userName: request.auth.token.name || request.auth.token.email || "Member",
        fixtureId: String(selection.fixtureId),
        pick: selection.pick,
        league: fixture.league?.name || "",
        homeTeam: fixture.teams?.home?.name || "",
        awayTeam: fixture.teams?.away?.name || "",
        kickoff: fixture.fixture?.date || null,
        status: "pending",
        ticketStatus: "pending",
        ticketId,
        batchId: ticketId,
        batchNumber: nextTicket,
        dateSubmitted,
        pointsAwarded: 0,
        schemaVersion: 3,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    transaction.set(summaryRef, {
      uid,
      date: dateSubmitted,
      batchCount: nextTicket,
      totalPredictions: nextTicket * PICKS_PER_TICKET,
      currentBatchCount: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(userRef, { updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return nextTicket;
  });

  return { ticketNumber };
});

exports.settlePredictionTickets = onSchedule({ schedule: "every 5 minutes", secrets: [API_FOOTBALL_KEY] }, async () => {
  const pending = await db.collection("predictions").where("ticketStatus", "==", "pending").get();
  const tickets = new Map();
  pending.docs.forEach((snap) => {
    const prediction = { id: snap.id, ...snap.data() };
    const ticketId = prediction.ticketId || prediction.batchId;
    if (!ticketId) return;
    const list = tickets.get(ticketId) || [];
    list.push(prediction);
    tickets.set(ticketId, list);
  });

  for (const [ticketId, predictions] of tickets) {
    if (predictions.length !== PICKS_PER_TICKET) continue;
    const fixtures = await fetchFixtures(predictions.map((prediction) => prediction.fixtureId));
    if (fixtures.length !== PICKS_PER_TICKET || fixtures.some((fixture) => normalizeStatus(fixture.fixture?.status?.short) !== "finished")) continue;
    const fixtureById = new Map(fixtures.map((fixture) => [String(fixture.fixture.id), fixture]));

    await db.runTransaction(async (transaction) => {
      const refs = predictions.map((prediction) => db.collection("predictions").doc(prediction.id));
      const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const current = snaps.map((snap) => ({ ref: snap.ref, ...snap.data() }));
      if (current.length !== PICKS_PER_TICKET || current.some((prediction) => prediction.ticketStatus !== "pending")) return;

      const correctCount = current.filter((prediction) => fixtureOutcome(fixtureById.get(String(prediction.fixtureId))) === prediction.pick).length;
      const won = correctCount === PICKS_PER_TICKET;
      const now = admin.firestore.Timestamp.now();
      const lostExpiresAt = won ? null : admin.firestore.Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);
      const reward = won ? TICKET_REWARD_HP : 0;

      current.forEach((prediction) => {
        const fixture = fixtureById.get(String(prediction.fixtureId));
        transaction.update(prediction.ref, {
          status: fixtureOutcome(fixture) === prediction.pick ? "correct" : "incorrect",
          ticketStatus: won ? "won" : "lost",
          ticketCorrectCount: correctCount,
          ticketMatchCount: PICKS_PER_TICKET,
          ticketReward: reward,
          pointsAwarded: won ? reward / PICKS_PER_TICKET : 0,
          finalScore: `${Number(fixture.goals?.home ?? 0)}-${Number(fixture.goals?.away ?? 0)}`,
          settledAt: now,
          lostExpiresAt
        });
      });
      const userUpdates = {
        updatedAt: now
      };
      if (won) {
        userUpdates.rewardPoints = admin.firestore.FieldValue.increment(TICKET_REWARD_HP);
        userUpdates.totalRewardsEarned = admin.firestore.FieldValue.increment(TICKET_REWARD_HP);
      }
      transaction.set(db.collection("users").doc(current[0].userId), userUpdates, { merge: true });
    });
  }
});

exports.cleanupExpiredLostTickets = onSchedule("every 60 minutes", async () => {
  const expired = await db.collection("predictions")
    .where("lostExpiresAt", "<=", admin.firestore.Timestamp.now())
    .limit(400)
    .get();
  if (expired.empty) return;
  const batch = db.batch();
  expired.docs.forEach((snap) => {
    if (snap.data().ticketStatus === "lost") batch.delete(snap.ref);
  });
  await batch.commit();
});

exports.cleanupLegacyPredictions = onSchedule("every 60 minutes", async () => {
  let cursor = null;
  do {
    let request = db.collection("predictions")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(400);
    if (cursor) request = request.startAfter(cursor);
    const candidates = await request.get();
    if (candidates.empty) return;
    cursor = candidates.docs[candidates.docs.length - 1];
    const legacy = candidates.docs.filter((snap) => Number(snap.data().schemaVersion || 0) < 3);
    if (legacy.length > 0) {
      const batch = db.batch();
      legacy.forEach((snap) => batch.delete(snap.ref));
      await batch.commit();
    }
    if (candidates.size < 400) return;
  } while (cursor);
});

/**
 * Callable: Initialize user profile on first sign-in.
 * Ensures user document exists with default values.
 */
exports.initializeProfile = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to initialize profile.");
  
  try {
    const result = await initializeUserProfile(
      request.auth.uid,
      request.auth.token.email,
      request.auth.token.name || request.data?.displayName
    );
    return { success: true, ...result };
  } catch (err) {
    console.error("Profile initialization error:", err);
    throw new HttpsError("internal", "Failed to initialize profile.");
  }
});

/**
 * Callable: Convert Hope Points to wallet currency.
 * 1 HP = 0.01 USD equivalent.
 * User must be authenticated and provide the amount to convert.
 */
exports.convertHopePointsToWallet = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to convert Hope Points.");
  
  const { hpAmount, currency = "USD" } = request.data || {};
  
  if (!Number.isInteger(hpAmount) || hpAmount <= 0) {
    throw new HttpsError("invalid-argument", "HP amount must be a positive integer.");
  }
  
  try {
    const result = await convertHopePointsToWallet(request.auth.uid, hpAmount, currency);
    return result;
  } catch (err) {
    console.error("HP conversion error:", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Conversion failed. Please try again.");
  }
});

/**
 * Callable: Get user transaction history.
 * Users can only view their own transactions.
 */
exports.getUserTransactions = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to view transactions.");
  
  try {
    const transactions = await db.collection("transactions")
      .where("userId", "==", request.auth.uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    
    return {
      transactions: transactions.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis?.() || null,
      })),
    };
  } catch (err) {
    console.error("Transaction retrieval error:", err);
    throw new HttpsError("internal", "Failed to retrieve transactions.");
  }
});
