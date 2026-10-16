const NEWS_URL = "https://newsapi.org/v2/top-headlines";
const MOCK_ARTICLES = [
  {
    title: "Premier League title race: the fixtures that could shape the run-in",
    description: "A GFHF sample headline on the key matchups, form, and storylines keeping supporters watching this season.",
    source: "GFHF Football Desk",
    category: "Premier League",
    url: "/pages/news.html"
  },
  {
    title: "Champions League nights return with heavyweight European clashes",
    description: "A sample continental roundup celebrating the drama, rivalries, and big moments of European football.",
    source: "GFHF Football Desk",
    category: "Champions League",
    url: "/pages/news.html"
  },
  {
    title: "Transfer watch: clubs weigh up their next moves",
    description: "A sample transfer update exploring squad needs, emerging talent, and the rumours that fuel the window.",
    source: "GFHF Football Desk",
    category: "Transfer Updates",
    url: "/pages/news.html"
  }
];

function fallbackResponse(res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json({ articles: MOCK_ARTICLES, source: "fallback", fallback: true });
}

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
  if (!apiKey) return fallbackResponse(res);

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
      return fallbackResponse(res);
    }
    const payload = await response.json();
    if (payload?.status !== "ok" || !Array.isArray(payload.articles)) {
      console.error("News provider returned an invalid response.");
      return fallbackResponse(res);
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
        category: "Sports",
        publishedAt: typeof article.publishedAt === "string" ? article.publishedAt : "",
        url: article.url
      }));
    if (articles.length === 0) return fallbackResponse(res);
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ articles, source: "live" });
  } catch (error) {
    console.error("News feed request failed:", error.name === "TimeoutError" ? "request timed out" : error.message);
    return fallbackResponse(res);
  }
};
