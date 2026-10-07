/**
 * GFHF Fixtures Service (Single Source of Truth)
 * -----------------------------------------------
 * Fetches football fixtures from a secure Firebase callable function that keeps
 * the API-Football secret server-side in Firebase Functions.
 *
 * This is the ONLY module that is allowed to talk to the fixtures API. Every
 * page that needs match data (Competition, Predictions, etc.) must import
 * from this file so all pages stay perfectly in sync and never issue
 * duplicate/competing network requests for the same data.
 */

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const functions = getFunctions();
const getFixturesCallable = httpsCallable(functions, "getFixtures");

const LIVE_CACHE_TTL_MS = 30 * 1000;   // live fixtures change fast
const DATE_CACHE_TTL_MS = 5 * 60 * 1000; // fixture lists for a given day change slowly

/** cacheKey -> { fixtures, timestamp } */
const cacheStore = new Map();
/** cacheKey -> in-flight Promise<fixtures[]> (de-dupes concurrent requests) */
const inFlightStore = new Map();

const subscribers = new Set();

function notifySubscribers(fixtures, cacheKey) {
  subscribers.forEach((listener) => {
    try {
      listener(fixtures, cacheKey);
    } catch (err) {
      console.warn("Fixture subscriber error:", err);
    }
  });
}

/** Map API-Football's short status codes to the app's internal status values. */
function normalizeStatus(shortStatus) {
  const key = String(shortStatus || "NS").toUpperCase();
  if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(key)) return "live";
  if (key === "HT") return "half_time";
  if (["FT", "AET", "PEN"].includes(key)) return "finished";
  if (["TBD", "NS"].includes(key)) return "scheduled";
  if (["PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"].includes(key)) return "postponed";
  return "scheduled";
}

/** Normalize a single API-Football fixture item to the shared GFHF fixture shape. */
function normalizeFixture(item) {
  const fixture = item?.fixture || {};
  const league = item?.league || {};
  const teams = item?.teams || {};
  const goals = item?.goals || {};
  const status = fixture?.status || {};

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
    status: normalizeStatus(status?.short),
    status_text: status?.long || "Not Started",
    minute: status?.elapsed ?? "",
    home_score: Number(goals?.home ?? 0) || 0,
    away_score: Number(goals?.away ?? 0) || 0,
    raw: item
  };
}

function getCacheEntry(cacheKey, ttlMs) {
  const entry = cacheStore.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cacheStore.delete(cacheKey);
    return null;
  }
  return entry;
}

async function callApiFootball(path) {
  const live = path.includes("live=all");
  const dateMatch = path.match(/date=([^&]+)/);
  const idsMatch = path.match(/ids=([^&]+)/);
  const ids = idsMatch ? idsMatch[1].split("-").filter(Boolean) : [];
  const date = dateMatch ? decodeURIComponent(dateMatch[1]) : "";

  try {
    const result = await getFixturesCallable({
      live,
      date,
      ids,
      limit: 40
    });

    return Array.isArray(result?.data?.fixtures) ? result.data.fixtures : [];
  } catch (err) {
    console.warn("Unable to load fixtures from secure Firebase function:", err);
    return [];
  }
}

/**
 * Core cached fetch helper. Ensures at most one in-flight request per cache
 * key, and reuses cached results while they are still fresh.
 */
async function getCachedFixtures(cacheKey, path, ttlMs, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = getCacheEntry(cacheKey, ttlMs);
    if (cached) return cached.fixtures;

    const pending = inFlightStore.get(cacheKey);
    if (pending) return pending;
  }

  const promise = callApiFootball(path)
    .catch((err) => {
      console.warn(`Unable to load fixtures for "${cacheKey}" from API-Football`, err);
      return [];
    })
    .then((fixtures) => {
      cacheStore.set(cacheKey, { fixtures, timestamp: Date.now() });
      notifySubscribers(fixtures, cacheKey);
      return fixtures;
    })
    .finally(() => {
      inFlightStore.delete(cacheKey);
    });

  inFlightStore.set(cacheKey, promise);
  return promise;
}

/**
 * Get all currently live fixtures (in-play across every league).
 * @param {{forceRefresh?: boolean}} options
 * @returns {Promise<object[]>}
 */
export function getLiveFixtures({ forceRefresh = false } = {}) {
  return getCachedFixtures("live", "/fixtures?live=all", LIVE_CACHE_TTL_MS, { forceRefresh });
}

/**
 * Get every fixture scheduled/played on a given calendar day.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {{forceRefresh?: boolean}} options
 * @returns {Promise<object[]>}
 */
export function getFixturesByDate(dateStr, { forceRefresh = false } = {}) {
  if (!dateStr) return Promise.resolve([]);
  return getCachedFixtures(`date:${dateStr}`, `/fixtures?date=${encodeURIComponent(dateStr)}`, DATE_CACHE_TTL_MS, { forceRefresh });
}

/**
 * Look up a specific set of fixtures by their fixture_id (useful for settling
 * predictions after a match ends). Accepts up to 20 ids per API-Football limits.
 * @param {(string|number)[]} fixtureIds
 * @returns {Promise<object[]>}
 */
export async function getFixturesByIds(fixtureIds = []) {
  const ids = [...new Set(fixtureIds.map(String).filter(Boolean))].slice(0, 20);
  if (ids.length === 0) return [];

  const cacheKey = `ids:${ids.join(",")}`;
  return getCachedFixtures(cacheKey, `/fixtures?ids=${ids.join("-")}`, LIVE_CACHE_TTL_MS);
}

/**
 * Subscribe to fixture updates whenever any cached fixture list is refreshed.
 * The listener receives `(fixtures, cacheKey)` so callers can ignore updates
 * that don't match the data set they currently have on screen
 * (cacheKey is "live", `date:YYYY-MM-DD`, or `ids:1,2,3`).
 */
export function subscribeToFixtureUpdates(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/** Synchronously read whatever live fixtures are currently cached (may be stale/empty). */
export function getCachedLiveFixtures() {
  return getCacheEntry("live", LIVE_CACHE_TTL_MS)?.fixtures || [];
}

const TOP_LEAGUE_TOKEN_SET = new Set([
  "premier league",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "uefa champions league",
  "champions league",
  "world cup",
  "europa league",
  "coppa italia",
  "fa cup",
  "copa del rey",
  "dfb-pokal",
  "ligue des champions",
  "afcon",
  "africa cup of nations",
  "copa america",
  "gold cup"
]);

export function getRandomTopMatches(fixtures = [], limit = 20) {
  const roster = Array.isArray(fixtures) ? fixtures.filter((fixture) => {
    if (!fixture) return false;
    const leagueName = String(fixture.league_name || "").toLowerCase();
    const countryName = String(fixture.country_name || "").toLowerCase();
    return TOP_LEAGUE_TOKEN_SET.has(leagueName) || TOP_LEAGUE_TOKEN_SET.has(countryName) || /england|spain|italy|germany|france|europe|world/i.test(leagueName + " " + countryName);
  }) : [];

  const pool = roster.length ? roster : Array.isArray(fixtures) ? fixtures : [];
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), pool.length || 1);
  const shuffled = [...pool];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.slice(0, safeLimit);
}

export async function getRandomTopMatchesForDate(dateStr, { limit = 20, forceRefresh = false } = {}) {
  if (!dateStr) return [];
  const fixtures = await getFixturesByDate(dateStr, { forceRefresh });
  return getRandomTopMatches(fixtures, limit);
}
