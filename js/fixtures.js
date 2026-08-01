export function getUpcomingFixtures(teams = [], limit = 6) {
  return teams.slice(0, limit);
}

export function getFixtureStatus(fixture) {
  if (!fixture) return 'pending';
  return fixture.status || 'pending';
}
