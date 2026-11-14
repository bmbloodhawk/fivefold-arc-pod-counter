import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { APPEARANCE_ACHIEVEMENTS } from '../src/appearance-milestones.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const ids = Object.values(APPEARANCE_ACHIEVEMENTS).map(award => award.id);
const RUN = 'legacy-commander-v1';
const DAY = 86_400_000;
const START = Date.UTC(2026, 7, 1, 12);
const path = (kind, accountId) => `account-history/${kind}/${accountId}.json`;

async function fixture(count, { verified = 0, progress = true } = {}) {
  let serial = 0;
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({ store, now: () => START + 130 * DAY, createId: () => String(++serial) });
  const accountId = await history.ensureAccount('history-recovery-player');
  const legacy = {};
  const proofs = [];
  for (let i = 0; i < count; i++) {
    const completedAt = START + i * DAY;
    const gameId = `game_legacy-${i}`;
    const sourceGameId = `ABC123:${completedAt}:0`;
    const won = i < 10;
    legacy[gameId] = {
      gameId, sourceGameId, savedAt: completedAt + 1000, tableSize: 4, won,
      commanderName: 'Historical Commander', deckId: 'deck_fixture',
      counterTotals: { poison: 1, energy: 2, radiation: 3, commanderDamage: 4 },
      achievementFacts: { tableGameNumber: i + 1, lowestLife: 3 },
    };
    proofs.push({
      sourceGameId, gameId: `archived${String(i).padStart(8, '0')}`, completedAt, seatId: 0,
      gameFormat: 'commander', sessionKind: 'standard', winnerSeatId: won ? 0 : 1, tableSize: 4,
      achievementFacts: { tableGameNumber: i + 1, lowestLife: 3 },
    });
  }
  const games = {};
  for (let i = 0; i < verified; i++) {
    games[hash(`verified${String(i).padStart(8, '0')}`)] = {
      gameId: `game_verified-${i}`, savedAt: START + (count + i) * DAY + 1000,
      completedAt: START + (count + i) * DAY, completionVerified: true, gameFormat: 'commander',
      tableSize: 4, won: false, achievementFacts: { tableGameNumber: i + 1, lowestLife: 20 },
      counterTotals: { poison: 1, energy: 2, radiation: 3, commanderDamage: 4 },
    };
  }
  await store.write(path('games', accountId), legacy);
  await store.write(path('decks', accountId), {
    deck_fixture: { deckId: 'deck_fixture', commanderName: 'Historical Commander', colors: ['G'] },
  });
  if (progress) await store.write(path('verified-progress', accountId), {
    games, awards: { 'first-chronicle': { historical: true } }, legacyColors: ['G'],
  });
  const recover = changes => history.recoverAppearanceHistory(accountId, {
    completionProofs: proofs, appearanceAchievementIds: ids, runId: RUN, ...changes,
  });
  return { store, history, accountId, legacy, proofs, recover };
}

function completion(number = 0) {
  return {
    sessionKind: 'standard', gameId: `newgame_${String(number).padStart(8, '0')}`, seatId: 0,
    tableIdentity: `new-table-${number}`, startedAt: START + (110 + number) * DAY,
    completedAt: START + (110 + number) * DAY + 3_600_000, moments: [],
    game: {
      gameFormat: 'commander', tableSize: 4, won: true, playedColors: [],
      achievementFacts: { lowestLife: 3 },
      counterTotals: { poison: 0, energy: 0, radiation: 0, commanderDamage: 0 },
    },
  };
}

test('a dry-run finds three earned skins in 46 historical plus six verified Commander games without writing', async () => {
  const f = await fixture(46, { verified: 6 });
  const before = structuredClone([...f.store.values]);
  const report = await f.recover();
  assert.equal(report.accountId, f.accountId);
  assert.equal(report.runId, RUN);
  assert.equal(report.recoveredGames, 46);
  assert.equal(report.qualifyingGames, 52);
  assert.deepEqual(report.newAchievementIds, ids.slice(0, 3));
  assert.equal(report.applied, false);
  assert.deepEqual([...f.store.values], before);
});

test('applying restores earned skins without adding duplicate games, wins or counters to profile history', async () => {
  const f = await fixture(46, { verified: 6 });
  const before = await f.history.summary(f.accountId);
  const report = await f.recover({ apply: true });
  assert.equal(report.applied, true);
  const after = await f.history.summary(f.accountId);
  assert.equal(after.gamesPlayed, before.gamesPlayed);
  assert.equal(after.wins, before.wins);
  assert.deepEqual(after.counterTotals, before.counterTotals);
  assert.deepEqual(after.games, before.games);
  assert.ok(ids.slice(0, 3).every(id => after.achievements.some(award => award.id === id)));
  const access = await f.history.earnedSkinAwards(f.accountId, ids);
  assert.deepEqual(Object.keys(access), ids.slice(0, 3));
  const progress = await f.store.read(path('verified-progress', f.accountId));
  assert.equal(Object.keys(progress.appearanceRecovery.games).length, 46);
  for (const id of ids.slice(0, 3)) assert.equal(progress.awards[id].recoveryRunId, RUN);
  assert.deepEqual(progress.awards['first-chronicle'], { historical: true });
});

test('casual, practice, missing, mismatched and impossible proofs do not become Commander credit', async () => {
  const f = await fixture(15);
  f.proofs[9].gameFormat = 'casual';
  f.proofs[10].sessionKind = 'practice';
  f.proofs[11].completedAt += 1;
  f.proofs[12].winnerSeatId = 0; // The saved record was a loss.
  f.proofs[13].seatId = 9;
  f.proofs.splice(14, 1); // A commander name on a saved record is not a completion proof.
  const report = await f.recover({ apply: true });
  assert.equal(report.recoveredGames, 9);
  assert.equal(report.qualifyingGames, 9);
  assert.deepEqual(report.newAchievementIds, []);
  assert.equal(report.skipped.length, 6);
  assert.ok(report.skipped.every(item => typeof item.gameId === 'string' && typeof item.reason === 'string'));
  assert.equal(await f.history.appearanceCatchUp(f.accountId), null);
  assert.deepEqual(await f.history.earnedSkinAwards(f.accountId, ids), {});
});

test('a legacy completion already in verified progress counts once and duplicate proof entries do not inflate it', async () => {
  const f = await fixture(9);
  const progress = await f.store.read(path('verified-progress', f.accountId));
  const first = f.proofs[0];
  progress.games[hash(first.gameId)] = {
    ...f.legacy['game_legacy-0'], gameId: 'game_duplicate', completionVerified: true,
    completedAt: first.completedAt, gameFormat: 'commander',
  };
  await f.store.write(path('verified-progress', f.accountId), progress);
  f.proofs.push(structuredClone(first));
  const report = await f.recover({ apply: true });
  assert.equal(report.qualifyingGames, 9);
  assert.deepEqual(report.newAchievementIds, []);
  assert.deepEqual(await f.history.earnedSkinAwards(f.accountId, ids), {});
});

test('rerunning the same repair is idempotent and preserves one notice for all restored skins', async () => {
  const f = await fixture(46, { verified: 6 });
  await f.recover({ apply: true });
  const before = structuredClone([...f.store.values]);
  const notice = await f.history.appearanceCatchUp(f.accountId);
  assert.ok(notice.id);
  assert.ok(Number.isFinite(notice.createdAt));
  assert.deepEqual(notice.achievementIds, ids.slice(0, 3));
  const replay = await f.recover({ apply: true });
  assert.deepEqual(replay.newAchievementIds, []);
  assert.deepEqual(await f.history.appearanceCatchUp(f.accountId), notice);
  assert.deepEqual([...f.store.values], before);
});

test('notice acknowledgement must match its id, persists across readers and leaves other achievement markers alone', async () => {
  const f = await fixture(20);
  await f.recover({ apply: true });
  const notice = await f.history.appearanceCatchUp(f.accountId);
  const accountBefore = structuredClone(await f.store.read(path('accounts', f.accountId)));
  try { await f.history.acknowledgeAppearanceCatchUp(f.accountId, 'another-notice'); } catch (error) {
    assert.ok(error.status === 400 || error.status === 409 || error instanceof TypeError);
  }
  assert.deepEqual(await f.history.appearanceCatchUp(f.accountId), notice);
  await f.history.acknowledgeAppearanceCatchUp(f.accountId, notice.id);
  const anotherReader = new AccountHistory({ store: f.store });
  assert.equal(await anotherReader.appearanceCatchUp(f.accountId), null);
  await anotherReader.acknowledgeAppearanceCatchUp(f.accountId, notice.id);
  await f.recover({ apply: true });
  assert.equal(await f.history.appearanceCatchUp(f.accountId), null);
  assert.deepEqual(await f.store.read(path('accounts', f.accountId)), accountBefore);
});

test('recovery initializes legacy achievements before adding a recovery ledger for an older profile', async () => {
  const f = await fixture(10, { progress: false });
  const before = await f.history.summary(f.accountId);
  assert.ok(before.achievements.length);
  await f.recover({ apply: true });
  const after = await f.history.summary(f.accountId);
  assert.ok(before.achievements.every(award => after.achievements.some(item => item.id === award.id)));
  assert.ok(after.achievements.some(award => award.id === 'appearance-field-notes'));
});

test('recovered historical games count toward the next ordinary unlock and normal saves retain one-skin pacing', async () => {
  const f = await fixture(54);
  await f.recover({ apply: true });
  const saved = await f.history.saveCompletedGame(f.accountId, completion(), 'deck_fixture', ids);
  assert.deepEqual(saved.unlockedAchievements.filter(award => award.id.startsWith('appearance-')).map(award => award.id), ['appearance-ember-vault']);
  const progress = await f.store.read(path('verified-progress', f.accountId));
  assert.equal(Object.keys(progress.games).length, 1);
  assert.equal(progress.awards['appearance-ember-vault'].recoveryRunId, undefined);
  assert.ok(progress.awards['appearance-ember-vault'].gameId);
  const repeated = await f.history.saveCompletedGame(f.accountId, completion(), 'deck_fixture', ids);
  assert.deepEqual(repeated.unlockedAchievements, []);
});

test('removing a historical result stops future threshold credit while keeping already earned skins', async () => {
  const f = await fixture(54);
  await f.recover({ apply: true });
  await f.history.removeGame(f.accountId, 'game_legacy-53');
  const saved = await f.history.saveCompletedGame(f.accountId, completion(), 'deck_fixture', ids);
  assert.equal(saved.unlockedAchievements.filter(award => award.id.startsWith('appearance-')).length, 0);
  assert.deepEqual(Object.keys(await f.history.earnedSkinAwards(f.accountId, ids)), ids.slice(0, 3));
  const progress = await f.store.read(path('verified-progress', f.accountId));
  assert.ok(!Object.values(progress.appearanceRecovery.games).some(game => game.gameId === 'game_legacy-53'));
});

test('a legacy removal tombstone protects recovery from a stale pre-deletion history read', async () => {
  const f = await fixture(10);
  const stale = structuredClone(f.legacy);
  await f.history.removeGame(f.accountId, 'game_legacy-9');
  const read = f.store.read.bind(f.store);
  f.store.read = async target => target === path('games', f.accountId) ? stale : read(target);
  const report = await f.recover({ apply: true });
  assert.equal(report.qualifyingGames, 9);
  assert.deepEqual(report.newAchievementIds, []);
});

test('closed and deleted profiles cannot be recreated by a history repair', async () => {
  for (const unavailable of ['closed', 'deleted']) {
    const f = await fixture(20);
    if (unavailable === 'closed') await f.store.write(path('verified-progress', f.accountId), { closed: true });
    else await f.store.write(path('accounts', f.accountId), null);
    const before = structuredClone([...f.store.values]);
    await assert.rejects(f.recover({ apply: true }), error => error.status === 409 && error.code === 'PROFILE_UNAVAILABLE');
    assert.deepEqual([...f.store.values], before);
    assert.equal(await f.history.appearanceCatchUp(f.accountId), null);
  }
});

test('rollback removes only this repair and retains games and ordinary awards earned afterward', async () => {
  const f = await fixture(54);
  await f.recover({ apply: true });
  const saved = await f.history.saveCompletedGame(f.accountId, completion(), 'deck_fixture', ids);
  const before = structuredClone(await f.store.read(path('verified-progress', f.accountId)));
  const accountBefore = structuredClone(await f.store.read(path('accounts', f.accountId)));
  await f.history.rollbackAppearanceRecovery(f.accountId, 'unrelated-run');
  assert.deepEqual(await f.store.read(path('verified-progress', f.accountId)), before);
  await f.history.rollbackAppearanceRecovery(f.accountId, RUN);
  const after = await f.store.read(path('verified-progress', f.accountId));
  assert.equal(after.appearanceRecovery, undefined);
  assert.equal(after.appearanceCatchUp, undefined);
  assert.deepEqual(after.games, before.games);
  assert.ok(Object.values(after.games).some(game => game.gameId === saved.game.gameId));
  assert.deepEqual(after.awards, Object.fromEntries(Object.entries(before.awards).filter(([, award]) => award.recoveryRunId !== RUN)));
  assert.deepEqual(await f.store.read(path('accounts', f.accountId)), accountBefore);
});
