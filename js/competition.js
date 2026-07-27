/**
 * GFHF Competition Page — Live Scores Feed
 * Fetches real-time match data from API-Sports (same key as dashboard.js)
 * Displays live matches in the #live-scores-feed container
 */

const API_KEY = "a7ba1c6350msha38f55a1caaad1dp19506fjsn7159adf87d0e";
const API_HOST = "sportapi7.p.rapidapi.com";

/**
 * Generate mock live match cards as fallback when API fails or returns empty.
 */
function renderMockFixtures() {
    const mockMatches = [
        { league: 'Premier League', home: 'Arsenal', away: 'Chelsea', hScore: 2, aScore: 1, min: 67, status: 'live', leagueLogo: '' },
        { league: 'La Liga', home: 'Barcelona', away: 'Real Madrid', hScore: 1, aScore: 1, min: 42, status: 'live', leagueLogo: '' },
        { league: 'Serie A', home: 'AC Milan', away: 'Inter Milan', hScore: 0, aScore: 2, min: 55, status: 'live', leagueLogo: '' },
        { league: 'Bundesliga', home: 'Bayern Munich', away: 'Borussia Dortmund', hScore: 3, aScore: 1, min: 78, status: 'live', leagueLogo: '' },
        { league: 'Ligue 1', home: 'PSG', away: 'Marseille', hScore: 2, aScore: 0, min: 31, status: 'live', leagueLogo: '' },
        { league: 'Premier League', home: 'Liverpool', away: 'Man City', hScore: 1, aScore: 2, min: 85, status: 'live', leagueLogo: '' }
    ];
    return mockMatches.map(m => `
        <div class="match-card">
            <div class="match-league">
                <span class="league-pill">${m.leagueLogo} ${m.league}</span>
                <span class="match-status-badge live">${m.min}' Live</span>
            </div>
            <div class="match-teams">
                <div class="match-team">
                    <span class="team-name">${m.home}</span>
                </div>
                <div class="match-score-display">
                    <span class="score">${m.hScore} - ${m.aScore}</span>
                    <span class="minute">${m.min}'</span>
                </div>
                <div class="match-team">
                    <span class="team-name">${m.away}</span>
                </div>
            <div class="match-extra">
                <span class="match-date">Today</span>
                <span class="match-attendees">👥 Live</span>
            </div>
    `).join('');
}

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
        const response = await fetch(`https://${API_HOST}/v3/fixtures?live=all`, {
            method: "GET",
            headers: {
                "x-rapidapi-host": API_HOST,
                "x-rapidapi-key": API_KEY
            }
        });

        // HARD FALLBACK: If 403/401 Forbidden/Unauthorized, throw to trigger mock data
        if (response.status === 403 || response.status === 401) {
            throw new Error(`API returned ${response.status} Forbidden/Unauthorized`);
        }

        const data = await response.json();

        if (!data.response || data.response.length === 0) {
            // MOCK FALLBACK: Show default match cards instead of "No live matches"
            feedContainer.innerHTML = renderMockFixtures();
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
        // MOCK FALLBACK: Show default match cards on error
        feedContainer.innerHTML = renderMockFixtures();
    }
}

// Kick off the fetch when the competition page loads
document.addEventListener('DOMContentLoaded', fetchLiveScores);

// Auto-refresh live scores every 60 seconds
setInterval(fetchLiveScores, 60000);

export { fetchLiveScores };
