import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enabled, createPod, claimSeat, reclaimSeat, snapshot, mutate, resetPod,
  openSnapshotStream, setCommanderCastCounts,
} from './adapter.mjs';

const live = enabled ? test : test.skip;
const sourceId = (seatId, slot = 'a') => `seat-${seatId}-commander-${slot}`;

function seat(state, seatId) {
  const value = state.seats.find(candidate => candidate.seatId === seatId);
  assert.ok(value, `snapshot is missing seat ${seatId}`);
  return value;
}

function assertCast(state, seatId, slot, count) {
  const source = sourceId(seatId, slot);
  const owner = seat(state, seatId);
  assert.equal(owner.commanderCastCounts[source], count,
    `${source} must have cast count ${count}`);
  assert.equal(owner.nextCommanderTax[source], count * 2,
    `${source} must derive next tax from its cast count`);
}

async function fixture(counts = [1, 1]) {
  const created = await createPod({ playerCount: counts.length, commanderCount: counts[0] });
  const claims = {
    0: { connectionId: created.connectionId, reclaimToken: created.reclaimToken },
  };
  for (let seatId = 1; seatId < counts.length; seatId += 1) {
    claims[seatId] = await claimSeat(created.podId, seatId, { commanderCount: counts[seatId] });
  }
  return { ...created, claims };
}

live('snapshot exposes per-seat cast counts and derived tax; first cast changes 0/+0 to 1/+2', async () => {
  const f = await fixture([1, 1]);
  let state = await snapshot(f.podId);

  assert.equal(Object.hasOwn(state, 'commanderCastCounts'), false,
    'cast counts belong under seats[], not at snapshot top level');
  assert.equal(Object.hasOwn(state, 'nextCommanderTax'), false,
    'derived tax belongs under seats[], not at snapshot top level');
  assertCast(state, 0, 'a', 0);
  assertCast(state, 1, 'a', 0);
  assert.deepEqual(Object.keys(seat(state, 0).commanderCastCounts), [sourceId(0)]);
  assert.deepEqual(Object.keys(seat(state, 1).commanderCastCounts), [sourceId(1)]);

  state = (await setCommanderCastCounts(
    f.podId,
    f.claims[0].connectionId,
    state.version,
    { [sourceId(0)]: 1 },
  )).snapshot;
  assertCast(state, 0, 'a', 1);
  assertCast(state, 1, 'a', 0);
});

live('partner commanders A and B keep independent cast counts and next tax', async () => {
  const f = await fixture([2, 1]);
  let state = await snapshot(f.podId);
  state = (await setCommanderCastCounts(
    f.podId,
    f.claims[0].connectionId,
    state.version,
    { [sourceId(0)]: 1, [sourceId(0, 'b')]: 2 },
  )).snapshot;
  assertCast(state, 0, 'a', 1);
  assertCast(state, 0, 'b', 2);

  state = (await setCommanderCastCounts(
    f.podId,
    f.claims[0].connectionId,
    state.version,
    { [sourceId(0)]: 3 },
  )).snapshot;
  assertCast(state, 0, 'a', 3);
  assertCast(state, 0, 'b', 2);
});

live('only a commander owner may edit its active cast count', async () => {
  const f = await fixture([1, 1]);
  const before = await snapshot(f.podId);
  const rejected = await setCommanderCastCounts(
    f.podId,
    f.claims[1].connectionId,
    before.version,
    { [sourceId(0)]: 1 },
    { raw: true },
  );
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'INVALID_INPUT');
  assert.deepEqual(await snapshot(f.podId), before);
});

live('unknown, foreign, inactive, and legacy commander IDs are rejected without mutation', async t => {
  const invalidSources = [
    ['unknown', 'seat-99-commander-a'],
    ['foreign', sourceId(1)],
    ['inactive partner', sourceId(0, 'b')],
    ['legacy numeric', '0'],
  ];
  for (const [label, invalidSource] of invalidSources) {
    await t.test(label, async () => {
      const f = await fixture([1, 1]);
      const before = await snapshot(f.podId);
      const rejected = await setCommanderCastCounts(
        f.podId,
        f.claims[0].connectionId,
        before.version,
        { [invalidSource]: 1 },
        { raw: true },
      );
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error.code, 'INVALID_INPUT');
      assert.deepEqual(await snapshot(f.podId), before);
    });
  }

  await t.test('B cannot be added and cast in one mutation', async () => {
    const f = await fixture([1, 1]);
    const before = await snapshot(f.podId);
    const rejected = await mutate(f.podId, f.claims[0].connectionId, {
      baseVersion: before.version,
      commanderCount: 2,
      commanderCastCounts: { [sourceId(0, 'b')]: 1 },
    }, { raw: true });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error.code, 'INVALID_INPUT');
    assert.deepEqual(await snapshot(f.podId), before);
  });
});

live('an exact-version cast conflict commits once and never replays the loser', async () => {
  const f = await fixture([1, 1]);
  const before = await snapshot(f.podId);
  const [one, two] = await Promise.all([
    setCommanderCastCounts(f.podId, f.claims[0].connectionId, before.version,
      { [sourceId(0)]: 1 }, { raw: true }),
    setCommanderCastCounts(f.podId, f.claims[0].connectionId, before.version,
      { [sourceId(0)]: 2 }, { raw: true }),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  const winner = one.status === 200 ? one : two;
  const loser = one.status === 409 ? one : two;
  assert.equal(loser.body.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(loser.body.snapshot, winner.body.snapshot);
  assert.equal(winner.body.snapshot.version, before.version + 1);

  const authoritative = await snapshot(f.podId);
  assert.deepEqual(authoritative, winner.body.snapshot);
  assert.ok([1, 2].includes(seat(authoritative, 0).commanderCastCounts[sourceId(0)]));
});

live('changing 1 to 2 and back preserves A, initializes B at zero, and deletes B permanently', async () => {
  const f = await fixture([1, 1]);
  let state = await snapshot(f.podId);
  state = (await setCommanderCastCounts(f.podId, f.claims[0].connectionId,
    state.version, { [sourceId(0)]: 3 })).snapshot;
  state = (await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version, commanderCount: 2,
  })).snapshot;
  assertCast(state, 0, 'a', 3);
  assertCast(state, 0, 'b', 0);

  state = (await setCommanderCastCounts(f.podId, f.claims[0].connectionId,
    state.version, { [sourceId(0, 'b')]: 2 })).snapshot;
  state = (await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version, commanderCount: 1,
  })).snapshot;
  assertCast(state, 0, 'a', 3);
  assert.equal(sourceId(0, 'b') in seat(state, 0).commanderCastCounts, false);
  assert.equal(sourceId(0, 'b') in seat(state, 0).nextCommanderTax, false);

  state = (await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version, commanderCount: 2,
  })).snapshot;
  assertCast(state, 0, 'a', 3);
  assertCast(state, 0, 'b', 0);
});

live('reclaim preserves cast counts and reset zeros every active source', async () => {
  const f = await fixture([1, 2]);
  let state = await snapshot(f.podId);
  state = (await setCommanderCastCounts(f.podId, f.claims[1].connectionId,
    state.version, { [sourceId(1)]: 1, [sourceId(1, 'b')]: 2 })).snapshot;

  const reclaimed = await reclaimSeat(f.podId, 1, f.claims[1].reclaimToken);
  state = reclaimed.snapshot;
  assertCast(state, 1, 'a', 1);
  assertCast(state, 1, 'b', 2);

  const reset = await resetPod(f.podId, f.claims[0].connectionId, state.version);
  state = reset.snapshot;
  assert.deepEqual(state.seats.map(value => value.commanderCount), [1, 2]);
  assertCast(state, 0, 'a', 0);
  assertCast(state, 1, 'a', 0);
  assertCast(state, 1, 'b', 0);
});

live('SSE observers converge on the authoritative cast-count and tax snapshot', async () => {
  const f = await fixture([2, 1]);
  const streamA = await openSnapshotStream(f.podId, f.claims[0].connectionId);
  const streamB = await openSnapshotStream(f.podId, f.claims[1].connectionId);
  try {
    const [initialA, initialB] = await Promise.all([streamA.next(), streamB.next()]);
    assert.deepEqual(initialA, initialB);
    const nextA = streamA.next();
    const nextB = streamB.next();
    const accepted = await setCommanderCastCounts(
      f.podId,
      f.claims[0].connectionId,
      initialA.version,
      { [sourceId(0, 'b')]: 1 },
    );
    const [seenA, seenB, authoritative] = await Promise.all([
      nextA, nextB, snapshot(f.podId),
    ]);
    assert.deepEqual(seenA, accepted.snapshot);
    assert.deepEqual(seenB, accepted.snapshot);
    assert.deepEqual(authoritative, accepted.snapshot);
    assertCast(authoritative, 0, 'b', 1);
  } finally {
    await Promise.all([streamA.close(), streamB.close()]);
  }
});
