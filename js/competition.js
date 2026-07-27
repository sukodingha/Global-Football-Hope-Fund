/**
 * GFHF Competition Page — Live Scores Feed
 * Fetches real-time match data from API-Sports (same key as dashboard.js)
 * Displays live matches in the #live-scores-feed container
 */

const API_KEY = "6e2987eec8066be0a986f648fe4a9cf7";
const API_HOST = "v3.football.api-sports.io";

/**
 * Fetch live scores from API-Sports and render into the #live-scores-feed container.
 * Only shows matches that are currently "LIVE" (in progress).
 */
async function fetchLiveScores() {
    const feedContainer = document.getElementById('live-scores-feed');
    if (!feedContainer) return;

    // Keep loading state visible while fetching
    feedContainer.innerHTML = '<p class="loading-text">⏳ Fetching live match updates...</p>';

    try {
        const response = await fetch(`https://${API_HOST}/fixtures?live=all`, {
            method: "GET",
            headers: {
                "x-rapidapi-host": API_HOST,
                "x-rapidapi-key": API_KEY
            }
        });

        const data = await response.json();

        if (!data.response || data.response.length === 0) {
            feedContainer.innerHTML = '<p class="no-matches">No live matches currently in progress.</p>';
            return;
        }

        // Clear loading text
        feedContainer.innerHTML = "";

        // Render all live matches
        data.response.forEach(match => {
            const homeTeam = match.teams.home.name;
            const homeLogo = match.teams.home.logo;
            const awayTeam = match.teams.away.name;
            const awayLogo = match.teams.away.logo;
            const homeGoals = match.goals.home ?? 0;
            const awayGoals = match.goals.away ?? 0;
            const elapsed = match.fixture.status.elapsed;
            const leagueName = match.league.name;
            const leagueLogo = match.league.logo;

            const matchCard = document.createElement('div');
            matchCard.className = 'match-card';

            // Determine result label for color coding
            let homeClass = '', awayClass = '', resultLabel = '';
            if (match.fixture.status.short === 'FT') {
                resultLabel = 'FT';
                if (homeGoals > awayGoals) {
                    homeClass = 'text-winner';
                    awayClass = 'text-loser';
                } else if (homeGoals < awayGoals) {
                    homeClass = 'text-loser';
                    awayClass = 'text-winner';
                } else {
                    homeClass = 'text-draw';
                    awayClass = 'text-draw';
                }
            } else if (match.fixture.status.short === 'LIVE' || (elapsed && elapsed > 0)) {
                resultLabel = `${elapsed}' Live`;
            } else {
                resultLabel = match.fixture.status.short || 'Scheduled';
            }

            matchCard.innerHTML = `
                <div class="match-league">
                    <span class="league-pill">${leagueLogo ? `<img src="${leagueLogo}" alt="" width="14" height="14" style="vertical-align:middle;margin-right:4px;">` : ''}${leagueName}</span>
                    <span class="match-status-badge ${match.fixture.status.short === 'FT' ? 'ft' : match.fixture.status.short === 'LIVE' || (elapsed && elapsed > 0) ? 'live' : ''}">${resultLabel}</span>
                </div>
                <div class="match-teams">
                    <div class="match-team ${homeClass}">
                        ${homeLogo ? `<img src="${homeLogo}" alt="${homeTeam}" width="24" height="24" style="vertical-align:middle;">` : ''}
                        <span class="team-name">${homeTeam}</span>
                    </div>
                    <div class="match-score-display">
                        <span class="score ${match.fixture.status.short === 'FT' ? 'text-neutral' : ''}">${homeGoals} - ${awayGoals}</span>
                    </div>
                    <div class="match-team ${awayClass}">
                        ${awayLogo ? `<img src="${awayLogo}" alt="${awayTeam}" width="24" height="24" style="vertical-align:middle;">` : ''}
                        <span class="team-name">${awayTeam}</span>
                    </div>
            `;
            feedContainer.appendChild(matchCard);
        });

    } catch (error) {
        console.error("Error fetching live matches:", error);
        feedContainer.innerHTML = "<p class='error-text'>Failed to load live match data. Please try again later.</p>";
    }
}

// Kick off the fetch when the competition page loads
document.addEventListener('DOMContentLoaded', fetchLiveScores);

// Auto-refresh live scores every 60 seconds
setInterval(fetchLiveScores, 60000);

export { fetchLiveScores };
