import assert from 'node:assert/strict';
import test from 'node:test';
import { tournamentTableFlow } from './tournament-table-flow.mjs';

const snapshot = { podCode: 'ABC123', lifecycle: { status: 'playing' }, turn: { pausedAt: 10, roundEndsAt: 999999 } };
const context = { code: 'ABC123', receivedAt: 1000, linked: true, kind: 'tournament', canAccess: true,
  tournamentRound: { number: 2, status: 'playing', endsAt: 100000, serverNow: 90000 } };

test('official round time follows server deadline through a local pause and clock skew', () => {
  assert.equal(tournamentTableFlow(snapshot, context, 4000).remainingMs, 7000);
  assert.equal(tournamentTableFlow(snapshot, context, 12000).remainingMs, 0);
});
test('casual and stale other-Table contexts never take over a Table', () => {
  assert.equal(tournamentTableFlow(snapshot, { ...context, kind: 'pod' }, 4000), null);
  assert.equal(tournamentTableFlow(snapshot, { ...context, code: 'OTHER1' }, 4000), null);
  assert.equal(tournamentTableFlow(snapshot, null, 4000), null);
});
test('untimed tournament ignores a separately configured casual Table countdown', () => {
  const flow = tournamentTableFlow(snapshot, { ...context, tournamentRound: { ...context.tournamentRound, endsAt: null } }, 4000);
  assert.equal(flow.remainingMs, null);
});
test('finished and between-game Tournament Tables use event postgame rather than casual ready state', () => {
  assert.equal(tournamentTableFlow({ ...snapshot, gameResult: { winnerSeatId: 0 } }, context, 4000).finished, true);
  assert.equal(tournamentTableFlow({ ...snapshot, lifecycle: { status: 'intermission' } }, context, 4000).finished, true);
  assert.equal(tournamentTableFlow(snapshot, context, 4000).finished, false);
});
test('an attested guest sees the event clock without receiving private event navigation', () => {
  const flow = tournamentTableFlow(snapshot, { ...context, canAccess: false }, 4000);
  assert.equal(flow.remainingMs, 7000);
  assert.equal(flow.canOpenEvent, false);
});
