/**
 * GFHF Competition Page — Live Scores Feed (sportapi7 RapidAPI)
 * Fetches live football matches from https://sportapi7.p.rapidapi.com
 * Falls back to mock data on error/403/429
 */

// ===== API CONFIG =====
const RAPIDAPI_KEY = "a7ba1c6350msha38f55a1caaad1dp19506fjsn7159adf87d0e";
const RAPIDAPI_HOST = "sportapi7.p.rapidapi.com";
const LIVE_ENDPOINT = "https://sportapi7.p.rapidapi.com/api/v1/sport/football/events/live";

// ===== FIXTURE CACHE =====
const competitionCache = new Map();
const COMPETITION_CACHE_TTL = 60000; // 1 minute cache

/**
 * Generate fallback match cards (mock data) when API fails
 */
function generateFallbackMatches() {
    const fallbackLeagues = {
        'Premier League': ['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Man United', 'Tottenham'],
        'La Liga': ['Barcelona', 'Real Madrid', 'Atletico Madrid', 'Sevilla'],
        'Serie A': ['Inter Milan', 'AC Milan', 'Juventus', 'Napoli'],
        'Bundesliga': ['Bayern Munich', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen'],
        'Ligue 1': ['PSG', 'Marseille', 'Lyon', 'Monaco']
    };
    const leagueNames = Object.keys(fallbackLeagues);

    return Array.from({ length: 6 }, () => {
        const league = leagueNames[Math.floor(Math.random() * leagueNames.length)];
        const teams = fallbackLeagues[league];
        const home = teams[Math.floor(Math.random() * teams.length)];
        let away;
        do { away = teams[Math.floor(Math.random() * teams.length)]; } while (away === home);
        const hScore = Math.floor(Math.random() * 4);
        const aScore = Math.floor(Math.random() * 4);
        const min = Math.floor(Math.random() * 90) + 1;

        return `
            <div class="match-card">
                <div class="match-league">
                    <span class="league-pill">${league}</span>
                    <span class="match-status-badge live">${min}' Live</span>
                </div>
                <div class="match-teams">
                    <div class="match-team">
                        <span class="team-name">${home}</span>
                    </div>
                    <div class="match-score-display">
                        <span class="score">${hScore} - ${aScore}</span>
                        <span class="minute">${min}'</span>
                    </div>
                    <div class="match-team">
                        <span class="team-name">${away}</span>
                    </div>
                <div class="match-extra">
                    <span class="match-date">Today</span>
                    <span class="match-attendees">👥 Live</span>
                </div>
        `;
    }).join('');
}

/**
 * Render API match data into match cards
 */
function renderMatchesFromAPI(events) {
    if (!events || events.length === 0) {
        return generateFallbackMatches();
    }

    return events.slice(0, 12).map(event => {
        const homeTeam = event.homeTeam?.name || event.homeTeam || "Home";
        const awayTeam = event.awayTeam?.name || event.awayTeam || "Away";
        const homeScore = event.homeScore?.current ?? event.homeScore ?? 0;
        const awayScore = event.awayScore?.current ?? event.awayScore ?? 0;
        const status = event.status || "live";
        const leagueName = event.tournament?.name || event.league || "League";
        const matchMinute = event.matchTime ?? event.minute ?? "";

        let statusBadge;
        if (status === "live") {
            statusBadge = `<span class="match-status-badge live">${matchMinute ? `${matchMinute}' Live` : "LIVE"}</span>`;
        } else if (status === "finished" || status === "ended") {
            statusBadge = `<span class="match-status-badge ft">FT</span>`;
        } else if (status === "not_started" || status === "scheduled") {
            statusBadge = `<span class="match-status-badge" style="background:#f5a623;color:#1a1a1a;">Upcoming</span>`;
        } else {
            statusBadge = `<span class="match-status-badge live">${matchMinute ? `${matchMinute}'` : "LIVE"}</span>`;
        }

        const startTime = event.startTime ? new Date(event.startTime) : null;
        const dateStr = startTime && !isNaN(startTime.getTime())
            ? startTime.toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Today";

        return `
            <div class="match-card">
                <div class="match-league">
                    <span class="league-pill">${leagueName}</span>
                    ${statusBadge}
                </div>
                <div class="match-teams">
                    <div class="match-team">
                        <span class="team-name">${homeTeam}</span>
                    </div>
                    <div class="match-score-display">
                        <span class="score">${homeScore} - ${awayScore}</span>
                        <span class="minute">${matchMinute ? `${matchMinute}'` : ''}</span>
                    </div>
                    <div class="match-team">
                        <span class="team-name">${awayTeam}</span>
                    </div>
                <div class="match-extra">
                    <span class="match-date">${dateStr}</span>
                    <span class="match-attendees">👥 Live</span>
                </div>
        `;
    }).join('');
}

/**
 * Fetch live scores from sportapi7 RapidAPI with fallback to mock data
 */
async function fetchLiveScores() {
    const feedContainer = document.getElementById('live-scores-feed');
    if (!feedContainer) return;

    // Show loading state
    feedContainer.innerHTML = '<p class="loading-text">⏳ Loading live matches...</p>';

    // CHECK CACHE FIRST
    if (competitionCache.has('live') && (Date.now() - competitionCache.get('live').timestamp < COMPETITION_CACHE_TTL)) {
        feedContainer.innerHTML = competitionCache.get('live').html;
        return;
    }

    try {
        const response = await fetch(LIVE_ENDPOINT, {
            method: "GET",
            headers: {
                "x-rapidapi-key": RAPIDAPI_KEY,
                "x-rapidapi-host": RAPIDAPI_HOST
            }
        });

        // Handle non-OK HTTP statuses gracefully
        if (!response.ok) {
            if (response.status === 403) {
                console.warn("sportapi7 returned 403 (Forbidden). API key may be invalid or expired. Falling back to mock matches.");
            } else if (response.status === 429) {
                console.warn("sportapi7 returned 429 (Rate Limited). Falling back to mock matches.");
            } else {
                console.warn(`sportapi7 returned ${response.status} (${response.statusText}). Falling back to mock matches.`);
            }
            const fallbackHtml = generateFallbackMatches();
            feedContainer.innerHTML = fallbackHtml;
            competitionCache.set('live', { html: fallbackHtml, timestamp: Date.now() });
            return;
        }

        const data = await response.json();

        // Extract events from response — sportapi7 returns { data: { events: [...] } }
        const events = data?.data?.events || data?.events || data?.response || [];

        if (!events || events.length === 0) {
            console.warn("sportapi7 returned empty events array. Falling back to mock matches.");
            const fallbackHtml = generateFallbackMatches();
            feedContainer.innerHTML = fallbackHtml;
            competitionCache.set('live', { html: fallbackHtml, timestamp: Date.now() });
            return;
        }

        // Render API data into match cards
        const html = renderMatchesFromAPI(events);
        feedContainer.innerHTML = html;
        competitionCache.set('live', { html, timestamp: Date.now() });

    } catch (error) {
        console.error("Error fetching live matches from sportapi7:", error);
        // Fallback to mock data on network error
        const fallbackHtml = generateFallbackMatches();
        feedContainer.innerHTML = fallbackHtml;
        competitionCache.set('live', { html: fallbackHtml, timestamp: Date.now() });
    }
}

// Kick off the fetch when the competition page loads
document.addEventListener('DOMContentLoaded', fetchLiveScores);

export { fetchLiveScores };
