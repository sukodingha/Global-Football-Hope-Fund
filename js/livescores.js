/**
 * GFHF Live Football Score Ticker
 * Simulates real-time match data with auto-rotating scores and statuses.
 */

const LEAGUE_LOGOS = {
  "Premier League": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "La Liga": "🇪🇸",
  "Serie A": "🇮🇹",
  "Bundesliga": "🇩🇪",
  "Ligue 1": "🇫🇷",
  "UEFA Champions League": "⭐",
  "MLS": "🇺🇸",
  "World Cup": "🏆"
};

const LEAGUE_TEAMS = {
  "Premier League": [
    { name: "Arsenal", emoji: "🔴" },
    { name: "Chelsea", emoji: "🔵" },
    { name: "Liverpool", emoji: "❤️" },
    { name: "Man City", emoji: "💙" },
    { name: "Man United", emoji: "🔴" },
    { name: "Tottenham", emoji: "⚪" },
    { name: "Aston Villa", emoji: "🟣" },
    { name: "Newcastle", emoji: "⚫" },
    { name: "West Ham", emoji: "🟣" },
    { name: "Brighton", emoji: "🟦" }
  ],
  "La Liga": [
    { name: "Barcelona", emoji: "🔵🔴" },
    { name: "Real Madrid", emoji: "⚪" },
    { name: "Atletico", emoji: "🔴⚪" },
    { name: "Sevilla", emoji: "🔴" },
    { name: "Valencia", emoji: "🟠" },
    { name: "Real Sociedad", emoji: "🔵⚪" }
  ],
  "Serie A": [
    { name: "Inter", emoji: "🔵⚫" },
    { name: "AC Milan", emoji: "🔴⚫" },
    { name: "Juventus", emoji: "⚫⚪" },
    { name: "Napoli", emoji: "🔵" },
    { name: "Roma", emoji: "🟡🔴" },
    { name: "Lazio", emoji: "🔵⚪" }
  ],
  "Bundesliga": [
    { name: "Bayern", emoji: "🔴" },
    { name: "Dortmund", emoji: "🟡⚫" },
    { name: "Leverkusen", emoji: "🔴⚫" },
    { name: "RB Leipzig", emoji: "🔴⚪" }
  ],
  "Ligue 1": [
    { name: "PSG", emoji: "🔵🔴" },
    { name: "Marseille", emoji: "🔵⚪" },
    { name: "Lyon", emoji: "🔵🔴" }
  ],
  "UEFA Champions League": [
    { name: "Real Madrid", emoji: "⚪" },
    { name: "Man City", emoji: "💙" },
    { name: "Bayern", emoji: "🔴" },
    { name: "PSG", emoji: "🔵🔴" },
    { name: "Barcelona", emoji: "🔵🔴" },
    { name: "Inter", emoji: "🔵⚫" }
  ],
  "MLS": [
    { name: "LA Galaxy", emoji: "🟡" },
    { name: "Inter Miami", emoji: "🟣" },
    { name: "NYC FC", emoji: "🔵" },
    { name: "Atlanta Utd", emoji: "🔴⚫" },
    { name: "Seattle", emoji: "💚" }
  ],
  "World Cup": [
    { name: "Brazil", emoji: "💛💚" },
    { name: "Argentina", emoji: "🔵⚪" },
    { name: "France", emoji: "🔵⚪🔴" },
    { name: "Germany", emoji: "⚫🔴🟡" },
    { name: "Portugal", emoji: "🔴💚" },
    { name: "England", emoji: "⚪🔴" }
  ]
};

const LEAGUES = Object.keys(LEAGUE_TEAMS);

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMatch() {
  const league = pickRandom(LEAGUES);
  const teams = LEAGUE_TEAMS[league];
  const home = pickRandom(teams);
  let away = pickRandom(teams);
  while (away.name === home.name) {
    away = pickRandom(teams);
  }

  const statuses = ["live", "live", "live", "ft", "ht"];
  const status = pickRandom(statuses);

  let homeScore, awayScore, minute;
  const now = new Date();

  switch (status) {
    case "ft":
      homeScore = Math.floor(Math.random() * 5);
      awayScore = Math.floor(Math.random() * 5);
      minute = "FT";
      break;
    case "ht":
      homeScore = Math.floor(Math.random() * 3);
      awayScore = Math.floor(Math.random() * 3);
      minute = "HT";
      break;
    default: // live
      homeScore = Math.floor(Math.random() * 4);
      awayScore = Math.floor(Math.random() * 4);
      minute = Math.floor(Math.random() * 90) + 1;
      if (minute > 45) minute += Math.floor(Math.random() * 5); // stoppage time
      minute = `${minute}'`;
      break;
  }

  // Format date
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });

  // Random venue capacity
  const attendance = Math.floor(Math.random() * 60000) + 10000;
  const formattedAttendance = attendance >= 1000
    ? `${(attendance / 1000).toFixed(1)}k`
    : attendance.toString();

  return {
    league,
leagueLogo: LEAGUE_LOGOS[league] || "⚽",
    homeTeam: home.name,
    homeEmoji: home.emoji,
    awayTeam: away.name,
    awayEmoji: away.emoji,
    homeScore,
    awayScore,
    status,
    minute,
    date: dateStr,
    attendance: formattedAttendance
  };
}

function createMatchCard(match) {
  const card = document.createElement("div");
  card.className = "match-card";

  const statusClass = match.status === "live" ? "live" : match.status === "ft" ? "ft" : "ht";
  const statusLabel = match.status === "live" ? "LIVE" : match.status === "ft" ? "FT" : "HT";

  card.innerHTML = `
    <div class="match-league">
      <span class="league-pill">${match.leagueLogo} ${match.league}</span>
      <span class="match-status-badge ${statusClass}">${statusLabel}</span>
    </div>
    <div class="match-teams">
      <div class="match-team">
        <span class="team-emoji">${match.homeEmoji}</span>
        <span class="team-name">${match.homeTeam}</span>
      </div>
      <div class="match-score-display">
        <span class="score">${match.homeScore} - ${match.awayScore}</span>
        <span class="minute">${match.minute}</span>
      </div>
      <div class="match-team">
        <span class="team-emoji">${match.awayEmoji}</span>
        <span class="team-name">${match.awayTeam}</span>
      </div>
    </div>
    <div class="match-extra">
      <span class="match-date">${match.date}</span>
      <span class="match-attendees">👥 ${match.attendance}</span>
    </div>
  `;

  return card;
}

/**
 * Initialize the score ticker
 */
export function initLiveScores() {
  const track = document.getElementById("tickerTrack");
  if (!track) return;

  // Generate initial matches
  const matchCount = 16; // 8 unique matches, duplicated for seamless scroll
  const matches = [];
  for (let i = 0; i < matchCount; i++) {
    matches.push(generateMatch());
  }

  // Clear and populate
  track.innerHTML = "";
  matches.forEach((match) => {
    track.appendChild(createMatchCard(match));
  });

  // Periodically update scores to simulate live action
  setInterval(() => {
    const cards = track.querySelectorAll(".match-card");
    cards.forEach((card) => {
      // 40% chance to update a card (simulating live changes)
      if (Math.random() < 0.4) {
        const newMatch = generateMatch();
        const statusClass = newMatch.status === "live" ? "live" : newMatch.status === "ft" ? "ft" : "ht";
        const statusLabel = newMatch.status === "live" ? "LIVE" : newMatch.status === "ft" ? "FT" : "HT";

        card.querySelector(".league-pill").textContent = `${newMatch.leagueLogo} ${newMatch.league}`;
        card.querySelector(".match-status-badge").className = `match-status-badge ${statusClass}`;
        card.querySelector(".match-status-badge").textContent = statusLabel;

        const teams = card.querySelectorAll(".team-emoji");
        teams[0].textContent = newMatch.homeEmoji;
        teams[1].textContent = newMatch.awayEmoji;

        const names = card.querySelectorAll(".team-name");
        names[0].textContent = newMatch.homeTeam;
        names[1].textContent = newMatch.awayTeam;

        card.querySelector(".score").textContent = `${newMatch.homeScore} - ${newMatch.awayScore}`;
        card.querySelector(".minute").textContent = newMatch.minute;
        card.querySelector(".match-date").textContent = newMatch.date;
        card.querySelector(".match-attendees").textContent = `👥 ${newMatch.attendance}`;
      }
    });
  }, 5000); // Update every 5 seconds
}

// Auto-initialize on DOM ready
