/**
 * GFHF Multi-Sport News Feed
 * Dual-API fetch with NewsAPI.org (primary) → GNews.io (fallback)
 * Features: category tabs, image thumbnails, formatted dates, read links
 */

const NEWSAPI_KEY = "99c938d3ecad40b7aa0a6f40b7b91ff4";
const GNEWS_KEY = "23a2a74d60317b06c1d4862ca61d4743";

const CATEGORIES = [
  { label: "All Sports", query: "sports" },
  { label: "Football", query: "football soccer" },
  { label: "Basketball", query: "basketball NBA" },
  { label: "Formula 1", query: "Formula 1 F1" },
  { label: "Tennis", query: "tennis ATP WTA" },
  { label: "Combat Sports", query: "boxing UFC MMA" }
];

let activeCategory = 0; // index
let currentNews = [];

const newsGrid = document.getElementById("newsGrid");
const newsStatus = document.getElementById("newsStatus");
const categoryTabs = document.getElementById("categoryTabs");

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
    const source = article.source?.name || article.source || "Unknown Source";
    const date = formatDate(article.publishedAt);
    const imageUrl = article.urlToImage || article.image || "";
    const articleUrl = article.url || "";

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

async function fetchFromNewsAPI(query) {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&pageSize=20&apiKey=${NEWSAPI_KEY}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NewsAPI ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  return data.articles || [];
}

async function fetchFromGNews(query) {
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=20&apikey=${GNEWS_KEY}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GNews ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  // Normalize GNews format to match NewsAPI
  return (data.articles || []).map((a) => ({
    title: a.title,
    description: a.description,
    url: a.url,
    urlToImage: a.image,
    source: { name: a.source?.name || a.source || "GNews" },
    publishedAt: a.publishedAt,
    content: a.content
  }));
}

async function fetchNews() {
  if (!newsGrid) return;

  const query = CATEGORIES[activeCategory].query;
  setStatus("Loading news...");
  newsGrid.innerHTML = '<div class="card" style="grid-column: 1 / -1; text-align: center;"><p style="padding: 40px 0;">⏳ Fetching latest sports news...</p></div>';

  let articles = [];
  let usedFallback = false;

  // Primary: NewsAPI
  try {
    articles = await fetchFromNewsAPI(query);
  } catch (newsApiError) {
    console.warn("NewsAPI failed, falling back to GNews:", newsApiError.message);
    usedFallback = true;
  }

  // Fallback: GNews
  if (articles.length === 0) {
    try {
      articles = await fetchFromGNews(query);
    } catch (gnewsError) {
      console.error("Both APIs failed:", gnewsError.message);
      setStatus("Unable to fetch news. Please try again later.", true);
      newsGrid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1; text-align: center;">
          <p style="padding: 40px 0; color: #b42318;">
            <strong>⚠️ News Unavailable</strong><br>
            Both news sources are currently unreachable. Check your connection or try again.
          </p>
        </div>
      `;
      return;
    }
  }

  currentNews = articles;
  renderNews(articles);
  setStatus(usedFallback ? "Showing GNews results (NewsAPI unavailable)" : `Showing ${articles.length} articles from NewsAPI`);
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  renderCategoryTabs();
  fetchNews();
});

