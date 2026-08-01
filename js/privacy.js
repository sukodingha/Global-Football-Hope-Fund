export function normalizePrivacy(value, fallback = 'everyone') {
  return ['everyone', 'teammates', 'me'].includes(value) ? value : fallback;
}

export function canViewContent(userPrivacy, viewerRole, isOwner, isTeammate) {
  if (isOwner) return true;
  if (userPrivacy === 'everyone') return true;
  if (userPrivacy === 'me') return false;
  if (userPrivacy === 'teammates') return !!isTeammate || viewerRole === 'admin';
  return false;
}
