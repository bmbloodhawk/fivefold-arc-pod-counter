export function orderFromChoices(ids, choices) {
  const groups = new Map();
  for (const id of ids) {
    if (choices[id] === undefined || choices[id] === '') throw new Error('Choose a finishing position for every player.');
    const position = Number(choices[id]);
    if (!Number.isInteger(position) || position < 1 || position > ids.length) throw new Error('Choose a valid finishing position.');
    if (!groups.has(position)) groups.set(position, []);
    groups.get(position).push(id);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group.sort());
}
export function finishingChoices(order = []) {
  let rank = 1; const choices = {};
  for (const group of order) { for (const id of group) choices[id] = rank; rank += group.length; }
  return choices;
}
export function localDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseCompetitionFragment(hash) {
  if (typeof hash !== 'string' || hash.length > 400) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.has('watch') || params.has('viewer')) {
    const eventId = params.get('watch'), viewerToken = params.get('viewer');
    return [...params.keys()].length === 2 && /^event_[\w-]{1,100}$/.test(eventId || '') && /^[\w-]{8,100}$/.test(viewerToken || '')
      ? { eventId, viewerToken } : null;
  }
  const invite = params.get('invite');
  if (invite && /^(pod|tournament)\.[\w-]{1,100}\.[\w-]{1,100}$/.test(invite)) return { invite };
  const eventId = params.get('event'), guestToken = params.get('guest');
  return /^event_[\w-]{1,100}$/.test(eventId || '') && /^[\w-]{8,100}$/.test(guestToken || '') ? { eventId, guestToken } : null;
}
export function tournamentAttendance(event) {
  const entrants = (event.members || []).filter(row => row.participating);
  return { attending: entrants.filter(row => row.status === 'active').length,
    pending: entrants.filter(row => row.status === 'pending').length,
    withdrawn: entrants.filter(row => row.status === 'left').length };
}
export function finishedTableTransition(current, nextCode = null) {
  if (!current?.code) return 'available';
  if (current.code === nextCode) return 'same';
  const snapshot = current.snapshot;
  if (snapshot?.gameResult || ['finished', 'complete', 'intermission'].includes(snapshot?.lifecycle?.status)) return 'confirm';
  return 'blocked';
}
export function setupObservationKey(snapshot, seatId, connectionId, authEpoch) {
  if (!snapshot?.code || !connectionId || !Number.isInteger(seatId) || !['lobby', 'intermission'].includes(snapshot.lifecycle?.status)) return null;
  return [snapshot.code, snapshot.lifecycle.status, seatId, connectionId, authEpoch, snapshot.hostSeatId,
    snapshot.seats.filter(seat => seat.claimed).map(seat => seat.seatId).join(',')].join(':');
}
export function contextObservationKey(snapshot, seatId, connectionId, authEpoch) {
  return snapshot?.code && connectionId && Number.isInteger(seatId)
    ? [snapshot.code, seatId, connectionId, authEpoch, snapshot.lifecycle?.status || '', snapshot.gameId || ''].join(':') : null;
}
