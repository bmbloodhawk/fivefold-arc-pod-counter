// Metadata-only reward wiring preset. Everything lives in disposable memory on
// loopback; no real skin, catalog, draft, asset, owner, or service is modified.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../server/src/account-history.js';

export const PRESET_START = Date.UTC(2026, 10, 20, 12);
export const PRESET_REWARD = {id: 'skin-local-exploration-preset', name: 'Starship interface · local reward wiring test'};
export async function openExplorationPreset() {
  let now = PRESET_START;
  const store = new MemoryAccountHistoryStore();
  const accountHistory = new AccountHistory({store, now: () => now});
  const {server, service} = createRealtimeServer({appEnv: 'test', now: () => now, accountHistory,
    durableRecoveryEnabled: false, autoRecoverRooms: false, connectionTtlMs: 30 * 86_400_000,
    accountVerifier: {async verify(token) {
      if (!token) throw Object.assign(new Error('Sign in'), {status: 401});
      return {providerSubject: token};
    }},
    studioRewardSkins: async () => [{skin: PRESET_REWARD,
      rewardRule: {allOf: ['exploration-commission']}, activatedAt: PRESET_START}],
    fetchImpl: async () => {throw new Error('This preset has no external connection.');},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function request(path, {body, method = body === undefined ? 'GET' : 'POST', token = 'local-explorer', connectionId} = {}) {
    const response = await fetch(origin + '/api/account/' + path, {method,
      headers: {...(token ? {authorization: 'Bearer ' + token} : {}),
        ...(connectionId ? {'x-connection-id': connectionId} : {}),
        ...(body === undefined ? {} : {'content-type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, data: response.status === 204 ? null : await response.json()};
  }
  function game({commander = 'Commander Spock', gameFormat = 'commander', sessionKind = 'standard'} = {}) {
    const host = service.createConnection().connectionId, guest = service.createConnection().connectionId;
    const created = service.createRoom(host, {playerCount: 2, startingLife: 40, gameFormat, commanderNames: [commander]});
    const code = created.snapshot.code;
    service.claimSeat(code, guest, {seatId: 1});
    const room = service.room(code);
    const act = (method, input = {}, owner = host) => service[method](code, owner, {...input, baseVersion: room.version});
    if (sessionKind !== 'standard') act('setSessionKind', {sessionKind});
    act('startGame');
    return {host, guest, room, act, reference: {roomCode: code, gameId: room.gameId},
      turns(count) { for (let n = 0; n < count; n++) {act('handoffTurn'); act('handoffTurn', {}, guest);} },
      finish(result = 'win') {return result === 'draw' ? act('completeTimedDraw') : act('declareWinner', {winnerSeatId: result === 'win' ? 0 : 1});},
    };
  }
  return {store, accountHistory, service, request, game, setNow(value) {now = value;},
    async close() {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}};
}

export async function runExplorationPreset() {
  const f = await openExplorationPreset();
  try {
    const start = await f.request('missions/exploration-commission/start', {body: {timeZone: 'America/Los_Angeles'}});
    assert.equal(start.status, 200);
    const states = [], savedIds = [];
    for (let day = 0; day < 3; day++) {
      f.setNow(PRESET_START + day * 86_400_000 + 1000);
      const g = f.game({commander: day === 1 ? 'Captain Jean-Luc Picard' : 'Commander Spock'});
      g.turns(9); g.finish(['win', 'loss', 'draw'][day]);
      f.setNow(PRESET_START + 10 * 86_400_000);
      const saved = await f.request('games', {body: g.reference, connectionId: g.host});
      assert.equal(saved.status, 201);
      savedIds.push(saved.data.game.gameId);
      const summary = (await f.request('history')).data.history;
      const choice = (await f.request('preferences')).data.skins.find(skin => skin.id === PRESET_REWARD.id);
      states.push({result: ['win', 'loss', 'draw'][day], mission: summary.explorationCommission, rewardState: choice.state,
        awards: saved.data.unlockedAchievements.map(item => item.id)});
      assert.equal(choice.state === 'locked', day < 2);
    }
    for (const id of savedIds) assert.equal((await f.request('games/' + id, {method: 'DELETE'})).status, 204);
    const retained = (await f.request('preferences')).data.skins.find(skin => skin.id === PRESET_REWARD.id);
    assert.notEqual(retained.state, 'locked');
    return {preset: 'isolated loopback memory; metadata-only reward', reward: PRESET_REWARD, states,
      ownedAfterHistoryRemoval: true, realSkinOrCatalogChanged: false};
  } finally {await f.close();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runExplorationPreset(), null, 2));
}
