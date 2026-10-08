const FIXTURES_URL = "https://v3.football.api-sports.io/fixtures";
const UPCOMING_STATUSES = new Set(["NS", "TBD"]);

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function normalizeFixture(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const status = fixture.status || {};
  const statusCode = String(status.short || "NS").toUpperCase();
  const normalizedStatus = ["1H", "2H", "ET", "BT", "P", "LIVE"].includes(statusCode)
    ? "live"
    : statusCode === "HT"
      ? "half_time"
      : ["FT", "AET", "PEN"].includes(statusCode)
        ? "finished"
        : ["PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"].includes(statusCode)
          ? "postponed"
          : "scheduled";

  return {
    fixture_id: String(fixture.id),
    league_id: league.id ?? null,
    league_name: league.name || "League",
    country_name: league.country || "Global",
    league_logo: league.logo || "",
    home_team_id: teams.home?.id ?? null,
    home_team_name: teams.home?.name || "Home",
    home_team_logo: teams.home?.logo || "",
    away_team_id: teams.away?.id ?? null,
    away_team_name: teams.away?.name || "Away",
    away_team_logo: teams.away?.logo || "",
    kickoff_time: fixture.date || null,
    status: normalizedStatus,
    status_text: status.long || "Not Started",
    minute: status.elapsed ?? "",
    home_score: Number(item.goals?.home ?? 0) || 0,
    away_score: Number(item.goals?.away ?? 0) || 0,
    raw: item
  };
}

function chooseRandomFixtures(fixtures, limit = 10) {
  const shuffled = [...fixtures];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, limit);
}

module.exports = async function predictionFixtures(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const date = typeof req.query.date === "string" ? req.query.date : "";
  const rawIds = typeof req.query.ids === "string" ? req.query.ids.split("-") : [];
  const ids = [...new Set(rawIds.filter((id) => /^\d+$/.test(id)))].slice(0, 20);
  const hasDate = isValidDate(date);
  if (!hasDate && ids.length === 0) {
    return res.status(400).json({ error: "Provide a valid date or fixture IDs." });
  }

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "The fixture service is not configured." });
  }

  try {
    const url = new URL(FIXTURES_URL);
    if (ids.length) url.searchParams.set("ids", ids.join("-"));
    else url.searchParams.set("date", date);
    const response = await fetch(url, {
      headers: {
        "x-apisports-key": apiKey,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.error("Football API request failed with status", response.status);
      return res.status(502).json({ error: "Unable to load fixtures right now." });
    }

    const payload = await response.json();
    if (payload.errors && Object.keys(payload.errors).length > 0) {
      console.error("Football API returned fixture errors.");
      return res.status(502).json({ error: "Unable to load fixtures right now." });
    }

    const responseItems = (Array.isArray(payload.response) ? payload.response : [])
      .filter((item) => item.fixture?.id != null);
    const fixtures = ids.length
      ? responseItems.map(normalizeFixture)
      : chooseRandomFixtures(responseItems
        .filter((item) => UPCOMING_STATUSES.has(String(item.fixture?.status?.short || "").toUpperCase()))
        .map(normalizeFixture));

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ date: hasDate ? date : "", ids, count: fixtures.length, fixtures });
  } catch (error) {
    console.error("Fixture lookup failed:", error.name === "TimeoutError" ? "request timed out" : error.message);
    return res.status(502).json({ error: "Unable to load fixtures right now." });
  }
};