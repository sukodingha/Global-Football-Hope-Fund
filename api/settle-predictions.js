const { timingSafeEqual } = require("node:crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore: getFirestoreClient, Timestamp } = require("firebase-admin/firestore");

const API_URL = "https://v3.football.api-sports.io/fixtures";
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const PICKS_PER_TICKET = 7;
const TICKET_REWARD_HP = 50;
const FIXTURE_ID_BATCH_SIZE = 20;
const LOST_TICKET_RETENTION_MS = 24 * 60 * 60 * 1000;

function getFirestore() {
  if (!getApps().length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid service-account JSON.");
    }

    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing required credential fields.");
    }

    initializeApp({ credential: cert(serviceAccount) });
  }

  return getFirestoreClient();
}

function isAuthorized(req) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return null;

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const expected = Buffer.from(configuredSecret);
  const provided = Buffer.from(match[1]);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function getTicketOutcome(fixture) {
  const homeScore = Number(fixture.goals?.home ?? 0);
  const awayScore = Number(fixture.goals?.away ?? 0);
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "draw";
}

async function fetchFixtureResults(fixtureIds, apiKey) {
  const results = new Map();

  for (let start = 0; start < fixtureIds.length; start += FIXTURE_ID_BATCH_SIZE) {
    const ids = fixtureIds.slice(start, start + FIXTURE_ID_BATCH_SIZE);
    const url = new URL(API_URL);
    url.searchParams.set("ids", ids.join("-"));
    const response = await fetch(url, {
      headers: { "x-apisports-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) throw new Error(`Football API request failed with status ${response.status}.`);

    const payload = await response.json();
    if (payload.errors && Object.keys(payload.errors).length > 0) {
      throw new Error("Football API returned fixture lookup errors.");
    }

    for (const item of Array.isArray(payload.response) ? payload.response : []) {
      const fixtureId = item.fixture?.id;
      const status = String(item.fixture?.status?.short || "").toUpperCase();
      if (fixtureId != null && FINISHED_STATUSES.has(status)) {
        results.set(String(fixtureId), item);
      }
    }
  }

  return results;
}

async function settleTicket(db, ticketId, predictions, fixtureResults) {
  const refs = predictions.map((prediction) => prediction.ref);

  return db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot) => !snapshot.exists)) return null;

    const current = snapshots.map((snapshot, index) => ({
      ref: refs[index],
      ...snapshot.data()
    }));
    if (current.length !== PICKS_PER_TICKET || current.some((prediction) =>
      prediction.ticketStatus !== "pending" ||
         String(prediction.ticketId || prediction.batchId || "") !== ticketId ||
         prediction.userId !== current[0].userId
    )) return null;

    const fixtures = current.map((prediction) => fixtureResults.get(String(prediction.fixtureId)));
    if (fixtures.some((fixture) => !fixture)) return null;

    const correctCount = current.reduce((count, prediction, index) =>
      count + (getTicketOutcome(fixtures[index]) === prediction.pick ? 1 : 0), 0);
    const won = correctCount === PICKS_PER_TICKET;
    const now = Timestamp.now();
    const lostExpiresAt = won
      ? null
      : Timestamp.fromMillis(now.toMillis() + LOST_TICKET_RETENTION_MS);
    const reward = won ? TICKET_REWARD_HP : 0;

    current.forEach((prediction, index) => {
      const fixture = fixtures[index];
      transaction.update(prediction.ref, {
        status: getTicketOutcome(fixture) === prediction.pick ? "correct" : "incorrect",
        ticketStatus: won ? "won" : "lost",
        ticketCorrectCount: correctCount,
        ticketMatchCount: PICKS_PER_TICKET,
        ticketReward: reward,
        pointsAwarded: reward / PICKS_PER_TICKET,
        finalScore: `${Number(fixture.goals?.home ?? 0)}-${Number(fixture.goals?.away ?? 0)}`,
        settledAt: now,
        lostExpiresAt
      });
    });

    if (won) {
      transaction.set(db.collection("users").doc(current[0].userId), {
        rewardPoints: FieldValue.increment(TICKET_REWARD_HP),
        totalRewardsEarned: FieldValue.increment(TICKET_REWARD_HP),
        updatedAt: now
      }, { merge: true });
    }

    return won ? "won" : "lost";
  });
}

module.exports = async function settlePredictions(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const authorized = isAuthorized(req);
  if (authorized === null) {
    return res.status(500).json({ error: "CRON_SECRET is not configured." });
  }
  if (!authorized) return res.status(401).json({ error: "Unauthorized." });

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FOOTBALL_API_KEY is not configured." });

  try {
    const db = getFirestore();
    const pendingSnapshot = await db.collection("predictions")
      .where("ticketStatus", "==", "pending")
      .get();
    const tickets = new Map();

    pendingSnapshot.docs.forEach((snapshot) => {
      const data = snapshot.data();
      const ticketId = String(data.ticketId || data.batchId || "");
      if (!ticketId) return;
      const predictions = tickets.get(ticketId) || [];
      predictions.push({ ref: snapshot.ref, ...data });
      tickets.set(ticketId, predictions);
    });

    const eligibleTickets = [...tickets.entries()].filter(([, predictions]) =>
      predictions.length === PICKS_PER_TICKET &&
      new Set(predictions.map((prediction) => String(prediction.fixtureId || ""))).size === PICKS_PER_TICKET &&
      Boolean(predictions[0].userId) &&
         predictions.every((prediction) =>
           prediction.userId === predictions[0].userId &&
           ["home", "draw", "away"].includes(prediction.pick)
         )
    );
    const fixtureIds = [...new Set(eligibleTickets.flatMap(([, predictions]) =>
      predictions.map((prediction) => String(prediction.fixtureId))
    ))];
    const fixtureResults = fixtureIds.length
      ? await fetchFixtureResults(fixtureIds, apiKey)
      : new Map();

    const totals = { pendingDocuments: pendingSnapshot.size, settledTickets: 0, wonTickets: 0, lostTickets: 0 };
    for (const [ticketId, predictions] of eligibleTickets) {
      const result = await settleTicket(db, ticketId, predictions, fixtureResults);
      if (!result) continue;
      totals.settledTickets += 1;
      if (result === "won") totals.wonTickets += 1;
      else totals.lostTickets += 1;
    }

    return res.status(200).json({ ok: true, ...totals });
  } catch (error) {
    console.error("Prediction settlement failed:", error.message);
       const configurationError = error.message.startsWith("FIREBASE_SERVICE_ACCOUNT");
       return res.status(500).json({
         error: configurationError ? error.message : "Prediction settlement failed."
       });
  }
};