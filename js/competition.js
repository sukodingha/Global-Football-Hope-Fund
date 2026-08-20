import { getLiveFixtures } from "../services/fixturesService.js";

function renderMatchesFromAPI(fixtures) {
    if (!fixtures || fixtures.length === 0) {
        return '<div class="card" style="grid-column:1/-1;text-align:center;color:#64748b;">No live fixtures available right now.</div>';
    }

    return fixtures.slice(0, 12).map((fixture) => {
        const homeTeam = fixture.home_team_name || "Home";
        const awayTeam = fixture.away_team_name || "Away";
        const homeScore = fixture.home_score ?? 0;
        const awayScore = fixture.away_score ?? 0;
        const status = fixture.status || "scheduled";
        const leagueName = fixture.league_name || "League";
        const minute = fixture.minute ? `${fixture.minute}'` : "";
        const kickoffTime = fixture.kickoff_time ? new Date(fixture.kickoff_time) : null;
        const kickoffLabel = kickoffTime && !isNaN(kickoffTime.getTime())
            ? kickoffTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            : "TBD";

        let statusBadge;
        if (status === "live") {
            statusBadge = `<span class="match-status-badge live">${minute || "LIVE"}</span>`;
        } else if (status === "finished") {
            statusBadge = `<span class="match-status-badge ft">FT</span>`;
        } else if (status === "scheduled") {
            statusBadge = `<span class="match-status-badge" style="background:#f5a623;color:#1a1a1a;">Upcoming</span>`;
        } else {
            statusBadge = `<span class="match-status-badge live">${minute || "LIVE"}</span>`;
        }

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
                        <span class="minute">${minute}</span>
                    </div>
                    <div class="match-team">
                        <span class="team-name">${awayTeam}</span>
                    </div>
                </div>
                <div class="match-extra">
                    <span class="match-date">${kickoffLabel}</span>
                    <span class="match-attendees">👥 ${status === "live" ? "Live" : "Fixture"}</span>
                </div>
            </div>
        `;
    }).join("");
}

async function fetchLiveScores() {
    const feedContainer = document.getElementById("live-scores-feed");
    if (!feedContainer) return;

    feedContainer.innerHTML = '<p class="loading-text">⏳ Loading live matches...</p>';

    const fixtures = await getLiveFixtures();
    feedContainer.innerHTML = renderMatchesFromAPI(fixtures);
}

document.addEventListener("DOMContentLoaded", fetchLiveScores);

export { fetchLiveScores };
