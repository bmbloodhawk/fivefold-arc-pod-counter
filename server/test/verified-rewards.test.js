import { expireEliminationWindow } from '../test-support/expire-elimination-window.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { PRISMATIC_CONFLUENCE_SKIN_ID } from '../src/appearance-milestones.js';
import { loadPrismaticConfluenceSkin } from '../src/bundled-reward-skins.js';
import { createRealtimeServer, RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

const HOUR = 3_600_000;

async function fixture(t, appearanceSkins = []) {
  let now = Date.UTC(2026, 10, 7, 12);
  const clock = () => now;
  const store = new MemoryAccountHistoryStore();
  const ledger = new MemoryPlaytestLedger();
  const accountHistory = new AccountHistory({ store, now: clock });
  const { server, service } = createRealtimeServer({
    now: clock, connectionTtlMs: 24 * HOUR, ledger, accountHistory, appearanceSkins,
    accountVerifier: { async verify(token) {
      if (!token) throw Object.assign(new Error('Sign in'), { status: 401 });
      return { providerSubject: token };
    } },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { body, connectionId, token = 'player-a', method } = {}) {
    const response = await fetch(base + '/api/account/' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        authorization: 'Bearer ' + token,
        ...(connectionId ? { 'x-connection-id': connectionId } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  function start({ sessionKind = 'standard', gameFormat = 'commander', startingLife = 40, guestCommanderColors = [[]] } = {}) {
    now += 1000;
    const host = service.createConnection().connectionId;
    const guest = service.createConnection().connectionId;
    const made = service.createRoom(host, { playerCount: 2, startingLife, gameFormat });
    const code = made.snapshot.code;
    const join = service.claimSeat(code, guest, { seatId: 1, commanderCount: guestCommanderColors.length, commanderColors: guestCommanderColors });
    if (sessionKind !== 'standard') service.setSessionKind(code, host, { baseVersion: join.snapshot.version, sessionKind });
    const version = () => service.room(code).version;
    service.startGame(code, host, { baseVersion: version() });
    return {
      host, guest, code, made, join,
      get reference() { return { roomCode: code, gameId: service.room(code).gameId }; },
      finish(duration, winnerSeatId = 0) {
        now += duration;
        return service.declareWinner(code, host, { baseVersion: version(), winnerSeatId }).snapshot;
      },
      nextGameSetup() { return service.beginIntermission(code, host, { baseVersion: version() }); },
      startAgain() {
        service.beginIntermission(code, host, { baseVersion: version() });
        for (const owner of [host, guest]) service.setNextGameReady(code, owner, { baseVersion: version() });
        service.startGame(code, host, { baseVersion: version() });
      },
    };
  }
  const save = (game, options = {}) => request('games', { body: game.reference, connectionId: game.guest, ...options });
  const history = async (token) => (await request('history', { token })).data.history;
  return { request, start, save, history, accountHistory, store, service, ledger, clock, base };
}

const nightWatch = { id: 'skin-8d464cbe-0dd5-4010-87eb-937dcced76eb', name: 'Aurora Observatory · Night Watch' };
const nightShift = 'long-endurance-4';
const confluence = { id: PRISMATIC_CONFLUENCE_SKIN_ID, name: 'Prismatic Confluence' };

const prismaticPath = 'appearance-prismatic-confluence';
const prerequisites = ['color-wheel', 'trusted-blade', 'armory', 'ten-crowns', 'seasoned'];
const equipConfluence = { method: 'PUT', body: { personalSkinId: confluence.id, usePersonalSkin: true } };

async function prismaticChoice(f, token) {
  const { status, data } = await f.request('preferences', { token });
  assert.equal(status, 200);
  return data.skins.find(skin => skin.id === confluence.id);
}

async function legacyAccount(f, token) {
  const id = await f.accountHistory.ensureAccount(token);
  await f.store.update('account-history/accounts/' + id + '.json', account => {
    const { prismaticRuleVersion, ...priorSchema } = account;
    return priorSchema;
  });
  return id;
}

async function shareConfluence(f, game, token) {
  return fetch(f.base + '/api/rooms/' + game.code + '/table-skin', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'x-connection-id': game.host, 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersion: f.service.room(game.code).version, tableSkinId: confluence.id }),
  });
}

test('the fifth earned achievement awards Prismatic Confluence once, even when the final save is retried', async t => {
  const f = await fixture(t, [await loadPrismaticConfluenceSkin(), nightWatch]);
  const skinUrl = f.base + '/api/game-skins/' + confluence.id;
  const headers = { authorization: 'Bearer player-a' };
  const publicSkins = await (await fetch(f.base + '/api/game-skins')).json();
  assert.ok(!publicSkins.skins.some(skin => skin.id === confluence.id));
  const deckIds = [];
  let finalGameId;
  for (const commanderName of ['Meren', 'Veyran', 'Yoshimaru']) {
    const created = await f.request('decks', { body: { commanderName } });
    assert.equal(created.status, 201);
    deckIds.push(created.data.deck.deckId);
  }
  for (let gameNumber = 1; gameNumber <= 25; gameNumber++) {
    const guestCommanderColors = gameNumber === 1 ? [['W', 'U'], ['B', 'R']] : [['G']];
    const game = f.start({ guestCommanderColors });
    game.finish(HOUR / 2, gameNumber <= 10 ? 1 : 0);
    const deckId = deckIds[gameNumber - 1] ?? deckIds[0];
    const save = () => f.save(game, { body: { ...game.reference, deckId } });
    if (gameNumber < 25) {
      const result = await save();
      assert.equal(result.status, 201);
      assert.ok(!result.data.unlockedAchievements.some(award => award.id === prismaticPath || award.unlockedSkinName === confluence.name));
      if (gameNumber === 2) {
        assert.ok(result.data.unlockedAchievements.some(award => award.id === 'color-wheel'));
        assert.equal((await fetch(skinUrl, { headers })).status, 404);
        assert.equal((await f.request('preferences', equipConfluence)).status, 403);
        assert.equal((await shareConfluence(f, game, 'player-a')).status, 403);
      }
      if (gameNumber === 24) {
        const choice = await prismaticChoice(f);
        assert.equal(choice.state, 'locked');
        assert.deepEqual(choice.progress.filter(item => !item.earned).map(item => item.id), ['seasoned']);
      }
      continue;
    }
    const retries = await Promise.all([save(), save(), save()]);
    assert.ok(retries.every(result => result.status === 201));
    finalGameId = retries[0].data.game.gameId;
    const awards = retries.flatMap(result => result.data.unlockedAchievements);
    assert.ok(awards.some(award => award.id === 'seasoned'));
    assert.deepEqual(awards.filter(award => award.unlockedSkinName === confluence.name)
      .map(award => [award.id, award.title, award.rarity]), [[prismaticPath, 'The Prismatic Path', 'legendary']]);
    assert.deepEqual((await save()).data.unlockedAchievements, []);
  }
  assert.equal((await prismaticChoice(f)).state, 'new');
  assert.equal((await f.request('preferences', equipConfluence)).status, 200);
  assert.ok((await prismaticChoice(f)).progress.every(item => item.earned));
  assert.equal((await f.history()).achievements.filter(award => award.id === prismaticPath).length, 1);
  assert.equal((await f.request('achievements/viewed', { body: { rarity: 'legendary' } })).status, 200);
  assert.equal((await prismaticChoice(f)).state, 'unlocked');

  const response = await fetch(skinUrl, { headers });
  assert.equal(response.status, 200);
  const { skin } = await response.json();
  assert.equal(skin.name, confluence.name);
  assert.equal(skin.commanderTreatment, 'prismatic-glass');
  assert.equal(skin.achievement.id, prismaticPath);
  assert.match(skin.backgroundData, /^data:image\/webp;base64,/);
  const modes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
  const images = new Set();
  for (const mode of modes) {
    assert.equal(skin.counterDesign.modes[mode].icon, 'configured', mode);
    assert.equal(skin.counterDesign.modes[mode].uprightCenter, true, mode);
    for (const [role, data] of [['tab', skin.symbolData[mode]], ['seal', skin.counterArtData[mode]]]) {
      const file = `${role}-${mode}.webp`;
      const bytes = await readFile(new URL('../static-data/prismatic-confluence/' + file, import.meta.url));
      assert.ok(data === 'data:image/webp;base64,' + bytes.toString('base64'), file + ' is hydrated in its own renderer slot');
      images.add(data);
    }
  }
  assert.equal(images.size, 12, 'Each counter has its own symbol and face');
  assert.ok(!Object.keys(skin).some(key => key.startsWith('preview')));
  assert.equal((await nightWatchChoice(f)).state, 'locked');
  const room = f.start();
  assert.equal((await shareConfluence(f, room, 'player-a')).status, 200);
  const shared = await fetch(f.base + '/api/rooms/' + room.code + '/table-skin', { headers: { 'x-connection-id': room.guest } });
  assert.equal(shared.status, 200);
  assert.equal((await shared.json()).skin.id, confluence.id);
  assert.equal((await fetch(skinUrl, { headers: { authorization: 'Bearer different-account' } })).status, 404);
  assert.equal((await f.request('preferences', { ...equipConfluence, token: 'different-account' })).status, 403);
  assert.equal((await shareConfluence(f, f.start(), 'different-account')).status, 403);
  assert.equal((await f.request('games/' + finalGameId, { method: 'DELETE' })).status, 204);
  assert.equal((await prismaticChoice(f)).state, 'unlocked');
  assert.ok((await f.history()).achievements.some(award => award.id === prismaticPath));
});

test('each of the five achievements is required and the collection reports the missing one', async t => {
  const f = await fixture(t, [confluence]);
  for (const missing of prerequisites) {
    const token = 'missing-' + missing;
    const game = f.start({ guestCommanderColors: missing === 'color-wheel' ? [[]] : [['W', 'U', 'B', 'R', 'G']] });
    game.finish(HOUR);
    assert.equal((await f.save(game, { token })).status, 201);
    const id = await f.accountHistory.ensureAccount(token);
    await f.store.update('account-history/verified-progress/' + id + '.json', progress => {
      const awards = { ...progress.awards };
      for (const key of prerequisites.filter(key => key !== missing && key !== 'color-wheel')) awards[key] = { historical: true };
      return { ...progress, awards };
    });
    const choice = await prismaticChoice(f, token);
    assert.deepEqual([choice.achievement.id, choice.state], [prismaticPath, 'locked']);
    assert.deepEqual(choice.progress.map(item => item.id), prerequisites);
    assert.deepEqual(choice.progress.filter(item => !item.earned).map(item => item.id), [missing]);
    assert.ok(choice.progress.every(item => item.title && item.detail && typeof item.earned === 'boolean'));
    assert.equal((await f.request('preferences', { ...equipConfluence, token })).status, 403);
  }
});

test('deleting a new Color Wheel result retains that achievement without granting the five-achievement skin', async t => {
  const f = await fixture(t, [confluence]);
  const game = f.start({ guestCommanderColors: [['W', 'U', 'B', 'R', 'G']] });
  game.finish(HOUR);
  const saved = await f.save(game);
  assert.ok(saved.data.unlockedAchievements.some(a => a.id === 'color-wheel'));
  assert.equal((await f.request('games/' + saved.data.game.gameId, { method: 'DELETE' })).status, 204);
  assert.ok((await f.history()).achievements.some(a => a.id === 'color-wheel'));
  const choice = await prismaticChoice(f);
  assert.equal(choice.state, 'locked');
  assert.deepEqual(choice.progress.filter(item => item.earned).map(item => item.id), ['color-wheel']);
  assert.equal((await f.request('preferences', equipConfluence)).status, 403);
});

test('deleting an incomplete historical award source grants neither Color Wheel nor its old skin', async t => {
  const f = await fixture(t, [confluence]);
  for (const format of ['legacy', 'verified']) {
    const token = 'incomplete-' + format;
    const id = await legacyAccount(f, token);
    const game = { gameId: 'game_incomplete', sourceGameId: 'old-record', savedAt: f.clock(), tableSize: 4 };
    const awards = Object.fromEntries(prerequisites.map(key => [key, key === 'color-wheel' ? { gameId: game.gameId } : { historical: true }]));
    await f.store.write('account-history/verified-progress/' + id + '.json', {
      awards, games: format === 'verified' ? { source: game } : {},
    });
    if (format === 'legacy') await f.store.write('account-history/games/' + id + '.json', { [game.gameId]: game });
    assert.equal((await prismaticChoice(f, token)).state, 'locked');
    assert.equal((await f.request('games/' + game.gameId, { method: 'DELETE', token })).status, 204);
    const choice = await prismaticChoice(f, token);
    assert.equal(choice.state, 'locked');
    assert.equal(choice.progress.find(item => item.id === 'color-wheel').earned, false);
    assert.ok(!(await f.history(token)).achievements.some(item => item.id === prismaticPath));
  }
});

test('verified old awards satisfy the path on the first collection read and stay visible in the profile', async t => {
  const f = await fixture(t, [confluence]);
  const id = await f.accountHistory.ensureAccount('recorded');
  const evidence = [{ historical: true }, { gameId: 'game_archived', earnedAt: f.clock(), ruleVersion: 1 }, { evidenceRemoved: true }];
  await f.store.write('account-history/verified-progress/' + id + '.json', {
    awards: Object.fromEntries(prerequisites.map((key, i) => [key, evidence[i % evidence.length]])),
  });
  const choice = await prismaticChoice(f, 'recorded');
  assert.equal(choice.state, 'new');
  assert.ok(choice.progress.every(item => item.earned));
  const history = await f.history('recorded');
  assert.equal(history.gamesPlayed, 0);
  assert.equal(history.achievements.filter(a => a.id === prismaticPath).length, 1);
  assert.equal((await f.request('preferences', { ...equipConfluence, token: 'recorded' })).status, 200);
  assert.equal((await f.request('achievements/viewed', { token: 'recorded', body: { rarity: 'legendary' } })).status, 200);
  assert.equal((await prismaticChoice(f, 'recorded')).state, 'unlocked');
});

test('old Color Wheel ownership and explicit skin grants continue working without awarding a new path', async t => {
  const f = await fixture(t, [confluence]);
  for (const [token, award] of [
    ['old-verified', { gameId: 'game_old', earnedAt: f.clock(), ruleVersion: 1 }],
    ['old-historical', { historical: true }],
    ['old-removed', { evidenceRemoved: true }],
  ]) {
    const id = await legacyAccount(f, token);
    await f.store.write('account-history/verified-progress/' + id + '.json', { awards: { 'color-wheel': award } });
  }
  for (const token of ['old-deck-earner', 'old-unplayed-deck']) {
    const id = await legacyAccount(f, token);
    await f.store.write('account-history/decks/' + id + '.json', {
      a: { deckId: 'a', colors: ['W', 'U', 'B', 'R'] }, b: { deckId: 'b', colors: ['G'] },
    });
    const played = token === 'old-deck-earner' ? ['a', 'b'] : ['a'];
    await f.store.write('account-history/games/' + id + '.json', Object.fromEntries(
      played.map(deckId => [deckId, { deckId, gameId: deckId, savedAt: f.clock() }])
    ));
  }
  const grant = await f.accountHistory.ensureAccount('granted');
  await f.accountHistory.grantSkin(grant, confluence.id);
  const unearned = await f.accountHistory.ensureAccount('stale-preference');
  await f.store.update('account-history/accounts/' + unearned + '.json', account => ({
    ...account, seenAchievementIds: ['color-wheel', prismaticPath], preferences: { personalSkinId: confluence.id, usePersonalSkin: true },
  }));
  for (const [token, owns] of [
    ['old-verified', true], ['old-historical', true], ['old-removed', true], ['old-deck-earner', true],
    ['granted', true], ['old-unplayed-deck', false], ['stale-preference', false], ['different-account', false],
  ]) {
    const choice = await prismaticChoice(f, token);
    assert.equal(choice.state, owns ? 'unlocked' : 'locked', token);
    assert.equal((await f.request('preferences', { ...equipConfluence, token })).status, owns ? 200 : 403, token);
    assert.ok(!(await f.history(token)).achievements.some(a => a.id === prismaticPath), token);
  }
});


test('an existing skin owner earns the Path badge later without a duplicate skin notification', async t => {
  const f = await fixture(t, [confluence]);
  for (const token of ['grandfather-owner', 'granted-owner']) {
    const id = token === 'grandfather-owner' ? await legacyAccount(f, token) : await f.accountHistory.ensureAccount(token);
    if (token === 'granted-owner') await f.accountHistory.grantSkin(id, confluence.id);
    await f.store.write('account-history/verified-progress/' + id + '.json', {
      awards: Object.fromEntries(prerequisites.filter(key => key !== 'seasoned').map(key => [key, { historical: true }])),
    });
    await f.store.write('account-history/games/' + id + '.json', Object.fromEntries(Array.from({ length: 24 }, (_, i) => {
      const gameId = 'game_' + i;
      return [gameId, { gameId, tableSize: 4, savedAt: f.clock() + i }];
    })));
    assert.equal((await prismaticChoice(f, token)).state, 'unlocked');
    const game = f.start();
    game.finish(HOUR);
    const result = await f.save(game, { token });
    assert.ok(result.data.unlockedAchievements.some(a => a.id === 'seasoned'));
    assert.ok(result.data.unlockedAchievements.some(a => a.id === prismaticPath));
    assert.ok(!result.data.unlockedAchievements.some(a => a.unlockedSkinName === confluence.name));
    assert.equal((await prismaticChoice(f, token)).state, 'unlocked');
    assert.equal((await f.history(token)).achievements.find(a => a.id === prismaticPath).isNew, true);
    assert.deepEqual((await f.save(game, { token })).data.unlockedAchievements, []);
  }
});

test('pre-ledger games retroactively complete the five-achievement path without requiring another save', async t => {
  const f = await fixture(t, [confluence]);
  const token = 'legacy-full-path';
  const id = await legacyAccount(f, token);
  const decks = { a: ['W', 'U', 'B'], b: ['R'], c: ['G'] };
  await f.store.write('account-history/decks/' + id + '.json', Object.fromEntries(
    Object.entries(decks).map(([deckId, colors]) => [deckId, { deckId, colors }])
  ));
  const games = Array.from({ length: 25 }, (_, i) => {
    const gameId = 'old_' + i;
    const deckId = i < 2 ? ['b', 'c'][i] : 'a';
    return [gameId, { gameId, deckId, won: i < 10, tableSize: 4, savedAt: f.clock() + i }];
  });
  await f.store.write('account-history/games/' + id + '.json', Object.fromEntries(games));
  assert.equal((await prismaticChoice(f, token)).state, 'unlocked');
  assert.equal((await f.history(token)).gamesPlayed, 25);
  assert.ok((await f.history(token)).achievements.some(a => a.id === prismaticPath));
  assert.equal((await f.request('preferences', { ...equipConfluence, token })).status, 200);
});

test('an old account that first earns Color Wheel under the new rule stays on the new path', async t => {
  const f = await fixture(t, [confluence]);
  const token = 'old-account-new-earner';
  await legacyAccount(f, token);
  const game = f.start({ guestCommanderColors: [['W', 'U', 'B', 'R', 'G']] });
  game.finish(HOUR);
  const saved = await f.save(game, { token });
  assert.ok(saved.data.unlockedAchievements.some(a => a.id === 'color-wheel'));
  assert.equal((await prismaticChoice(f, token)).state, 'locked');
  assert.equal((await f.request('games/' + saved.data.game.gameId, { method: 'DELETE', token })).status, 204);
  assert.equal((await prismaticChoice(f, token)).state, 'locked');
});

async function nightWatchChoice(f, token) {
  const { status, data } = await f.request('preferences', { token });
  assert.equal(status, 200);
  const choice = data.skins?.find(skin => skin.id === nightWatch.id);
  assert.equal(choice?.achievement.id, nightShift);
  return choice;
}

test('Night Watch unlocks on the verified Night Shift award and announces it once', async t => {
  const f = await fixture(t, [nightWatch]);
  const equip = { personalSkinId: nightWatch.id, usePersonalSkin: true };
  const game = f.start({ gameFormat: 'custom' });
  for (let count = 1; count <= 20; count++) {
    game.finish(count === 20 ? HOUR - 1 : HOUR);
    const saved = await f.save(game);
    assert.equal(saved.status, 201);
    assert.ok(!saved.data.unlockedAchievements.some(award => award.id === nightShift));
    game.startAgain();
  }
  assert.equal((await nightWatchChoice(f)).state, 'locked');
  assert.equal((await f.request('preferences', { method: 'PUT', body: equip })).status, 403);

  game.finish(HOUR);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.data.unlockedAchievements.filter(award => award.unlockedSkinName)
    .map(award => [award.id, award.title, award.unlockedSkinName]), [[nightShift, 'Night Shift', nightWatch.name]]);
  assert.deepEqual((await f.save(game)).data.unlockedAchievements, []);
  assert.equal((await nightWatchChoice(f)).state, 'new');
  assert.equal((await f.history()).achievements.filter(award => award.id === nightShift).length, 1);
  assert.equal((await f.request('achievements/viewed', { body: { rarity: 'rare' } })).status, 200);
  assert.equal((await nightWatchChoice(f)).state, 'unlocked');
  assert.equal((await f.request('preferences', { method: 'PUT', body: equip })).status, 200);
  assert.equal((await nightWatchChoice(f, 'another-player')).state, 'locked');
});

test('Night Watch is usable on the first collection read for both historical Night Shift record formats', async t => {
  const f = await fixture(t, [nightWatch]);
  const legacy = await f.accountHistory.ensureAccount('legacy-earner');
  const legacyPath = 'account-history/accounts/' + legacy + '.json';
  await f.store.update(legacyPath, account => ({
    ...account, longTermAchievementIds: [nightShift], seenAchievementIds: [nightShift],
  }));
  const modern = await f.accountHistory.ensureAccount('verified-earner');
  await f.store.write('account-history/verified-progress/' + modern + '.json', {
    awards: { [nightShift]: { evidenceRemoved: true } },
  });
  for (const [token, state] of [['legacy-earner', 'unlocked'], ['verified-earner', 'new']]) {
    assert.equal((await nightWatchChoice(f, token)).state, state);
    assert.equal((await f.history(token)).gamesPlayed, 0);
    const equipped = await f.request('preferences', {
      token, method: 'PUT', body: { personalSkinId: nightWatch.id, usePersonalSkin: true },
    });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.data.preferences.personalSkinId, nightWatch.id);
    assert.equal((await nightWatchChoice(f, token)).state, state);
  }
});

test('only the server-recorded completed seat can create profile progression', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  const originalReference = game.reference;
  assert.equal((await f.save(game)).status, 409);
  game.finish(45 * 60_000);
  const proofless = await f.request('games', { body: { tableSize: 8, won: true, achievementFacts: { durationMs: HOUR } } });
  assert.ok(proofless.status >= 400);
  const forged = await f.save(game, { body: { ...originalReference, achievementFacts: { durationMs: HOUR }, won: true } });
  assert.equal(forged.status, 400);
  const outside = f.service.createConnection().connectionId;
  assert.equal((await f.save(game, { connectionId: outside })).status, 403);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.equal(saved.data.game.achievementFacts.durationMs, 45 * 60_000);
  assert.equal(saved.data.game.won, false);
  assert.ok(saved.data.unlockedAchievements.some(award => award.id === 'first-chronicle'));
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'settling-in'));
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'flash-victory'));
  assert.equal((await f.history()).gamesPlayed, 1);
  assert.ok(!JSON.stringify(await f.history()).includes(game.code));
});

test('a short Commander game earns Flash Victory when turns were recorded', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  f.service.handoffTurn(game.code, game.host, { baseVersion: f.service.room(game.code).version });
  game.finish(15 * 60_000);
  const saved = await f.save(game);
  assert.equal(saved.data.game.achievementFacts.handoffCount, 1);
  assert.ok(saved.data.unlockedAchievements.some(award => award.id === 'flash-victory'));
});

test('exactly an hour still qualifies after next-game setup and retries never release twice', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  game.nextGameSetup();
  const attempts = await Promise.all([f.save(game), f.save(game), f.save(game)]);
  assert.ok(attempts.every(save => save.status === 201));
  assert.equal(new Set(attempts.map(save => save.data.game.gameId)).size, 1);
  assert.equal(attempts.flatMap(save => save.data.unlockedAchievements).filter(award => award.id === 'settling-in').length, 1);
  assert.equal((await f.history()).gamesPlayed, 1);
  assert.equal((await f.save(game, { token: 'player-b' })).status, 409);
  assert.equal((await f.history('player-b')).gamesPlayed, 0);
  const winner = await f.save(game, { token: 'player-b', connectionId: game.host });
  assert.equal(winner.status, 201);
  assert.equal(winner.data.game.won, true);
});

test('a retry finishes an interrupted save without exposing a partial award', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const update = f.store.update.bind(f.store);
  let failOnce = true;
  f.store.update = async (path, change) => {
    if (failOnce && path.includes('/verified-progress/')) {
      failOnce = false;
      throw Object.assign(new Error('Simulated interrupted write'), { status: 503 });
    }
    return update(path, change);
  };
  assert.equal((await f.save(game)).status, 503);
  assert.equal((await f.history()).gamesPlayed, 0);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.ok(saved.data.unlockedAchievements.some(award => award.id === 'settling-in'));
  assert.deepEqual((await f.save(game)).data.unlockedAchievements, []);
  assert.equal((await f.history()).gamesPlayed, 1);
});

test('deleting a saved game preserves awards but cannot restart its progression', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.equal((await f.request('games/' + saved.data.game.gameId, { method: 'DELETE' })).status, 204);
  const profile = await f.history();
  assert.equal(profile.gamesPlayed, 0);
  assert.ok(profile.achievements.some(award => award.id === 'settling-in'));
  assert.equal((await f.save(game)).status, 409);
});

test('one account receives credit for a game once even when two of its devices own seats', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const connections = [game.guest, game.host];
  const competing = await Promise.all(connections.map(connectionId => f.save(game, { connectionId })));
  assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
  assert.equal((await f.history()).gamesPlayed, 1);
  const otherConnection = connections[competing.findIndex(result => result.status === 409)];
  assert.equal((await f.save(game, { connectionId: otherConnection, token: 'player-b' })).status, 201);
});

test('a new profile at a shared seat starts its own verified table count', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  for (let count = 1; count <= 4; count++) {
    game.finish(30 * 60_000);
    assert.equal((await f.save(game)).status, 201);
    game.startAgain();
  }
  game.finish(30 * 60_000);
  const newcomer = await f.save(game, { token: 'player-b' });
  assert.equal(newcomer.status, 201);
  assert.equal(newcomer.data.game.achievementFacts.tableGameNumber, 1);
  assert.ok(!newcomer.data.unlockedAchievements.some(award => award.id === 'one-more-before-bed'));
  assert.notEqual(newcomer.data.game.accoladeId, 'familiar-seats');
  game.startAgain();
  game.finish(30 * 60_000);
  const regular = await f.save(game);
  assert.equal(regular.data.game.achievementFacts.tableGameNumber, 5);
  assert.ok(regular.data.unlockedAchievements.some(award => award.id === 'one-more-before-bed'));
});

test('development games do not grant progress even through manual saves', async (t) => {
  const f = await fixture(t);
  const practice = f.start({ sessionKind: 'development' });
  practice.finish(HOUR);
  assert.equal((await f.save(practice)).status, 409);
  assert.equal((await f.history()).gamesPlayed, 0);
});

test('concurrent distinct completed games both persist for the same account', async (t) => {
  const f = await fixture(t);
  const first = f.start();
  first.finish(HOUR - 1);
  const second = f.start();
  second.finish(HOUR + 1);
  const results = await Promise.all([f.save(first), f.save(second)]);
  assert.ok(results.every(save => save.status === 201));
  assert.equal(results.flatMap(save => save.data.unlockedAchievements).filter(award => award.id === 'settling-in').length, 1);
  const profile = await f.history();
  assert.equal(profile.gamesPlayed, 2);
  assert.deepEqual(profile.games.map(game => game.achievementFacts.durationMs).sort((a, b) => a - b), [HOUR - 1, HOUR + 1]);
});

test('older progress is preserved and a deferred Endurance tier waits for a qualifying new game', async (t) => {
  const f = await fixture(t);
  const id = await f.accountHistory.ensureAccount('player-a');
  const accountPath = 'account-history/accounts/' + id + '.json';
  const gamesPath = 'account-history/games/' + id + '.json';
  const previous = await f.store.read(accountPath);
  await f.store.write(accountPath, { ...previous, longTermAchievementIds: ['long-endurance-1'] });
  await f.store.write(gamesPath, Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    'game_old-' + index,
    { gameId: 'game_old-' + index, savedAt: index, tableSize: 2, won: false, achievementFacts: { durationMs: HOUR } },
  ])));
  const short = f.start();
  short.finish(45 * 60_000);
  assert.equal((await f.save(short)).status, 201);
  let profile = await f.history();
  assert.equal(profile.gamesPlayed, 6);
  assert.ok(profile.achievements.some(award => award.id === 'table-regular'));
  assert.ok(profile.achievements.some(award => award.id === 'long-endurance-1'));
  assert.ok(!profile.achievements.some(award => award.id === 'long-endurance-2'));
  const qualifying = f.start();
  qualifying.finish(HOUR);
  assert.equal((await f.save(qualifying)).status, 201);
  profile = await f.history();
  assert.ok(profile.achievements.some(award => award.id === 'long-endurance-2'));
});

test('a resumed room deduplicates accepted play and keeps its finished evidence through another restore', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  const action = { counter: 'energy', delta: 10, operationId: 'synthetic-applied-energy-op' };
  f.service.adjustOwnSeat(game.code, game.guest, action);

  async function restore() {
    const service = new RoomService({ now: f.clock, ledger: f.ledger });
    await service.restoreRoom(game.code, game.made.hostRecoveryKey);
    const host = service.createConnection().connectionId;
    const guest = service.createConnection().connectionId;
    service.claimSeat(game.code, host, { seatId: 0, reclaimToken: game.made.reclaimToken });
    service.claimSeat(game.code, guest, { seatId: 1, reclaimToken: game.join.reclaimToken });
    return { service, host, guest };
  }

  const resumed = await restore();
  const repeated = resumed.service.adjustOwnSeat(game.code, resumed.guest, action);
  assert.equal(repeated.deduplicated, true);
  assert.equal(repeated.snapshot.seats[1].counters.energy, 10);
  resumed.service.declareWinner(game.code, resumed.host, {
    baseVersion: resumed.service.room(game.code).version, winnerSeatId: 0,
  });

  const restarted = await restore();
  const completion = restarted.service.completedSeat(game.code, restarted.guest, game.reference.gameId);
  const id = await f.accountHistory.ensureAccount('restarted-profile');
  const saved = await f.accountHistory.saveCompletedGame(id, completion);
  assert.equal(saved.game.counterTotals.energy, 10);
  assert.ok(!saved.unlockedAchievements.some(award => award.id === 'capacitor-discharge'));
});

test('a replacement at the same seat cannot save the previous player’s completed result', async (t) => {
  const f = await fixture(t);
  const game = f.start();
  game.finish(HOUR);
  const reference = game.reference;
  game.nextGameSetup();
  f.service.leaveIntermission(game.code, game.guest, { baseVersion: f.service.room(game.code).version });
  const replacement = f.service.createConnection().connectionId;
  f.service.claimSeat(game.code, replacement, { seatId: 1 });
  const save = await f.save(game, { connectionId: replacement, body: reference, token: 'replacement' });
  assert.equal(save.status, 403);
  assert.equal((await f.history('replacement')).gamesPlayed, 0);
});

test('a custom starting value of five life is not a tracked close call', async (t) => {
  const f = await fixture(t);
  const game = f.start({ gameFormat: 'custom', startingLife: 5 });
  game.finish(30 * 60_000);
  const saved = await f.save(game, { connectionId: game.host });
  assert.equal(saved.status, 201);
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'last-breath' || award.id === 'hanging-by-a-thread'));
  assert.equal(saved.data.game.achievementFacts.lowestLife, undefined);
  assert.equal(saved.data.moment.kind, 'accolade');
  assert.doesNotMatch(saved.data.moment.fact, /Lowest (recorded )?life:/);
});

test('a completed loss at negative life is saved, and custom games never award Commander turn milestones', async (t) => {
  const f = await fixture(t);
  const game = f.start({ gameFormat: 'custom' });
  f.service.adjustOwnSeat(game.code, game.guest, { counter: 'life', delta: -41 });
  assert.equal(f.service.room(game.code).gameResult, null);
  expireEliminationWindow(f.service, game.code);
  const saved = await f.save(game);
  assert.equal(saved.status, 201);
  assert.equal(saved.data.game.achievementFacts.lowestLife, -1);
  assert.ok(!saved.data.unlockedAchievements.some(award => award.id === 'flash-victory'));
});
