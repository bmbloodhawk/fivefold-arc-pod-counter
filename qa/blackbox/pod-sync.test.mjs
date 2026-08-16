import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enabled, newConnection, createPod, claimSeat, reclaimSeat, snapshot, mutate,
  resetPod, nextEvent,
} from './adapter.mjs';

const live = enabled ? test : test.skip;

function seat(state, seatId) {
  const value = state.seats.find(candidate => candidate.seatId === seatId);
  assert.ok(value, `snapshot is missing seat ${seatId}`);
  return value;
}

async function podFixture(options = {}) {
  const playerCount = options.playerCount || 4;
  const created = await createPod({
    playerCount,
    startingLife: options.startingLife || 40,
    commanderCount: options.commanderCounts?.[0] || 1,
  });
  const claims = { 0: { connectionId: created.connectionId, reclaimToken: created.reclaimToken } };
  for (let seatId = 1; seatId < playerCount; seatId += 1) {
    claims[seatId] = await claimSeat(created.podId, seatId, {
      commanderCount: options.commanderCounts?.[seatId] || 1,
    });
  }
  return { ...created, claims };
}

function commanderSource(state, ownerSeatId, slot = 'a') {
  const id = `seat-${ownerSeatId}-commander-${slot}`;
  const value = state.commanderSources.find(candidate => candidate.id === id);
  assert.ok(value, `snapshot is missing commander source ${id}`);
  return value;
}

live('creates valid 2, 4, and 8 seat pods with correct defaults', async t => {
  for (const count of [2, 4, 8]) {
    await t.test(`${count} seats`, async () => {
      const f = await podFixture({ playerCount: count });
      const state = await snapshot(f.podId);
      assert.equal(state.seats.length, count);
      assert.equal(state.config.startingLife, 40);
      assert.equal(state.commanderSources.length, count);
      assert.ok(state.seats.every(value => value.commanderCount === 1));
      assert.ok(state.seats.every(value => value.counters.life === 40 && value.counters.poison === 0));
    });
  }
});

live('seat owner may edit only their own counters', async () => {
  const f = await podFixture();
  let state = await snapshot(f.podId);
  await mutate(f.podId, f.claims[0].connectionId, { baseVersion: state.version, counters: { life: 35 } });
  state = await snapshot(f.podId);
  assert.equal(seat(state, 0).counters.life, 35);
  assert.equal(seat(state, 1).counters.life, 40);
  await mutate(f.podId, 'invalid', { baseVersion: state.version, counters: { life: 1 } }, { expected: 401 });
});

live('commander damage is defender-owned and another connection cannot alter it', async () => {
  const f = await podFixture();
  let state = await snapshot(f.podId);
  const p1Commander = commanderSource(state, 0).id;
  const p2Commander = commanderSource(state, 1).id;
  await mutate(f.podId, f.claims[1].connectionId, {
    baseVersion: state.version, commanderDamageReceived: { [p1Commander]: 7 },
  });
  state = await snapshot(f.podId);
  assert.equal(seat(state, 1).commanderDamageReceived[p1Commander], 7);
  assert.equal(seat(state, 0).commanderDamageReceived[p2Commander], 0);
  await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version, commanderDamageReceived: { [p2Commander]: 1 },
  });
  state = await snapshot(f.podId);
  assert.equal(seat(state, 1).commanderDamageReceived[p1Commander], 7);
  assert.equal(seat(state, 0).commanderDamageReceived[p2Commander], 1);
});

live('two simultaneous claims for one seat have exactly one winner', async () => {
  const created = await createPod({ playerCount: 2, startingLife: 40, commanderCount: 1 });
  const attempts = await Promise.allSettled([
    claimSeat(created.podId, 1),
    claimSeat(created.podId, 1),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
});

live('simultaneous writes serialize: one commits and one gets the winning snapshot', async () => {
  const f = await podFixture({ playerCount: 2 });
  const before = await snapshot(f.podId);
  const [a, b] = await Promise.all([
    mutate(f.podId, f.claims[0].connectionId, { baseVersion: before.version, counters: { life: 37 } }, { raw: true }),
    mutate(f.podId, f.claims[1].connectionId, { baseVersion: before.version, counters: { life: 36 } }, { raw: true }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  const authoritative = await snapshot(f.podId);
  assert.equal(loser.body.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(loser.body.snapshot, authoritative);
  assert.equal(authoritative.version, before.version + 1);
});

live('reset clears gameplay state, preserves preferences and claims, and is host-only', async () => {
  const f = await podFixture({ playerCount: 4, startingLife: 30, commanderCounts: [2, 1, 2, 1] });
  let state = await snapshot(f.podId);
  const p2Commander = commanderSource(state, 1).id;
  const changed = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version,
    counters: { life: 1, poison: 9, energy: 6, storm: 4, generic: 12 },
    commanderDamageReceived: { [p2Commander]: 20 },
  });
  await resetPod(f.podId, f.claims[1].connectionId, changed.snapshot.version, { expected: 403 });
  const reset = await resetPod(f.podId, f.claims[0].connectionId, changed.snapshot.version);
  state = reset.snapshot;
  assert.equal(state.config.playerCount, 4);
  assert.equal(state.config.startingLife, 30);
  assert.deepEqual(state.seats.map(value => value.commanderCount), [2, 1, 2, 1]);
  assert.ok(state.seats.every(value => value.claimed));
  assert.equal(seat(state, 0).counters.life, 30);
  for (const key of ['poison', 'energy', 'storm', 'generic']) assert.equal(seat(state, 0).counters[key], 0);
  assert.ok(Object.values(seat(state, 0).commanderDamageReceived).every(value => value === 0));
});

live('SSE observers converge on the same authoritative snapshot', async () => {
  const f = await podFixture({ playerCount: 2 });
  const [fromA, fromB, authoritative] = await Promise.all([
    nextEvent(f.podId, f.claims[0].connectionId),
    nextEvent(f.podId, f.claims[1].connectionId),
    snapshot(f.podId),
  ]);
  assert.deepEqual(fromA, authoritative);
  assert.deepEqual(fromB, authoritative);
});

live('reconnect preserves state, invalidates old authority, and rejects stale offline writes', async () => {
  const f = await podFixture({ playerCount: 2 });
  const old = f.claims[1];
  const before = await snapshot(f.podId);
  const changed = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: before.version, counters: { life: 39 },
  });
  const reconnected = await reclaimSeat(f.podId, 1, old.reclaimToken);
  await mutate(f.podId, old.connectionId, {
    baseVersion: reconnected.snapshot.version, counters: { life: 1 },
  }, { expected: 403 });
  await mutate(f.podId, reconnected.connectionId, {
    baseVersion: changed.snapshot.version, counters: { life: 1 },
  }, { expected: 409 });
  const after = await snapshot(f.podId);
  assert.equal(seat(after, 0).counters.life, 39);
  assert.equal(seat(after, 1).counters.life, 40);
});

live('invalid configuration is rejected', async () => {
  const connection = await newConnection();
  const response = await fetch(`${process.env.QA_BASE_URL.replace(/\/$/, '')}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-connection-id': connection.connectionId },
    body: JSON.stringify({ playerCount: 9, startingLife: 25, commanderCount: 0 }),
  });
  assert.equal(response.status, 400);
});
