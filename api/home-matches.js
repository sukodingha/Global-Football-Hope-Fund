const FOOTBALL_DATA_URL = "https://api.football-data.org/v4/matches";

module.exports = async function homeMatches(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "The match feed is not configured." });
  }

  try {
    const url = new URL(FOOTBALL_DATA_URL);
    url.searchParams.set("status", "IN_PLAY,PAUSED,SCHEDULED,TIMED");
    const response = await fetch(url, {
      headers: { "X-Auth-Token": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.error("football-data.org request failed:", response.status);
      return res.status(502).json({ error: "Unable to load matches right now." });
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.matches)) {
      return res.status(502).json({ error: "The match provider returned an invalid response." });
    }

    const matches = payload.matches.slice(0, 12).map((match) => ({
      id: match.id,
      competition: match.competition?.name || "Football",
      homeTeam: match.homeTeam?.name || "Home team",
      awayTeam: match.awayTeam?.name || "Away team",
      homeScore: match.score?.fullTime?.home ?? match.score?.halfTime?.home,
      awayScore: match.score?.fullTime?.away ?? match.score?.halfTime?.away,
      status: match.status || "SCHEDULED",
      utcDate: match.utcDate
    }));

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ matches });
  } catch (error) {
    console.error("Match feed request failed:", error.name === "TimeoutError" ? "request timed out" : error.message);
    return res.status(502).json({ error: "Unable to load matches right now." });
  }
};
