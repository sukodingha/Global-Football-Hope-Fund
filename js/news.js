const SPORTS_FEEDS = {
  all: [
    "https://api.rss2json.com/v1/api.json?rss_url=http://feeds.bbci.co.uk/sport/rss.xml",
    "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/news"
  ],
  football: [
    "https://api.rss2json.com/v1/api.json?rss_url=http://feeds.bbci.co.uk/sport/football/rss.xml",
    "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/soccer/news"
  ],
  basketball: [
    "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/nba/news",
    "https://api.rss2json.com/v1/api.json?rss_url=http://feeds.bbci.co.uk/sport/basketball/rss.xml"
  ],
  tennis: [
    "https://api.rss2json.com/v1/api.json?rss_url=http://feeds.bbci.co.uk/sport/tennis/rss.xml",
    "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/tennis/news"
  ],
  formula1: [
    "https://api.rss2json.com/v1/api.json?rss_url=http://feeds.bbci.co.uk/sport/formula1/rss.xml",
    "https://api.rss2json.com/v1/api.json?rss_url=https://www.espn.com/espn/rss/f1/news"
  ]
};

export async function fetchSportsNews(category = 'all') {
  const container = document.getElementById('news-feed-container') || document.querySelector('.news-grid');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner" style="text-align:center; padding: 40px;">⏳ Loading latest sports news...</div>';

  try {
    const feedUrls = SPORTS_FEEDS[category] || SPORTS_FEEDS.all;
    
    // Fetch from multiple sources simultaneously
    const requests = feedUrls.map(url => fetch(url).then(res => res.json()).catch(() => null));
    const responses = await Promise.all(requests);

    let allItems = [];
    responses.forEach(data => {
      if (data && data.status === 'ok' && data.items) {
        allItems = allItems.concat(data.items);
      }
    });

    if (allItems.length === 0) {
      throw new Error("No news items retrieved");
    }

    // Sort combined articles by published date (newest first)
    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    container.innerHTML = allItems.map(item => {
      const cleanDesc = (item.description || '').replace(/<[^>]*>?/gm, '').substring(0, 130);
      const imgUrl = item.thumbnail || (item.enclosure && item.enclosure.link) || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500';

      return `
        <div class="news-card" style="border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; margin-bottom: 20px; background: rgba(255,255,255,0.05);">
          <img src="${imgUrl}" alt="${item.title}" style="width:100%; height: 200px; object-fit: cover;">
          <div style="padding: 15px;">
            <span style="font-size: 12px; opacity: 0.7;">${new Date(item.pubDate).toLocaleDateString()}</span>
            <h3 style="margin: 8px 0; font-size: 18px; color: #fff;">${item.title}</h3>
            <p style="font-size: 14px; opacity: 0.8; line-height: 1.4;">${cleanDesc}...</p>
            <a href="${item.link}" target="_blank" rel="noopener noreferrer" style="display: inline-block; margin-top: 10px; color: #22c55e; font-weight: bold; text-decoration: none;">Read Full Article →</a>
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error("Error fetching news:", error);
    container.innerHTML = `
      <div style="text-align:center; padding: 30px; color: #ff6b6b;">
        <p>⚠️ Unable to load latest news right now. Please refresh or try another category tab.</p>
      </div>
    `;
  }
}

// Attach category filter buttons
document.addEventListener('DOMContentLoaded', () => {
  fetchSportsNews('all');

  const filterButtons = document.querySelectorAll('.news-filter-btn, [data-category]');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const cat = e.target.getAttribute('data-category') || e.target.innerText.toLowerCase().replace(' ', '');
      fetchSportsNews(cat);
    });
  });
});

