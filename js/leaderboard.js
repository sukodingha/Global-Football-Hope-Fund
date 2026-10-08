import { db } from "./firebase.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const TOP_PREDICTOR_POINTS = 100;
export const MATCH_ANALYST_POSTS = 10;

const profileCache = new Map();

export function calculateLeaderboard(entries = []) {
  return [...entries].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
}

export function getTopPerformers(entries = [], count = 5) {
  return calculateLeaderboard(entries).slice(0, count);
}

export function calculateUserBadges(profile = {}) {
  const badges = [];
  if ((Number(profile.predictionPoints) || 0) >= TOP_PREDICTOR_POINTS) {
    badges.push({ className: "badge-top-predictor", label: "Top Predictor", icon: "🎯" });
  }
  if ((Number(profile.postCount) || 0) >= MATCH_ANALYST_POSTS) {
    badges.push({ className: "badge-match-analyst", label: "Match Analyst", icon: "⚽" });
  }
  return badges;
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function renderBadgePills(profile) {
  return calculateUserBadges(profile).map((badge) =>
    `<span class="user-achievement-badge ${badge.className}" title="${badge.label}">${badge.icon} ${badge.label}</span>`
  ).join("");
}

export async function renderUserBadgePills(userId) {
  if (!userId) return "";
  let profilePromise = profileCache.get(userId);
  if (!profilePromise) {
    profilePromise = getDoc(doc(db, "users", userId))
      .then((snapshot) => snapshot.exists() ? snapshot.data() : {})
      .catch((error) => {
        console.warn("Could not load user badge data:", error);
        return {};
      });
    profileCache.set(userId, profilePromise);
  }
  return renderBadgePills(await profilePromise);
}

export function invalidateUserBadgeCache(userId) {
  if (userId) profileCache.delete(userId);
}

export async function renderPredictionLeaderboard(container, user) {
  if (!container) return;
  if (!user) {
    container.innerHTML = '<li class="community-leaderboard-loading">Sign in to view the leaderboard.</li>';
    return;
  }
  container.innerHTML = '<li class="community-leaderboard-loading">Loading leaderboard...</li>';

  try {
    const usersQuery = query(collection(db, "users"), orderBy("predictionPoints", "desc"), limit(5));
    const snapshot = await getDocs(usersQuery);
    const entries = getTopPerformers(snapshot.docs.map((userSnapshot) => ({
      id: userSnapshot.id,
      ...userSnapshot.data(),
      points: Number(userSnapshot.data().predictionPoints) || 0
    })));

    if (!entries.length) {
      container.innerHTML = '<li class="community-leaderboard-loading">No predictors yet.</li>';
      return;
    }

    container.innerHTML = entries.map((user, index) => {
      const displayName = user.displayName || user.firstName || user.username || "Member";
      const badges = renderBadgePills(user);
      return `
        <li class="community-leaderboard-item">
          <span class="community-leaderboard-rank" aria-label="Rank ${index + 1}">${index + 1}</span>
          <div class="community-leaderboard-user">
            <strong>${escapeHtml(displayName)}</strong>
            ${badges ? `<span class="user-achievement-badges">${badges}</span>` : ""}
          </div>
          <span class="community-leaderboard-points">${user.points.toLocaleString()} pts</span>
        </li>
      `;
    }).join("");
  } catch (error) {
    console.error("Could not load prediction leaderboard:", error);
    container.innerHTML = '<li class="community-leaderboard-loading">Leaderboard unavailable.</li>';
  }
}
