const SPORTS_FEEDS = {
  all: "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/news",
  football: "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/soccer/news",
  basketball: "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/nba/news",
  formula1: "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/f1/news",
  tennis: "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/rpm/news"
};

export async function fetchSportsNews(category = 'all') {
  const container = document.getElementById('news-feed-container') || document.querySelector('.news-grid');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner">Loading sports news...</div>';

  try {
    const feedUrl = SPORTS_FEEDS[category] || SPORTS_FEEDS.all;
    const response = await fetch(feedUrl);
    const data = await response.json();

    if (data.status !== 'ok' || !data.items || data.items.length === 0) {
      throw new Error("Failed to load feed");
    }

    container.innerHTML = data.items.map(item => `
      <div class="news-card">
        ${item.thumbnail || item.enclosure?.link ? `<img src="${item.thumbnail || item.enclosure.link}" alt="${item.title}" class="news-image">` : ''}
        <div class="news-content">
          <span class="news-date">${new Date(item.pubDate).toLocaleDateString()}</span>
          <h3 class="news-title">${item.title}</h3>
          <p class="news-description">${item.description.replace(/<[^>]*>?/gm, '').substring(0, 120)}...</p>
          <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="read-more-btn">Read Article →</a>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error("Error fetching news:", error);
    container.innerHTML = `
      <div class="error-box">
        <p>⚠️ Unable to load latest news right now. Please refresh or try another category.</p>
      </div>
    `;
  }
}

// Auto-run on load
document.addEventListener('DOMContentLoaded', () => {
  fetchSportsNews('all');
});

