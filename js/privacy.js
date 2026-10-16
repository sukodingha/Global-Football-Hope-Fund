export function normalizePrivacy(value, fallback = 'everyone') {
  return ['everyone', 'teammates', 'clubhouse', 'me'].includes(value) ? value : fallback;
}

export function canViewContent(userPrivacy, viewerRole, isOwner, isTeammate, isSameTeam = false) {
  if (isOwner) return true;
  if (userPrivacy === 'everyone') return true;
  if (userPrivacy === 'me') return false;
  if (userPrivacy === 'teammates') return !!isTeammate || viewerRole === 'admin';
  if (userPrivacy === 'clubhouse') return !!isSameTeam || viewerRole === 'admin';
  return false;
}
