// Run with QA_MERIDIAN_RELEASE pointing to the reviewed immutable release JSON.
// Uses only a disposable loopback server, memory accounts, and real room actions.
// No catalog/asset writes, fabricated awards, external requests, or activation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountHistory, MemoryAccountHistoryStore, studioAchievementCatalog } from '../server/src/account-history.js';
import { createRealtimeServer } from '../server/src/app.js';
import { checkedRelease } from '../server/src/studio-release-package.js';
import { materializeAppearanceSkin } from '../server/src/appearance-artwork-payload.js';

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 20, 12);
const EXPLORER = 'disposable-meridian-explorer';
const CONTROL = 'disposable-meridian-control';
const missionId = 'exploration-commission';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const imageData = value => typeof value === 'string' ? (value.startsWith('data:image/') ? [value] : [])
  : value && typeof value === 'object' ? Object.values(value).flatMap(imageData) : [];

export async function runMeridianRewardGating(releasePath) {
  assert.ok(releasePath, 'Set QA_MERIDIAN_RELEASE to the real immutable Meridian Console release.');
  const path = resolve(releasePath), originalBytes = await readFile(path);
  const envelope = checkedRelease(JSON.parse(originalBytes));
  const { skin, assets, rewardRule } = envelope.body;
  assert.equal(skin.name, 'Meridian Console');
  assert.deepEqual(rewardRule, { allOf: [missionId] });
  const originalAchievements = studioAchievementCatalog.filter(award => award.id !== missionId);
  assert.equal(originalAchievements.length, 178);
  assert.equal(sha256(JSON.stringify(originalAchievements)), '33e5cdb701f0dbff83fa9e86d9dd1358b11cba8236a3578e4597e3944113dd00');

  let now = START, materializations = 0, checks = 0;
  const store = new MemoryAccountHistoryStore();
  const accountHistory = new AccountHistory({ store, now: () => now });
  const { server, service } = createRealtimeServer({
    appEnv: 'test', now: () => now, accountHistory,
    durableRecoveryEnabled: false, autoRecoverRooms: false,
    connectionTtlMs: 60 * DAY, roomTtlMs: 60 * DAY,
    accountVerifier: { async verify(token) {
      if (![EXPLORER, CONTROL].includes(token)) throw Object.assign(new Error('Sign in to the disposable fixture.'), { status: 401 });
      return { providerSubject: token };
    } },
    // This is the same metadata/lazy hydration contract the hosted registry uses.
    studioRewardSkins: async () => [{
      skin: { id: skin.id, name: skin.name }, rewardRule, activatedAt: START,
      loadSkin: async () => {
        materializations++;
        return materializeAppearanceSkin(skin, { assets });
      },
    }],
    fetchImpl: async () => { throw new Error('External connections are forbidden in this fixture.'); },
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function request(pathname, { token = EXPLORER, connectionId, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
    assert.ok(pathname.startsWith('/api/'));
    const response = await fetch(origin + pathname, {
      method, headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(connectionId ? { 'x-connection-id': connectionId } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const checkStatus = (result, status, label) => { assert.equal(result.status, status, label + ': ' + JSON.stringify(result.data)); checks++; return result.data; };
  const locked = (result, label) => { checkStatus(result, 403, label); assert.equal(result.data.error.code, 'SKIN_LOCKED', label); checks++; };
  const select = token => request('/api/account/preferences', { token, method: 'PUT', body: { personalSkinId: skin.id, usePersonalSkin: true } });
  function game(commander) {
    const host = service.createConnection().connectionId, guest = service.createConnection().connectionId;
    const created = service.createRoom(host, { playerCount: 2, startingLife: 40, gameFormat: 'commander', commanderNames: [commander] });
    const code = created.snapshot.code;
    service.claimSeat(code, guest, { seatId: 1 });
    const room = service.room(code);
    const act = (method, input = {}, owner = host) => service[method](code, owner, { ...input, baseVersion: room.version });
    act('startGame');
    return { host, guest, room, code,
      reference: { roomCode: code, gameId: room.gameId },
      turns(count) { for (let n = 0; n < count; n++) { act('handoffTurn'); act('handoffTurn', {}, guest); } },
      finish(result) { return result === 'draw' ? act('completeTimedDraw') : act('declareWinner', { winnerSeatId: result === 'win' ? 0 : 1 }); },
    };
  }
  const choice = async token => {
    const data = checkStatus(await request('/api/account/preferences', { token }), 200, 'read skin choices');
    const found = data.skins.find(candidate => candidate.id === skin.id);
    assert.ok(found, 'Real reward appears in signed-in choices'); checks++;
    return found;
  };
  const artwork = token => request('/api/game-skins/' + skin.id, { token });
  const share = (g, token) => request('/api/rooms/' + g.code + '/table-skin', { token, connectionId: g.host, body: { baseVersion: g.room.version, tableSkinId: skin.id } });
  const profile = async token => checkStatus(await request('/api/account/history', { token }), 200, 'read tracked profile').history;
  const existingAwards = values => values.filter(award => award.id !== missionId);
  const states = [], savedIds = [];
  try {
    const shareRoom = game('Commander Spock');
    checkStatus(await request('/api/account/preferences', { token: null }), 401, 'signed-out preferences');
    checkStatus(await select(null), 401, 'signed-out personal selection');
    checkStatus(await share(shareRoom, null), 401, 'signed-out table sharing');
    // Locked artwork intentionally uses 404 rather than revealing the reward.
    checkStatus(await artwork(null), 404, 'signed-out artwork concealment');
    const publicCatalog = checkStatus(await request('/api/game-skins', { token: null }), 200, 'anonymous catalog');
    assert.equal(publicCatalog.skins.some(item => item.id === skin.id), false); checks++;
    assert.equal((await choice(EXPLORER)).state, 'locked'); checks++;
    checkStatus(await artwork(EXPLORER), 404, 'unearned artwork concealment');
    locked(await select(EXPLORER), 'unearned personal selection');
    locked(await share(shareRoom, EXPLORER), 'unearned table sharing');
    assert.equal(materializations, 0, 'Unauthorized requests must not hydrate artwork'); checks++;
    await profile(CONTROL);
    checkStatus(await request('/api/account/missions/exploration-commission/start', { body: { timeZone: 'America/Los_Angeles' } }), 200, 'enroll mission');

    const turns = [13, 12, 1], outcomes = ['win', 'loss', 'draw'];
    for (let day = 0; day < 3; day++) {
      const commander = day === 1 ? 'Captain Jean-Luc Picard' : 'Commander Spock';
      const saved = [];
      for (const token of [EXPLORER, CONTROL]) {
        now = START + day * DAY + 1000;
        const g = game(commander); g.turns(turns[day]); g.finish(outcomes[day]);
        now = START + 10 * DAY; // Save time must not become the play date.
        saved.push(checkStatus(await request('/api/account/games', { token, connectionId: g.host, body: g.reference }), 201, 'save trusted completion'));
      }
      savedIds.push(saved[0].game.gameId);
      assert.deepEqual(existingAwards(saved[0].unlockedAchievements), saved[1].unlockedAchievements, 'Existing award order/definitions match the non-enrolled control'); checks++;
      const explorer = await profile(EXPLORER), control = await profile(CONTROL);
      assert.deepEqual(existingAwards(explorer.achievements), control.achievements, 'Existing profile awards match the non-enrolled control'); checks++;
      assert.equal(saved[0].game.achievementFacts.turnCount, turns[day]); checks++;
      assert.equal(explorer.explorationCommission.playDates, day + 1); checks++;
      const state = await choice(EXPLORER);
      states.push({ outcome: outcomes[day], ...explorer.explorationCommission, rewardState: state.state });
      if (day < 2) {
        assert.equal(state.state, 'locked'); checks++;
        checkStatus(await artwork(EXPLORER), 404, 'partial mission artwork');
        locked(await select(EXPLORER), 'partial mission personal selection');
        locked(await share(shareRoom, EXPLORER), 'partial mission table sharing');
      }
      if (day === 1) {
        assert.equal(explorer.explorationCommission.commanderVariety, 2);
        assert.equal(explorer.explorationCommission.recordedTurns, 25);
        assert.equal(explorer.explorationCommission.playDates, 2);
        assert.equal(explorer.explorationCommission.earnedAt, null); checks += 4;
        assert.equal(materializations, 0, 'Two complete objectives must not hydrate reward art'); checks++;
      }
    }

    const earned = await profile(EXPLORER);
    assert.equal(earned.achievements.filter(award => award.id === missionId).length, 1); checks++;
    assert.notEqual((await choice(EXPLORER)).state, 'locked'); checks++;
    checkStatus(await select(EXPLORER), 200, 'earned personal selection');
    const dto = checkStatus(await artwork(EXPLORER), 200, 'earned immutable artwork DTO').skin;
    const { achievement, ...visual } = dto;
    assert.deepEqual(visual, await materializeAppearanceSkin(skin, { assets })); checks++;
    assert.ok(achievement, 'Owned DTO includes existing Studio reward metadata'); checks++;
    const servedImages = new Set(imageData(dto));
    for (const asset of assets) { assert.ok(servedImages.has(asset.data), 'Real release asset served: ' + asset.id); checks++; }
    checkStatus(await share(shareRoom, EXPLORER), 200, 'earned host sharing');
    const shared = checkStatus(await request('/api/rooms/' + shareRoom.code + '/table-skin', { token: null, connectionId: shareRoom.guest }), 200, 'participating guest sees earned host appearance');
    assert.deepEqual(shared.skin, dto); checks++;
    locked(await select(CONTROL), 'other account remains personally locked');
    locked(await share(shareRoom, CONTROL), 'unearned account cannot share earned skin');
    const stranger = service.createConnection().connectionId;
    checkStatus(await request('/api/rooms/' + shareRoom.code + '/table-skin', { token: null, connectionId: stranger }), 403, 'nonparticipant cannot read table artwork');

    for (const id of savedIds) checkStatus(await request('/api/account/games/' + id, { method: 'DELETE' }), 204, 'remove fixture history');
    const retained = await profile(EXPLORER);
    assert.deepEqual(retained.explorationCommission, earned.explorationCommission); checks++;
    assert.deepEqual(retained.achievements, earned.achievements); checks++;
    assert.notEqual((await choice(EXPLORER)).state, 'locked'); checks++;
    checkStatus(await select(EXPLORER), 200, 'permanent personal ownership');
    checkStatus(await artwork(EXPLORER), 200, 'permanent artwork access');
    assert.equal(sha256(await readFile(path)), sha256(originalBytes), 'Immutable release file remains unchanged'); checks++;
    return { checks, digest: envelope.digest, skin: { id: skin.id, name: skin.name }, assets: assets.length,
      states, ownedAfterHistoryRemoval: true, originalAchievementsUnchanged: true,
      signedOutActions: 401, concealedArtwork: 404, unearnedActions: 'SKIN_LOCKED',
      sharedGuestView: 'participating guests may view an earned host skin; personal entitlement stays locked',
      scope: 'disposable loopback memory; no real accounts, catalog writes, or activation' };
  } finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runMeridianRewardGating(process.env.QA_MERIDIAN_RELEASE), null, 2));
}
