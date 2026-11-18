import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

async function fixture() {
  let now = 1000;
  const store = new MemoryAccountHistoryStore(), ledger = new MemoryPlaytestLedger();
  const domain = new Competitions({ store, now: () => now++, podOwnershipEnabled: true });
  const service = new RoomService({ ledger, now: () => now++ });
  const tables = new CompetitionTables({ domain, service, ledger });
  const pod = await domain.createPod('host-account', { name: 'Returning member', displayName: 'Host' });
  const invite = await domain.invite('host-account', 'pod', pod.id);
  const joined = await domain.joinPod('member-account', invite.token, { displayName: 'Member' });
  const host = service.createConnection().connectionId, member = service.createConnection().connectionId;
  const made = service.createRoom(host, { playerCount: 2, seatCapacity: 8, startingLife: 40, name: 'Host' });
  const code = made.snapshot.code;
  const claimed = service.claimSeat(code, member, { seatId: 2, name: 'Member' });
  await tables.bind('host-account', { kind: 'pod', id: pod.id, code, connectionId: host });
  await tables.claim('member-account', { code, connectionId: member });
  const version = () => ({ baseVersion: service.room(code).version });
  const scope = () => domain.readScope('pod', pod.id);
  const stats = async participantId => (await domain.getPod('host-account', pod.id)).members.find(row => row.id === participantId);
  const start = () => tables.start(code, host, version());
  async function finishAndConfirm(requestId) {
    const gameId = service.room(code).gameId;
    service.declareWinner(code, host, { ...version(), winnerSeatId: 0, winCondition: 'other_declared' });
    await tables.reconcile('pod', pod.id);
    const game = (await scope()).games[gameId];
    await tables.confirm('host-account', 'pod', pod.id, gameId, {
      order: game.starterIds.map(id => [id]), baseRevision: 0, requestId, reasonCode: 'host_confirmation',
    });
    return gameId;
  }
  async function completeFirstGame() {
    await start();
    const gameId = await finishAndConfirm('returning_credit_first');
    assert.equal((await stats(joined.me)).gamesPlayed, 1);
    assert.equal((await stats(joined.me)).ratedGames, 1);
    const game = structuredClone((await scope()).games[gameId]);
    const source = structuredClone(await ledger.readArchivedSource(gameId));
    service.beginIntermission(code, host, version());
    return { gameId, game, source };
  }
  async function replaceWithGuest() {
    service.leaveIntermission(code, member, version());
    const replacement = service.createConnection().connectionId;
    await tables.claimRoom(code, replacement, { seatId: 2, name: 'Member' }, async () => null);
    return replacement;
  }
  function ready(replacement) {
    for (const connection of [host, replacement]) service.setNextGameReady(code, connection, { ...version(), ready: true });
  }
  return { domain, service, tables, ledger, pod, invite, host, member, claimed, code, version, scope, stats,
    hostId: pod.me, memberId: joined.me, start, finishAndConfirm, completeFirstGame, replaceWithGuest, ready };
}

test('a returning account relinks its new seat proof before the next game and retains both game credits', async () => {
  const f = await fixture();
  const original = await f.completeFirstGame();
  const replacement = await f.replaceWithGuest();

  // Account restoration reads this context before the UI decides whether to claim.
  const restored = await f.tables.context('member-account', f.code, replacement);
  assert.equal(restored.canAccess, true);
  assert.equal(restored.seatLinked, false, 'A participant ID alone cannot prove the new seat occupant is linked');
  assert.equal(restored.roster.find(row => row.seatId === 2).kind, 'guest');

  const relinked = await f.tables.claim('member-account', { code: f.code, connectionId: replacement });
  assert.equal(relinked.seatLinked, true);
  assert.equal(relinked.roster.find(row => row.seatId === 2).participantId, f.memberId);
  assert.equal(relinked.roster.find(row => row.seatId === 2).kind, 'member');
  f.ready(replacement);
  await f.start();
  const scopeAtStart = await f.scope();
  const capture = Object.values(scopeAtStart.tables)[0].captures[f.service.room(f.code).gameId];
  assert.equal(capture.eligibleIds.length, 2);
  assert.equal(capture.seats.find(row => row.seatId === '2').participantId, f.memberId);
  await f.finishAndConfirm('returning_credit_second');

  const returned = await f.stats(f.memberId);
  assert.equal(returned.gamesPlayed, 2);
  assert.equal(returned.ratedGames, 2);
  assert.deepEqual((await f.scope()).games[original.gameId], original.game);
  assert.deepEqual(await f.ledger.readArchivedSource(original.gameId), original.source);
});

test('reclaiming with the same credential keeps the existing member link without changing its stored proof', async () => {
  const f = await fixture();
  const before = await f.scope();
  const replacement = f.service.createConnection().connectionId;
  f.service.claimSeat(f.code, replacement, { seatId: 2, reclaimToken: f.claimed.reclaimToken });

  const context = await f.tables.context('member-account', f.code, replacement);
  assert.equal(context.seatLinked, true);
  assert.equal(context.roster.find(row => row.seatId === 2).participantId, f.memberId);
  assert.deepEqual(await f.scope(), before, 'Inspecting a valid reclaim must not rewrite competition evidence');
  await assert.rejects(() => f.tables.context('member-account', f.code, f.member), { status: 403 });
  await f.start();
  const capture = Object.values((await f.scope()).tables)[0].captures[f.service.room(f.code).gameId];
  assert.equal(capture.eligibleIds.length, 2);
});

test('a different account with the same display name cannot inherit the previous member link or history', async () => {
  const f = await fixture();
  const original = await f.completeFirstGame();
  const another = await f.domain.joinPod('another-account', f.invite.token, { displayName: 'Member' });
  const replacement = await f.replaceWithGuest();

  const context = await f.tables.context('another-account', f.code, replacement);
  assert.equal(context.canAccess, true);
  assert.equal(context.seatLinked, false);
  assert.equal(context.roster.find(row => row.seatId === 2).participantId, null);
  await f.tables.claim('another-account', { code: f.code, connectionId: replacement });
  f.ready(replacement);
  await f.start();
  await f.finishAndConfirm('another_member_confirmation');

  assert.equal((await f.stats(f.memberId)).gamesPlayed, 1);
  assert.equal((await f.stats(another.me)).gamesPlayed, 1);
  assert.deepEqual((await f.scope()).games[original.gameId], original.game);
  assert.deepEqual(await f.ledger.readArchivedSource(original.gameId), original.source);
});

test('signing in after a guest start cannot retroactively acquire that sealed game credit', async () => {
  const f = await fixture();
  const original = await f.completeFirstGame();
  const replacement = await f.replaceWithGuest();
  f.ready(replacement);
  await f.start();
  const guestGameId = f.service.room(f.code).gameId;
  const before = await f.scope();
  const capture = Object.values(before.tables)[0].captures[guestGameId];
  assert.equal(capture.eligibleIds.length, 1);
  assert.equal(capture.seats.find(row => row.seatId === '2').kind, 'guest');

  const restored = await f.tables.context('member-account', f.code, replacement);
  assert.equal(restored.seatLinked, false, 'A stale setup mapping must not describe a sealed guest seat as linked');
  await assert.rejects(() => f.tables.claim('member-account', { code: f.code, connectionId: replacement }), {
    status: 409, code: 'ROSTER_SEALED',
  });
  assert.deepEqual(await f.scope(), before);
  await f.finishAndConfirm('sealed_guest_confirmation');
  const completed = structuredClone((await f.scope()).games[guestGameId]);

  // Linking after completion is for a later game, not permission to rewrite this one.
  const relinked = await f.tables.claim('member-account', { code: f.code, connectionId: replacement });
  assert.equal(relinked.seatLinked, true);
  assert.equal((await f.stats(f.memberId)).gamesPlayed, 1);
  assert.deepEqual((await f.scope()).games[guestGameId], completed);
  assert.deepEqual((await f.scope()).games[original.gameId], original.game);
  assert.deepEqual(await f.ledger.readArchivedSource(original.gameId), original.source);
});
