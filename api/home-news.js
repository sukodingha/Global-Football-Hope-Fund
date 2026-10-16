const NEWS_URL = "https://newsapi.org/v2/top-headlines";
const MOCK_ARTICLES = [
  {
    title: "Matchday spotlight: Europe's biggest clubs prepare for a decisive weekend",
    description: "A sample headline for the homepage news feed. Connect NEWS_API_KEY to display current articles.",
    source: "GFHF Sample News",
    publishedAt: "2026-10-16T08:00:00Z",
    url: "https://www.global-football-hope-fund.org/pages/news.html"
  },
  {
    title: "The beautiful game brings communities together around the world",
    description: "A sample football story highlighting the passion shared by supporters everywhere.",
    source: "GFHF Sample News",
    publishedAt: "2026-10-15T12:00:00Z",
    url: "https://www.global-football-hope-fund.org/pages/news.html"
  },
  {
    title: "Young talent takes centre stage as the new season gathers pace",
    description: "A sample headline. Live football reporting will appear here when a news provider key is configured.",
    source: "GFHF Sample News",
    publishedAt: "2026-10-14T10:00:00Z",
    url: "https://www.global-football-hope-fund.org/pages/news.html"
  }
];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = process.env.CORS_ALLOWED_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin && origin === allowedOrigin ? allowedOrigin : "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

module.exports = async function homeNews(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ articles: MOCK_ARTICLES, source: "sample" });
  }

  try {
    const url = new URL(NEWS_URL);
    url.searchParams.set("category", "sports");
    // NewsAPI's top-headlines endpoint expects a country or source; country=gb
    // provides English-language sports headlines (language isn't supported here).
    url.searchParams.set("country", "gb");
    url.searchParams.set("pageSize", "6");
    url.searchParams.set("apiKey", apiKey);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.error("News provider request failed:", response.status);
      return res.status(502).json({ error: "Unable to load football news right now." });
    }
    const payload = await response.json();
    if (payload?.status !== "ok" || !Array.isArray(payload.articles)) {
      return res.status(502).json({ error: "The news provider returned an invalid response." });
    }
    const articles = payload.articles
      .filter((article) => {
        if (!article || typeof article.title !== "string" || !article.title.trim() || article.title === "[Removed]") return false;
        try {
          const articleUrl = new URL(article.url);
          return articleUrl.protocol === "https:" || articleUrl.protocol === "http:";
        } catch {
          return false;
        }
      })
      .slice(0, 6)
      .map((article) => ({
        title: article.title.trim(),
        description: typeof article.description === "string" && article.description !== "[Removed]" ? article.description.trim() : "",
        source: article.source?.name || "Football News",
        publishedAt: typeof article.publishedAt === "string" ? article.publishedAt : "",
        url: article.url
      }));
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ articles, source: "live" });
  } catch (error) {
    console.error("News feed request failed:", error.name === "TimeoutError" ? "request timed out" : error.message);
    return res.status(502).json({ error: "Unable to load football news right now." });
  }
};
