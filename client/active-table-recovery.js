export const LAST_ACTIVE_TABLE_KEY = 'fivefold-arc:last-active-table';

function validTarget(value) {
  return value && /^[A-Z0-9]{6}$/.test(value.code) && Number.isInteger(value.seatId) && value.seatId >= 0 && value.seatId < 8 && Number.isFinite(value.updatedAt);
}

export function readLastActiveTable(localStorage) {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_ACTIVE_TABLE_KEY));
    return validTarget(value) ? value : null;
  } catch { return null; }
}

export function saveLastActiveTable(localStorage, target) {
  if (!validTarget(target)) return;
  try { localStorage.setItem(LAST_ACTIVE_TABLE_KEY, JSON.stringify(target)); } catch { /* Storage is optional; recovery remains manual. */ }
}

export function clearLastActiveTable(localStorage) {
  try { localStorage.removeItem(LAST_ACTIVE_TABLE_KEY); } catch { /* Storage is optional. */ }
}

export function shouldClearLastActiveTable(error) {
  return error?.status === 404 || error?.code === 'RECLAIM_UNAVAILABLE';
}

export function startupTableTarget({ queryJoinCode, localStorage }) {
  const code = String(queryJoinCode || '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(code)) return { kind: 'join', code };
  const target = readLastActiveTable(localStorage);
  return target ? { kind: 'reclaim', code: target.code, seatId: target.seatId } : null;
}
