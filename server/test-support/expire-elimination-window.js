import assert from 'node:assert/strict';

// Existing result/archive tests advance the real 15-second boundary explicitly.
// Keep those result assertions without sleeping or bypassing finalization rules.
export function expireEliminationWindow(service, code) {
  const room = service.room(code), pending = room.pendingFinish;
  assert.ok(pending, 'An automatic finish must first expose its undo window');
  const previousNow = service.now, offset = Math.max(0, pending.expiresAt - previousNow());
  service.now = () => previousNow() + offset;
  service.finishExpiredElimination(room);
  return service.snapshot(room);
}
