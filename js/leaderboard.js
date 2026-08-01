export function calculateLeaderboard(entries = []) {
  return [...entries].sort((a, b) => (b.points || 0) - (a.points || 0));
}

export function getTopPerformers(entries = [], limit = 5) {
  return calculateLeaderboard(entries).slice(0, limit);
}
