/**
 * GFHF Multi-Sport News Feed
 * Primary: GNews API → Fallback: RSS-to-JSON (ESPN feeds via rss2json.com)
 * Fully CORS-safe — works in browser without a proxy.
 */

const GNEWS_KEY = "23a2a74d60317b06c1d4862ca61d4743";
const RSS2JSON_URL = "https://api.rss2json.com/v1/api.json";

const CATEGORIES = [
  { label: "All Sports", query: "sports", rss: "https://www.espn.com/espn/rss/news" },
  { label: "Football", query: "soccer", rss: "https://www.espn.com/espn/rss/soccer" },
  { label: "Basketball", query: "basketball", rss: "https://www.espn.com/espn/rss/nba" },
  { label: "Formula 1", query: "formula 1", rss: "https://www.espn.com/espn/rss/f1" },
  { label: "Tennis", query: "tennis", rss: "https://www.espn.com/espn/rss/tennis" },
  { label: "Combat Sports", query: "boxing", rss: "https://www.espn.com/espn/rss/boxing" }
];

let activeCategory = 0;
let currentNews = [];

const newsGrid = document.getElementById("newsGrid");
const newsStatus = document.getElementById("newsStatus");
const categoryTabs = document.getElementById("categoryTabs");

// ── Helpers ────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return dateStr;
  }
}

function truncate(text, maxLen = 180) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function getImageUrl(article) {
  return article.urlToImage || article.image || article.thumbnail || "";
}

function getSourceName(article) {
  return article.source?.name || article.source || "Sports News";
}

function getPublishedAt(article) {
  return article.publishedAt || article.pubDate || "";
}

// ── Render ─────────────────────────────────────────────────

function renderNews(articles) {
  if (!newsGrid) return;

  if (!articles || articles.length === 0) {
    newsGrid.innerHTML = `
      <div class="card news-card" style="grid-column: 1 / -1; text-align: center;">
        <p style="padding: 40px 0; color: #64748b;">
          <strong>No articles found.</strong><br>
          Try a different category or check back later.
        </p>
      </div>
    `;
    return;
  }

  newsGrid.innerHTML = articles.map((article) => {
    const title = article.title || "Untitled";
    const description = truncate(article.description || article.content || "");
    const source = getSourceName(article);
    const date = formatDate(getPublishedAt(article));
    const imageUrl = getImageUrl(article);
    const articleUrl = article.url || article.link || "";

    return `
      <div class="card news-card">
        ${imageUrl ? `<div class="news-card-image"><img src="${imageUrl}" alt="${title}" loading="lazy" onerror="this.parentElement.style.display='none'"></div>` : ""}
        <div class="news-card-content">
          <h3 class="news-title">${title}</h3>
          <div class="news-meta">
            <span class="news-source">📰 ${source}</span>
            <span class="news-date">🕐 ${date}</span>
          </div>
          ${description ? `<p class="news-description">${description}</p>` : ""}
          ${articleUrl ? `<a href="${articleUrl}" class="btn news-read-link" target="_blank" rel="noopener noreferrer">Read Article →</a>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function setStatus(message, isError = false) {
  if (!newsStatus) return;
  newsStatus.textContent = message;
  newsStatus.style.color = isError ? "#b42318" : "#4b5563";
}

function renderCategoryTabs() {
  if (!categoryTabs) return;
  categoryTabs.innerHTML = "";
  CATEGORIES.forEach((cat, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tag-button${index === activeCategory ? " active" : ""}`;
    btn.textContent = cat.label;
    btn.addEventListener("click", () => {
      activeCategory = index;
      renderCategoryTabs();
      fetchNews();
    });
    categoryTabs.appendChild(btn);
  });
}

// ── Data sources ──────────────────────────────────────────

/**
 * Primary: GNews API – top-headlines for "sports", or search for other queries.
 * CORS-safe via browser `fetch`. Free tier: 100 req/day.
 */
async function fetchFromGNews(query) {
  const isGeneral = query === "sports";
  let url;
  if (isGeneral) {
    url = `https://gnews.io/api/v4/top-headlines?category=sports&lang=en&max=20&apikey=${GNEWS_KEY}`;
  } else {
    url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=20&apikey=${GNEWS_KEY}`;
  }

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GNews ${response.status}: ${errorText}`);
  }
  const data = await response.json();

  return (data.articles || []).map((a) => ({
    title: a.title,
    description: a.description,
    url: a.url,
    urlToImage: a.image,
    source: { name: a.source?.name || a.source?.title || "GNews" },
    publishedAt: a.publishedAt,
    content: a.content
  }));
}

/**
 * Fallback: RSS-to-JSON via rss2json.com (no API key required, no CORS).
 * Fetches category-specific ESPN RSS feed and normalises to the same format.
 */
async function fetchFromRSS(rssUrl) {
  const url = `${RSS2JSON_URL}?rss_url=${encodeURIComponent(rssUrl)}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RSS2JSON ${response.status}: ${errorText}`);
  }
  const data = await response.json();

  if (data.status !== "ok") {
    throw new Error(`RSS2JSON error: ${data.message || "unknown"}`);
  }

  return (data.items || []).map((item) => ({
    title: item.title,
    description: item.description,
    url: item.link,
    urlToImage: item.enclosure?.link || item.thumbnail || "",
    source: { name: (item.author || "").replace(/^https?:\/\/[^/]+/, "") || "ESPN" },
    publishedAt: item.pubDate,
    content: item.content
  }));
}

// ── Orchestrator ──────────────────────────────────────────

async function fetchNews() {
  if (!newsGrid) return;

  const category = CATEGORIES[activeCategory];
  const query = category.query;
  const rssUrl = category.rss;

  setStatus("Loading news...");
  newsGrid.innerHTML = '<div class="card" style="grid-column: 1 / -1; text-align: center;"><p style="padding: 40px 0;">⏳ Fetching latest sports news...</p></div>';

  let articles = [];
  let sourceLabel = "";

  // 1. Try GNews API
  try {
    articles = await fetchFromGNews(query);
    sourceLabel = `GNews`;
  } catch (gnewsError) {
    console.warn("GNews API failed — trying RSS fallback:", gnewsError.message);
  }

  // 2. If GNews returned nothing (empty or error), fall back to RSS
  if (articles.length === 0) {
    try {
      articles = await fetchFromRSS(rssUrl);
      sourceLabel = `ESPN (RSS)`;
    } catch (rssError) {
      console.error("RSS fallback also failed:", rssError.message);
    }
  }

  // 3. If both failed, show a gentle message
  if (articles.length === 0) {
    setStatus("Could not fetch news right now. Please try again later.", true);
    newsGrid.innerHTML = `
      <div class="card" style="grid-column: 1 / -1; text-align: center;">
        <p style="padding: 40px 0; color: #64748b;">
          <strong>No articles available right now.</strong><br>
          Please check back later or try a different category.
        </p>
      </div>
    `;
    return;
  }

  currentNews = articles;
  renderNews(articles);

  if (sourceLabel) {
    setStatus(`Showing ${articles.length} articles from ${sourceLabel}`);
  } else {
    setStatus(`Showing ${articles.length} articles`);
  }
}

// ── Init ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  renderCategoryTabs();
  fetchNews();
});

