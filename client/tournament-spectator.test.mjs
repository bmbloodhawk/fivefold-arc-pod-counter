import assert from 'node:assert/strict';
import test from 'node:test';
import { spectatorBoardHtml, spectatorClockText, spectatorFailure } from './tournament-spectator.mjs';
import * as spectator from './tournament-spectator.mjs';

test('private spectator board renders only the read-only projection and escapes aliases', () => {
  const html = spectatorBoardHtml({ name: '<script>bad</script>', status: 'playing', plannedRounds: 3, roundNumber: 1,
    serverNow: 1000, expiresAt: 999999, timing: { endsAt: 121000 },
    rounds: [{ number: 1, status: 'playing', assignments: [{ tableNumber: 1, status: 'awaiting_confirmation', participants: ['<bad>', 'B'], clock: { phase: 'extra_turns', remaining: 2 }, roomCode: 'SECRET', id: 'private' }] }],
    resultCounts: { confirmed: 0, awaitingConfirmation: 1, playing: 0, cancelled: 0 },
    standings: [{ alias: 'B', points: 0, rank: 1, gamesPlayed: 0, identityId: 'PRIVATEID' }] });
  assert.match(html, /Private event board/); assert.match(html, /Awaiting host confirmation/);
  assert.match(html, /Confirmed standings/); assert.match(html, /&lt;bad&gt;/); assert.match(html, /2 additional turns/);
  assert.match(html, /data-watch-round="1" data-watch-table="1"/);
  assert.match(html, /Watch Table 1/);
  assert.doesNotMatch(html, /class="competition-rank"/);
  assert.doesNotMatch(html, /<script>|SECRET|PRIVATEID|data-join|data-result|Live life totals are not shown/);
});

test('confirmed standings include a zero-point confirmed finisher without ranking entrants who have no confirmed games', () => {
  const html = spectatorBoardHtml({ status: 'playing', timing: {}, rounds: [], standings: [
    { alias: 'No confirmed result', rank: 2, points: 0, gamesPlayed: 0 }, { alias: 'Confirmed finisher', rank: 2, points: 0, gamesPlayed: 1 },
  ] });
  assert.match(html, /Confirmed finisher/); assert.doesNotMatch(html, /No confirmed result/);
});

const liveTable = () => ({ name: 'Friday', roundNumber: 1, tableNumber: 2, status: 'playing', serverNow: 61000,
  expiresAt: 9999999999999, timing: { endsAt: 181000, phase: 'extra_turns', remaining: 2 }, hasLiveTotals: true,
  resultStatus: null, result: null, pendingFinish: null,
  turn: { trackingEnabled: true, activeSeatNumber: 1, turnNumber: 4, gameElapsedMs: 60000, turnElapsedMs: 9000, pausedAt: null },
  seats: [
    { seatNumber: 1, alias: '<Alice>', counters: { life: 31, poison: 2, energy: 3, radiation: 4, generic: 5 },
      commanders: [{ commanderNumber: 1, name: '<Veyran>', tax: 4, castCount: 2 }], commanderDamageReceived: [{ seatNumber: 2, commanderNumber: 1, damage: 7 }], eliminated: false },
    { seatNumber: 2, alias: 'Bob', counters: { life: 0, poison: 0, energy: 0, radiation: 0, generic: 0 },
      commanders: [{ commanderNumber: 1, name: 'Norin', tax: 2, castCount: 1 }], commanderDamageReceived: [], eliminated: true, eliminationReason: 'life' },
  ] });

test('live Table renderer keeps life visible and secondary counters and incoming commander sources in read-only details', () => {
  assert.equal(typeof spectator.spectatorTableHtml, 'function');
  const html = spectator.spectatorTableHtml(liveTable());
  assert.match(html, /Watch Table 2/); assert.match(html, /Round 1/); assert.match(html, /Read only/);
  assert.match(html, /&lt;Alice&gt;/); assert.match(html, /&lt;Veyran&gt;/); assert.match(html, />31</);
  assert.match(html, /Active turn/); assert.match(html, /Eliminated/); assert.match(html, /Commander tax/); assert.match(html, />4</);
  assert.match(html, /<details/); assert.match(html, /Poison/); assert.match(html, /Energy/); assert.match(html, /Radiation/); assert.match(html, /Generic/);
  assert.match(html, /Incoming commander damage/); assert.match(html, /Bob · Norin/); assert.match(html, />7</);
  assert.doesNotMatch(html, /<script|<button|<input|data-join|data-result|roomCode|connectionId/);
});

test('live Table overview shows every player life and state before the detailed cards', () => {
  const table = liveTable();
  table.seats = Array.from({ length: 8 }, (_, index) => ({ ...table.seats[index % 2], seatNumber: index + 1,
    alias: index === 0 ? '<Alice>' : `Player ${index + 1}`, counters: { life: 40 - index }, eliminated: index === 7 }));
  const html = spectator.spectatorTableHtml(table);
  const detailsStart = html.indexOf('data-watch-seat="1"');
  assert.ok(detailsStart > 0);
  const overview = html.slice(0, detailsStart);
  for (let seat = 1; seat <= 8; seat++) {
    assert.match(overview, new RegExp(`data-watch-summary-seat="${seat}"`));
    assert.match(overview, new RegExp(`>${41 - seat}</strong>`));
  }
  assert.match(overview, /&lt;Alice&gt;/); assert.match(overview, /Active turn/); assert.match(overview, /Eliminated/);
  assert.doesNotMatch(overview, /<input|<button|<Alice>/);
});

test('live Table clock uses server elapsed values, distinguishes tracking off and stops at completion or pause', () => {
  assert.equal(typeof spectator.spectatorTableClockText, 'function');
  const table = liveTable();
  const text = spectator.spectatorTableClockText(table, 66000);
  assert.match(text, /Game elapsed 1:05/); assert.match(text, /Turn 4/); assert.match(text, /0:14/);
  assert.match(text, /<Alice>/, 'clock text is assigned through textContent');
  assert.match(spectator.spectatorTableClockText({ ...table, turn: { ...table.turn, trackingEnabled: false } }), /Turn tracking is off/);
  assert.match(spectator.spectatorTableClockText({ ...table, status: 'complete' }, 999000), /Game elapsed 1:00/);
  assert.match(spectator.spectatorTableClockText({ ...table, turn: { ...table.turn, pausedAt: 61000 } }, 999000), /0:09/);
});

test('Table states distinguish an unstarted, missing, replaced and finished game without inventing zero life totals', () => {
  assert.equal(typeof spectator.spectatorTableHtml, 'function');
  for (const [status, availabilityReason, expected] of [
    ['ready', 'not_started', /has not started/], ['unavailable', 'room_unavailable', /unavailable/],
    ['unavailable', 'replaced', /replaced/], ['complete', 'finished', /finished/], ['cancelled', 'cancelled', /cancelled/i],
  ]) {
    const html = spectator.spectatorTableHtml({ ...liveTable(), status, availabilityReason, hasLiveTotals: false, seats: [], turn: null });
    assert.match(html, expected); assert.doesNotMatch(html, /competition-watch-life|>0<|Active turn/);
  }
});

test('Table finish preview, awaiting confirmation and confirmed winner never imply provisional points', () => {
  assert.equal(typeof spectator.spectatorTableHtml, 'function');
  const table = liveTable();
  const preview = spectator.spectatorTableHtml({ ...table, pendingFinish: { winnerSeatNumber: 1, expiresAt: 90000 } });
  assert.match(preview, /Finish is pending/); assert.doesNotMatch(preview, /Confirmed winner/);
  const pending = spectator.spectatorTableHtml({ ...table, status: 'complete', resultStatus: 'awaiting_confirmation', result: { winnerSeatNumber: 1, winnerAlias: '<Alice>', reason: 'last_player' } });
  assert.match(pending, /Awaiting host confirmation/); assert.match(pending, /Reported winner/); assert.doesNotMatch(pending, /Confirmed winner|points|placing/i);
  const confirmed = spectator.spectatorTableHtml({ ...table, status: 'complete', hasLiveTotals: false, seats: [], resultStatus: 'confirmed', result: { winnerSeatNumber: 1, winnerAlias: '<Alice>', reason: 'last_player' } });
  assert.match(confirmed, /Confirmed winner/); assert.match(confirmed, /&lt;Alice&gt;/); assert.match(confirmed, /totals are no longer available/);
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
