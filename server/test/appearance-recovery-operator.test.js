import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { APPEARANCE_ACHIEVEMENTS } from '../src/appearance-milestones.js';
import { RECOVERY_RUN, repairAppearanceAccount, repairRemainingAccounts } from '../../scripts/recover-appearance-history.mjs';

const START = Date.UTC(2026, 8, 1, 12);
const HOUR = 3_600_000;
const recordPath = (kind, accountId) => `account-history/${kind}/${accountId}.json`;

async function fixture(t, accountIds = ['acct_pilot', 'acct_second', 'acct_third']) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'fivefold-appearance-operator-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(tempRoot)), resolve(tmpdir()));
    await rm(tempRoot, { recursive: true, force: true });
  });
  const store = new MemoryAccountHistoryStore();
  const diagnostics = [];
  const accounts = {};
  for (const [accountIndex, accountId] of accountIds.entries()) {
    const account = { accountId, createdAt: START - HOUR, preferences: { preferredName: 'Fixture player' } };
    accounts[accountId] = account;
    await store.write(recordPath('accounts', accountId), account);
    const games = {};
    const roomCode = `AAA${String(accountIndex).padStart(3, '0')}`;
    for (let i = 0; i < 20; i++) {
      const gameId = `arch${String(accountIndex).padStart(3, '0')}${String(i).padStart(9, '0')}`;
      const completedAt = START + (i + 1) * HOUR;
      const profileGameId = `game_history-${accountIndex}-${i}`;
      games[profileGameId] = {
        gameId: profileGameId, sourceGameId: `${roomCode}:${completedAt}:0`, savedAt: completedAt + 1000,
        tableSize: 4, won: false, achievementFacts: { lowestLife: 1, tableGameNumber: i + 1 },
      };
      diagnostics.push({
        gameId,
        recap: {
          gameId, roomCode, createdAt: START - HOUR, completedAt, incomplete: false,
          winner: { seatId: 1 }, players: [0, 1, 2, 3].map(seatId => ({ seatId })),
        },
        checkpoints: [{
          gameId, at: completedAt, recap: { gameId, roomCode, completedAt },
          snapshot: {
            gameId, code: roomCode, config: { gameFormat: 'commander' }, sessionKind: 'standard',
            gameResult: { gameId, winnerSeatId: 1, decidedAt: completedAt },
            turn: { gameStarted: true, gameStartedAt: completedAt - HOUR, startedAsDevelopment: false },
            seats: [0, 1, 2, 3].map(seatId => ({ seatId, claimed: true, counters: { life: 20 } })),
          },
        }],
      });
    }
    await store.write(recordPath('games', accountId), games);
    await store.write(recordPath('decks', accountId), {});
    await store.write(recordPath('verified-progress', accountId), {
      games: {}, awards: { 'first-chronicle': { historical: true } }, legacyColors: [],
    });
  }
  await store.write('account-history/accounts.json', accounts);
  const pilotAccountId = accountIds[0];
  const auditDir = join(tempRoot, 'audit');
  const pilot = options => repairAppearanceAccount({ store, diagnostics, accountId: pilotAccountId, auditDir, ...options });
  const remaining = options => repairRemainingAccounts({ store, diagnostics, pilotAccountId, auditDir, ...options });
  return { store, diagnostics, tempRoot, auditDir, accountIds, pilotAccountId, pilot, remaining };
}

test('operator dry-run creates neither account writes nor audit files', async t => {
  const f = await fixture(t);
  const before = structuredClone([...f.store.values]);
  const report = await f.pilot();
  assert.equal(report.applied, false);
  assert.equal(report.qualifyingGames, 20);
  assert.deepEqual(report.newAchievementIds, ['appearance-field-notes', 'appearance-rosewood']);
  assert.deepEqual([...f.store.values], before);
  assert.deepEqual(await readdir(f.tempRoot), []);
});

test('backup failure aborts the operator before any account mutation', async t => {
  const f = await fixture(t);
  const notDirectory = join(f.tempRoot, 'a-file');
  await writeFile(notDirectory, 'fixture');
  const before = structuredClone([...f.store.values]);
  await assert.rejects(f.pilot({ apply: true, auditDir: notDirectory }));
  assert.deepEqual([...f.store.values], before);
});

test('pilot backs up original records before its conditional write and verifies one unread persistent notice', async t => {
  const f = await fixture(t);
  const beforeProgress = structuredClone(await f.store.read(recordPath('verified-progress', f.pilotAccountId)));
  let sawWrite = false;
  const checkedStore = {
    read: path => f.store.read(path),
    write: (path, value) => f.store.write(path, value),
    async update(path, change) {
      const backups = (await readdir(f.auditDir)).filter(name => name.endsWith('-before.json'));
      assert.equal(backups.length, 1, 'The account backup must exist before the first mutation');
      const backup = JSON.parse(await readFile(join(f.auditDir, backups[0]), 'utf8'));
      assert.deepEqual(backup.records['verified-progress'], beforeProgress);
      sawWrite = true;
      return f.store.update(path, change);
    },
  };
  const result = await f.pilot({ store: checkedStore, apply: true });
  assert.ok(sawWrite);
  assert.equal(result.verified, true);
  assert.equal(result.accountId, f.pilotAccountId);
  assert.equal(result.runId, RECOVERY_RUN);
  assert.equal(result.availableAchievementIds.length, 2);
  const persisted = JSON.parse(await readFile(result.verificationFile, 'utf8'));
  assert.equal(persisted.verified, true);
  assert.equal(persisted.backupFile, result.backupFile);
  const history = new AccountHistory({ store: f.store });
  const notice = await history.appearanceCatchUp(f.pilotAccountId);
  assert.ok(notice.id);
  assert.equal(result.noticeId, notice.id);
  assert.deepEqual(notice.achievementIds, result.newAchievementIds);
  assert.deepEqual(await history.appearanceCatchUp(f.pilotAccountId), notice);
  const account = await f.store.read(recordPath('accounts', f.pilotAccountId));
  const backup = JSON.parse(await readFile(result.backupFile, 'utf8'));
  assert.deepEqual(account, backup.records.accounts);
  assert.deepEqual(await f.store.read(recordPath('games', f.pilotAccountId)), backup.records.games);
  assert.deepEqual(await f.store.read(recordPath('decks', f.pilotAccountId)), backup.records.decks);
});

test('all-account repair rejects missing or mismatched pilot verification before making writes', async t => {
  const f = await fixture(t);
  const before = structuredClone([...f.store.values]);
  await assert.rejects(f.remaining({ pilotVerificationFile: join(f.tempRoot, 'missing-pilot.json') }));
  for (const [index, proof] of [
    {},
    { accountId: 'acct_another', runId: RECOVERY_RUN, verified: true },
    { accountId: f.pilotAccountId, runId: 'another-run', verified: true },
    { accountId: f.pilotAccountId, runId: RECOVERY_RUN, verified: false },
    { accountId: f.pilotAccountId, runId: RECOVERY_RUN, verified: true }, // No persisted pilot marker.
  ].entries()) {
    const file = join(f.tempRoot, `pilot-proof-${index}.json`);
    await writeFile(file, JSON.stringify(proof));
    await assert.rejects(f.remaining({ pilotVerificationFile: file }));
  }
  assert.deepEqual([...f.store.values], before);
});

test('a verified pilot permits remaining accounts and reruns create no duplicate grants or unread notice', async t => {
  const f = await fixture(t);
  const pilot = await f.pilot({ apply: true });
  const first = await f.remaining({ pilotVerificationFile: pilot.verificationFile });
  assert.deepEqual(first.map(report => report.accountId).sort(), f.accountIds.slice(1).sort());
  assert.ok(first.every(report => report.verified === true && report.newAchievementIds.length === 2));
  const history = new AccountHistory({ store: f.store });
  for (const accountId of f.accountIds) {
    const notice = await history.appearanceCatchUp(accountId);
    assert.ok(notice);
    await history.acknowledgeAppearanceCatchUp(accountId, notice.id);
  }
  const beforeReplay = structuredClone([...f.store.values]);
  const replay = await f.remaining({ pilotVerificationFile: pilot.verificationFile });
  assert.ok(replay.every(report => report.verified === true && report.newAchievementIds.length === 0));
  assert.deepEqual([...f.store.values], beforeReplay);
  for (const accountId of f.accountIds) assert.equal(await history.appearanceCatchUp(accountId), null);
});

test('conditional recovery includes a concurrent ordinary save without replacing its game or award', async t => {
  const f = await fixture(t, ['acct_pilot']);
  const history = new AccountHistory({ store: f.store });
  let concurrentSave;
  let injected = false;
  const racingStore = {
    read: path => f.store.read(path),
    write: (path, value) => f.store.write(path, value),
    async update(path, change) {
      if (!injected && path === recordPath('verified-progress', f.pilotAccountId)) {
        injected = true;
        concurrentSave = await history.saveCompletedGame(f.pilotAccountId, {
          sessionKind: 'standard', gameId: 'concurrentgame00', seatId: 0, tableIdentity: 'concurrent-table',
          startedAt: START + 40 * HOUR, completedAt: START + 41 * HOUR, moments: [],
          game: {
            gameFormat: 'commander', won: true, tableSize: 4, playedColors: [],
            counterTotals: { poison: 0, energy: 0, radiation: 0, commanderDamage: 0 }, achievementFacts: { lowestLife: 3 },
          },
        }, null, Object.values(APPEARANCE_ACHIEVEMENTS).map(award => award.id));
      }
      return f.store.update(path, change);
    },
  };
  const result = await f.pilot({ store: racingStore, apply: true });
  assert.equal(result.verified, true);
  assert.equal(result.qualifyingGames, 21);
  assert.ok(concurrentSave);
  const progress = await f.store.read(recordPath('verified-progress', f.pilotAccountId));
  assert.ok(Object.values(progress.games).some(game => game.gameId === concurrentSave.game.gameId));
  for (const award of concurrentSave.unlockedAchievements) {
    assert.equal(progress.awards[award.id].gameId, concurrentSave.game.gameId);
    assert.equal(progress.awards[award.id].recoveryRunId, undefined);
  }
  assert.equal((await history.summary(f.pilotAccountId)).gamesPlayed, 21);
});
