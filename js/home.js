import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHPBadgeHTML, formatHP } from "./rewards.js";
import { getFixturesByIds } from "../services/fixturesService.js";

const memberCount = document.getElementById("memberCount");
const donationCount = document.getElementById("donationCount");
const countryCount = document.getElementById("countryCount");
const prizePool = document.getElementById("prizePool");

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

async function loadHomeStats() {
  if (!memberCount && !donationCount && !countryCount && !prizePool) return;
  if (!db) { console.warn("Firestore db not available"); return; }

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const users = usersSnap.docs.map((docSnap) => docSnap.data());
    const countries = new Set(users.map((user) => user.country).filter(Boolean));

    let totalDonations = 0;
    let donationDocs = 0;

    const donationsSnap = await getDocs(collection(db, "donations"));
    donationDocs = donationsSnap.size;
    donationsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const amount = toNumber(data.amountUsd ?? data.amount ?? data.usd ?? data.value ?? 0);
      totalDonations += amount;
    });

    if (donationDocs === 0) {
      const statsDoc = await getDoc(doc(db, "siteStats", "global"));
      if (statsDoc.exists()) {
        const statsData = statsDoc.data();
        totalDonations = toNumber(statsData.totalDonations ?? statsData.donationTotal ?? totalDonations);
      }
    }

    if (memberCount) memberCount.textContent = users.length.toString();
    if (countryCount) countryCount.textContent = countries.size.toString();
    if (donationCount) donationCount.textContent = formatCurrency(totalDonations);
    if (prizePool) prizePool.textContent = formatCurrency(totalDonations * 0.2);
  } catch (error) {
    console.error("Could not load home stats", error);
    if (memberCount) memberCount.textContent = "0";
    if (countryCount) countryCount.textContent = "0";
    if (donationCount) donationCount.textContent = "$0";
    if (prizePool) prizePool.textContent = "$0";
  }
}

loadHomeStats();

// ===== TOP 20 HP EARNERS LEADERBOARD (Home Page) =====
async function loadTopEarnersLeaderboard() {
  const container = document.getElementById('topEarnersList');
  if (!container) return;
  if (!db) { container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">Database unavailable.</p>'; return; }

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("rewardPoints", "desc"), limit(20));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">No earners found yet. Start earning HP today!</p>';
      return;
    }

    let html = '';
    let rank = 1;

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const username = data.displayName || data.username || data.email?.split('@')[0] || "User";
      const hp = data.rewardPoints || 0;

      const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;

      html += `
        <div class="leaderboard-item">
          <span class="leaderboard-rank">${rankIcon}</span>
          <span class="leaderboard-name"><strong>${username}</strong></span>
          <span class="leaderboard-hp">${formatHP(hp)} HP</span>
        </div>
      `;
      rank++;
    });

    container.innerHTML = html;
  } catch (error) {
    console.error("Error loading top earners leaderboard:", error);
    container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">Unable to load leaderboard.</p>';
  }
}

async function loadUserActivePredictions() {
  const container = document.getElementById('userActivePredictionsList');
  if (!container) return;

  if (!auth || !db) {
    container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">Prediction data is unavailable right now.</p>';
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">Sign in to see your live predicted matches.</p>';
    return;
  }

  try {
    const q = query(collection(db, 'predictions'), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const predictions = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((prediction) => prediction.fixtureId && prediction.status !== 'correct' && prediction.status !== 'incorrect');

    if (!predictions.length) {
      container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">No active predictions right now.</p>';
      return;
    }

    const fixtures = await getFixturesByIds(predictions.map((prediction) => prediction.fixtureId));
    const liveMatches = predictions
      .map((prediction) => {
        const match = fixtures.find((fixture) => String(fixture.fixture_id) === String(prediction.fixtureId));
        if (!match) return null;
        const status = String(match.status || '').toLowerCase();
        if (!['live', 'half_time'].includes(status)) return null;
        return { prediction, match };
      })
      .filter(Boolean);

    if (!liveMatches.length) {
      container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">No matches are currently live for your predictions.</p>';
      return;
    }

    container.innerHTML = liveMatches.map(({ prediction, match }) => `
      <div class="leaderboard-item" style="grid-template-columns: 1fr auto auto;">
        <span class="leaderboard-name"><strong>${match.home_team_name || 'Home'} vs ${match.away_team_name || 'Away'}</strong></span>
        <span class="leaderboard-hp" style="color:#fbbf24;">LIVE</span>
        <span class="leaderboard-hp">${prediction.pick === 'home' ? 'Home Win' : prediction.pick === 'draw' ? 'Draw' : 'Away Win'}</span>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading active predicted matches:', error);
    container.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:20px 0;">Unable to load your live predicted matches.</p>';
  }
}

onAuthStateChanged(auth, () => {
  loadUserActivePredictions();
});

// Load leaderboard on DOMContentLoaded (works even when not signed in)
document.addEventListener('DOMContentLoaded', () => {
  loadTopEarnersLeaderboard();
  loadUserActivePredictions();
});
