import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions, competitionStoreForEnvironment, scopePath } from '../src/competitions.js';
import { CompetitionTables } from '../src/competition-tables.js';
import { RoomService } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { MemoryPlaytestLedger, FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

let instance = 0;
function domain(store = new MemoryAccountHistoryStore()) {
  const prefix = `retry${++instance}`;
  let sequence = 0, now = 1000;
  return new Competitions({ store, createId: () => `${prefix}_${++sequence}`, now: () => now++, podOwnershipEnabled: true });
}
const input = overrides => ({ name: 'Friday Pod', displayName: 'Owner', requestId: 'create_retry_0001', ...overrides });

async function confirmPlayedGame(service, pod) {
  const ledger = new MemoryPlaytestLedger(), rooms = new RoomService({ ledger });
  const tables = new CompetitionTables({ domain: service, service: rooms, ledger });
  const host = rooms.createConnection().connectionId, member = rooms.createConnection().connectionId;
  const code = rooms.createRoom(host, { playerCount: 2, startingLife: 40, name: 'Owner' }).snapshot.code;
  rooms.claimSeat(code, member, { seatId: 1, name: 'Member' });
  await tables.bind('owner', { kind: 'pod', id: pod.id, code, connectionId: host });
  await tables.claim('member', { code, connectionId: member });
  await tables.start(code, host, { baseVersion: rooms.room(code).version });
  rooms.declareWinner(code, host, { baseVersion: rooms.room(code).version, winnerSeatId: 0, winCondition: 'other_declared' });
  await tables.reconcile('pod', pod.id);
  const gameId = rooms.room(code).gameId;
  const game = (await service.readScope('pod', pod.id)).games[gameId];
  await tables.confirm('owner', 'pod', pod.id, gameId, {
    order: game.starterIds.map(id => [id]), baseRevision: 0, requestId: 'creation_replay_history', reasonCode: 'host_confirmation',
  });
  return gameId;
}

test('legacy callers without a creation retry identifier can still create separate Pods', async () => {
  const service = domain();
  const body = { name: 'Friday Pod', displayName: 'Owner' };
  const first = await service.createPod('owner', body), second = await service.createPod('owner', body);
  assert.notEqual(first.id, second.id);
  assert.equal((await service.list('owner')).pods.length, 2);
});

test('one account and retry identifier replay the same Pod using canonical name and display name', async () => {
  const store = new MemoryAccountHistoryStore(), firstService = domain(store);
  const first = await firstService.createPod('owner', input({ name: '  Friday   Pod  ', displayName: '  Mi\u0301ra  ' }));
  const restarted = domain(store);
  const replayed = await restarted.createPod('owner', input({ displayName: 'Míra' }));
  assert.equal(replayed.id, first.id);
  assert.equal(replayed.name, 'Friday Pod');
  assert.equal(replayed.members.find(row => row.id === replayed.me).name, 'Míra');
  assert.equal((await restarted.list('owner')).pods.length, 1);
});

test('different accounts using the same retry identifier remain isolated', async () => {
  const service = domain();
  const first = await service.createPod('first-account', input());
  const second = await service.createPod('second-account', input());
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await service.list('first-account')).pods.map(row => row.id), [first.id]);
  assert.deepEqual((await service.list('second-account')).pods.map(row => row.id), [second.id]);
  await assert.rejects(() => service.getPod('second-account', first.id), { status: 403 });
});

test('different retry identifiers preserve distinct creation intents for the same account', async () => {
  const service = domain();
  const first = await service.createPod('owner', input());
  const second = await service.createPod('owner', input({ requestId: 'create_retry_0002' }));
  assert.notEqual(first.id, second.id);
  assert.equal((await service.list('owner')).pods.length, 2);
});

test('reusing a creation identifier with a different canonical payload rejects without creating a Pod', async () => {
  for (const changed of [{ name: 'Other Pod' }, { displayName: 'Different owner name' }]) {
    const store = new MemoryAccountHistoryStore(), service = domain(store);
    const first = await service.createPod('owner', input());
    const before = structuredClone(await service.readScope('pod', first.id));
    await assert.rejects(() => domain(store).createPod('owner', input(changed)), {
      status: 409, code: 'POD_CREATE_RETRY_CONFLICT',
    });
    assert.deepEqual((await service.list('owner')).pods.map(row => row.id), [first.id]);
    assert.deepEqual(await service.readScope('pod', first.id), before);
  }
});

test('provided creation identifiers are validated before any storage writes', async () => {
  for (const requestId of [null, '', 'short', 'bad.key_01', 'bad/key_01', 'bad!key_01', 'x'.repeat(101), 7, [], {}]) {
    const store = new MemoryAccountHistoryStore(), service = domain(store);
    await assert.rejects(() => service.createPod('owner', input({ requestId })), { status: 400 });
    assert.equal(store.values.size, 0);
  }
});

test('creation retry identifiers accept their eight and one-hundred character boundaries', async () => {
  for (const requestId of ['retry_01', 'x'.repeat(100)]) {
    const service = domain();
    const first = await service.createPod('owner', input({ requestId }));
    const replayed = await service.createPod('owner', input({ requestId }));
    assert.equal(replayed.id, first.id);
    assert.equal((await service.list('owner')).pods.length, 1);
  }
});

test('independent domains with conditional REST adapters cannot create two Pods for concurrent identical retries', { timeout: 15000 }, async t => {
  const database = await startCompetitionRestFixture({ delayMs: 2 });
  t.after(() => database.close());
  const makeStore = () => {
    const adapter = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'loopback-only', privateKey: 'not-a-key',
      logger: { error() {} }, fetchImpl: (url, options) => {
        assert.equal(new URL(url).origin, database.url, 'All test storage must remain loopback');
        return fetch(url, options);
      } });
    adapter.accessToken = async () => 'local-fixture-only';
    return competitionStoreForEnvironment(adapter, 'qa');
  };
  const left = domain(makeStore()), right = domain(makeStore());
  const outcomes = await Promise.allSettled([left.createPod('owner', input()), right.createPod('owner', input())]);
  for (const outcome of outcomes.filter(row => row.status === 'rejected')) {
    assert.equal(outcome.reason.status, 409, 'An in-flight duplicate may ask the caller to retry, but cannot run a second creation');
    assert.notEqual(outcome.reason.code, 'POD_CREATE_RETRY_CONFLICT', 'An identical payload is not conflicting identifier reuse');
  }
  const replayed = await domain(makeStore()).createPod('owner', input());
  for (const outcome of outcomes.filter(row => row.status === 'fulfilled')) assert.equal(outcome.value.id, replayed.id);
  assert.deepEqual((await left.list('owner')).pods.map(row => row.id), [replayed.id]);
});

for (const failure of ['before', 'after']) {
  test(`a fresh domain resumes one creation after a storage failure ${failure} the first Pod scope commit`, async () => {
    const storage = new MemoryAccountHistoryStore();
    let injected = false, attemptedId;
    const store = {
      read: path => storage.read(path),
      async update(path, change) {
        let justCreated = false;
        const result = await storage.update(path, current => {
          const next = change(current);
          if (!injected && !current && next?.kind === 'pod') {
            injected = true; justCreated = true; attemptedId = next.id;
            if (failure === 'before') throw new Error('Fixture Pod scope write interrupted');
          }
          return next;
        });
        if (justCreated && failure === 'after') throw new Error('Fixture Pod scope response lost');
        return result;
      },
    };
    await assert.rejects(() => domain(store).createPod('owner', input()), /Fixture Pod scope/);
    assert.equal(injected, true);
    const restarted = domain(store);
    const replayed = await restarted.createPod('owner', input());
    assert.equal(replayed.id, attemptedId, 'The durable creation intent must retain its original target');
    assert.deepEqual((await restarted.list('owner')).pods.map(row => row.id), [replayed.id]);
    assert.equal((await restarted.getPod('owner', replayed.id)).name, 'Friday Pod');
  });
}

for (const failure of ['before', 'after']) {
  test(`a fresh domain recovers a failure ${failure} committing the directory creation reservation`, async () => {
    const storage = new MemoryAccountHistoryStore();
    let injected = false, reservedId;
    // Observe the public membership index addition rather than the private receipt
    // key or its hash. The alias/index and retry reservation commit together.
    const podIds = directory => new Set(Object.values(directory?.scopes || {})
      .flatMap(scopes => Object.keys(scopes)).filter(id => id.startsWith('pod_')));
    const store = {
      read: path => storage.read(path),
      async update(path, change) {
        let reserved = false;
        const result = await storage.update(path, current => {
          const existing = podIds(current), next = change(current);
          const added = [...podIds(next)].filter(id => !existing.has(id));
          if (!injected && added.length) {
            assert.equal(added.length, 1);
            injected = true; reserved = true; reservedId = added[0];
            if (failure === 'before') throw new Error('Fixture creation reservation interrupted');
          }
          return next;
        });
        if (reserved && failure === 'after') throw new Error('Fixture creation reservation response lost');
        return result;
      },
    };
    await assert.rejects(() => domain(store).createPod('owner', input()), /Fixture creation reservation/);
    assert.equal(injected, true);
    assert.equal(await storage.read(scopePath('pod', reservedId)), null, 'The failure happens before publishing a Pod scope');

    const restarted = domain(store);
    const replayed = await restarted.createPod('owner', input());
    if (failure === 'after') assert.equal(replayed.id, reservedId, 'A committed reservation retains its target after the response is lost');
    assert.deepEqual((await restarted.list('owner')).pods.map(row => row.id), [replayed.id]);
    assert.equal((await restarted.getPod('owner', replayed.id)).members.length, 1);
    assert.equal([...storage.values.values()].filter(value => value?.kind === 'pod').length, 1);
  });
}

test('replaying creation after rename, played history and ownership changes never rewinds current Pod state', async () => {
  const store = new MemoryAccountHistoryStore(), service = domain(store);
  const pod = await service.createPod('owner', input());
  const invite = await service.invite('owner', 'pod', pod.id);
  const member = await service.joinPod('member', invite.token, { displayName: 'Member' });
  const gameId = await confirmPlayedGame(service, pod);
  await service.podMemberAction('owner', pod.id, { action: 'rename', name: 'Renamed Pod' });
  await service.podMemberAction('owner', pod.id, { action: 'admin', targetId: member.me, enabled: true });
  await service.podMemberAction('owner', pod.id, { action: 'leave' });
  const returning = await service.invite('member', 'pod', pod.id);
  await service.joinPod('owner', returning.token, { displayName: 'Owner returned' });
  const before = structuredClone(await service.readScope('pod', pod.id));

  const replayed = await domain(store).createPod('owner', input());
  assert.equal(replayed.id, pod.id);
  assert.equal(replayed.name, 'Renamed Pod');
  assert.equal(replayed.role, 'member');
  assert.equal(replayed.ownerId, member.me);
  assert.equal(replayed.members.find(row => row.id === replayed.me).name, 'Owner returned');
  assert.equal(replayed.members.find(row => row.id === replayed.me).gamesPlayed, 1);
  assert.equal(before.games[gameId].revisions.length, 1);
  assert.deepEqual(await service.readScope('pod', pod.id), before);
  assert.equal((await service.list('owner')).pods.length, 1);
});

test('a creator who remains left cannot replay creation to restore membership or ownership', async () => {
  const store = new MemoryAccountHistoryStore(), service = domain(store);
  const pod = await service.createPod('owner', input());
  const invite = await service.invite('owner', 'pod', pod.id);
  const member = await service.joinPod('member', invite.token, { displayName: 'Member' });
  await service.podMemberAction('owner', pod.id, { action: 'admin', targetId: member.me, enabled: true });
  await service.podMemberAction('owner', pod.id, { action: 'leave' });
  const before = structuredClone(await service.readScope('pod', pod.id));
  assert.equal(before.members[pod.me].status, 'left');
  assert.equal(before.ownerId, member.me);

  await assert.rejects(() => domain(store).createPod('owner', input()), { status: 403 });
  assert.equal((await service.list('owner')).pods.length, 0);
  assert.deepEqual(await service.readScope('pod', pod.id), before);
  assert.equal((await service.getPod('member', pod.id)).ownerId, member.me);
});

test('retrying a deleted Pod creation never recreates its group or membership', async () => {
  const store = new MemoryAccountHistoryStore(), service = domain(store);
  const pod = await service.createPod('owner', input());
  await service.deletePod('owner', pod.id, { confirmationName: pod.name });
  const marker = structuredClone(await store.read(scopePath('pod', pod.id)));
  await assert.rejects(() => domain(store).createPod('owner', input()), error => [403, 404, 409].includes(error.status));
  assert.equal((await service.list('owner')).pods.length, 0);
  assert.deepEqual(await store.read(scopePath('pod', pod.id)), marker);
});

test('an erased account cannot replay a creation receipt to regain access or create a new Pod', async () => {
  const store = new MemoryAccountHistoryStore(), service = domain(store);
  const pod = await service.createPod('owner', input());
  await service.eraseAccount('owner');
  const before = structuredClone(await store.read(scopePath('pod', pod.id)));
  await assert.rejects(() => domain(store).createPod('owner', input()), { status: 403 });
  assert.deepEqual(await store.read(scopePath('pod', pod.id)), before);
  assert.equal([...store.values.values()].filter(value => value?.kind === 'pod').length, 1);
});
