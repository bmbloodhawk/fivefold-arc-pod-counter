import assert from 'node:assert/strict';
import test from 'node:test';
import { spectatorBoardHtml, spectatorClockText, spectatorFailure } from './tournament-spectator.mjs';

test('private spectator board renders only the read-only projection and escapes aliases', () => {
  const html = spectatorBoardHtml({ name: '<script>bad</script>', status: 'playing', plannedRounds: 3, roundNumber: 1,
    serverNow: 1000, expiresAt: 999999, timing: { endsAt: 121000 },
    rounds: [{ number: 1, status: 'playing', assignments: [{ tableNumber: 1, status: 'awaiting_confirmation', participants: ['<bad>', 'B'], clock: { phase: 'extra_turns', remaining: 2 }, roomCode: 'SECRET', id: 'private' }] }],
    resultCounts: { confirmed: 0, awaitingConfirmation: 1, playing: 0, cancelled: 0 },
    standings: [{ alias: 'B', points: 0, rank: 1, gamesPlayed: 0, identityId: 'PRIVATEID' }] });
  assert.match(html, /Private spectator board/); assert.match(html, /Awaiting host confirmation/);
  assert.match(html, /Confirmed standings/); assert.match(html, /&lt;bad&gt;/); assert.match(html, /2 additional turns/);
  assert.doesNotMatch(html, /<script>|SECRET|PRIVATEID|<button|data-join|data-result/);
});

test('spectator clock distinguishes untimed, waiting and finished clock states', () => {
  assert.equal(spectatorClockText({ status: 'registration', timing: {} }), 'Waiting for the first round.');
  assert.equal(spectatorClockText({ status: 'playing', timing: {} }), 'Untimed round.');
  assert.equal(spectatorClockText({ status: 'playing', timing: { endsAt: 1000 }, serverNow: 1001 }), 'Round time has ended. Tables finish their final turns.');
  assert.equal(spectatorClockText({ status: 'playing', timing: { endsAt: 61000 }, serverNow: 1000 }), '1:00 remaining');
  assert.equal(spectatorClockText({ status: 'completed', timing: {} }), 'Tournament completed.');
  assert.equal(spectatorClockText({ status: 'between_rounds', timing: { endsAt: 1000 }, serverNow: 9000 }), 'Waiting for the next round.');
});

test('spectator failures explain private expiry and revocation without implying entry', () => {
  assert.match(spectatorFailure({ code: 'VIEWER_LINK_EXPIRED' }), /expired/);
  assert.match(spectatorFailure({ code: 'VIEWER_LINK_REVOKED' }), /revoked/);
  assert.match(spectatorFailure({ status: 404 }), /unavailable/);
  assert.match(spectatorFailure({ status: 503 }), /Refresh has stopped/);
});
