const RAPIDAPI_KEY = "a7ba1c6350msha38f55a1caaad1dp19506fjsn7159adf87d0e";
const RAPIDAPI_HOST = "sportapi7.p.rapidapi.com";
const LIVE_ENDPOINT = "https://sportapi7.p.rapidapi.com/api/v1/sport/football/events/live";

const FIXTURE_CACHE_TTL_MS = 60 * 1000;
let fixtureCache = null;
let fixturePromise = null;
let subscribers = new Set();

function normalizeFixture(event, index = 0) {
  const homeTeam = event?.homeTeam || event?.home_team || event?.home || {};
  const awayTeam = event?.awayTeam || event?.away_team || event?.away || {};
  const tournament = event?.tournament || event?.league || event?.competition || {};
  const homeScore = event?.homeScore?.current ?? event?.homeScore ?? event?.home_score ?? 0;
  const awayScore = event?.awayScore?.current ?? event?.awayScore ?? event?.away_score ?? 0;
  const statusRaw = event?.status || event?.statusText || event?.state || "scheduled";
  const status = normalizeStatus(statusRaw);
  const kickoffTime = event?.startTime || event?.start_time || event?.date || event?.kickoff || null;
  const minute = event?.matchTime ?? event?.minute ?? event?.elapsed ?? "";

  return {
    fixture_id: event?.fixture_id || event?.id || event?.fixture?.id || `fixture_${index + 1}`,
    league_id: tournament?.id || event?.league_id || null,
    league_name: tournament?.name || event?.league || event?.competitionName || "League",
    league_logo: tournament?.image || tournament?.logo || event?.league_logo || event?.leagueLogo || "",
    home_team_id: homeTeam?.id || homeTeam?.teamId || event?.home_team_id || null,
    home_team_name: homeTeam?.name || homeTeam?.teamName || homeTeam?.shortName || "Home",
    home_team_logo: homeTeam?.logo || homeTeam?.image || homeTeam?.teamLogo || homeTeam?.team?.logo || "",
    away_team_id: awayTeam?.id || awayTeam?.teamId || event?.away_team_id || null,
    away_team_name: awayTeam?.name || awayTeam?.teamName || awayTeam?.shortName || "Away",
    away_team_logo: awayTeam?.logo || awayTeam?.image || awayTeam?.teamLogo || awayTeam?.team?.logo || "",
    kickoff_time: kickoffTime,
    status,
    status_text: statusRaw,
    minute,
    home_score: Number(homeScore) || 0,
    away_score: Number(awayScore) || 0,
    raw: event
  };
}

function normalizeStatus(status) {
  const key = String(status || "scheduled").trim().toLowerCase();
  if (["live", "inplay", "in play", "running", "active"].includes(key)) return "live";
  if (["half time", "ht", "half-time"].includes(key)) return "half_time";
  if (["finished", "ft", "ended", "fulltime"].includes(key)) return "finished";
  if (["not started", "scheduled", "not_started", "pending", "about to start"].includes(key)) return "scheduled";
  if (["postponed", "canceled", "cancelled"].includes(key)) return "postponed";
  return key || "scheduled";
}

function notifySubscribers(fixtures) {
  subscribers.forEach((listener) => listener(fixtures));
}

function getCacheEntry() {
  if (!fixtureCache) return null;
  if (Date.now() - fixtureCache.timestamp > FIXTURE_CACHE_TTL_MS) {
    fixtureCache = null;
    return null;
  }
  return fixtureCache;
}

export async function getLiveFixtures({ forceRefresh = false } = {}) {
  const cached = getCacheEntry();
  if (!forceRefresh && cached) {
    return cached.fixtures;
  }

  if (!forceRefresh && fixturePromise) {
    return fixturePromise;
  }

  fixturePromise = fetchLiveFixtures();
  try {
    const fixtures = await fixturePromise;
    fixtureCache = { fixtures, timestamp: Date.now() };
    notifySubscribers(fixtures);
    return fixtures;
  } finally {
    fixturePromise = null;
  }
}

export function subscribeToFixtureUpdates(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function getCachedLiveFixtures() {
  return getCacheEntry()?.fixtures || [];
}

async function fetchLiveFixtures() {
  try {
    const response = await fetch(LIVE_ENDPOINT, {
      method: "GET",
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST
      }
    });

    if (!response.ok) {
      throw new Error(`RapidAPI returned ${response.status}`);
    }

    const data = await response.json();
    const events = data?.data?.events || data?.events || data?.response || [];
    if (!Array.isArray(events)) return [];

    return events.map((event, index) => normalizeFixture(event, index));
  } catch (error) {
    console.warn("Unable to load live fixtures from shared service", error);
    return [];
  }
}
