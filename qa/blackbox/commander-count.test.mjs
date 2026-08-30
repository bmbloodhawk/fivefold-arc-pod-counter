import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enabled, createPod, claimSeat, reclaimSeat, snapshot, mutate, resetPod,
  openSnapshotStream,
} from './adapter.mjs';

const live = enabled ? test : test.skip;

const sourceId = (seatId, slot = 'a') => `seat-${seatId}-commander-${slot}`;

function seat(state, seatId) {
  const value = state.seats.find(candidate => candidate.seatId === seatId);
  assert.ok(value, `snapshot is missing seat ${seatId}`);
  return value;
}

function expectedSources(counts) {
  return counts.flatMap((count, seatId) => count === 1
    ? [{ id: sourceId(seatId), label: `P${seatId + 1}`, ownerSeatId: seatId }]
    : [
        { id: sourceId(seatId), label: `P${seatId + 1} A`, ownerSeatId: seatId },
        { id: sourceId(seatId, 'b'), label: `P${seatId + 1} B`, ownerSeatId: seatId },
      ]);
}

function assertCommanderShape(state, counts) {
  assert.deepEqual(state.commanderSources, expectedSources(counts));
  assert.deepEqual(state.seats.map(value => value.commanderCount), counts);
  for (const defender of state.seats) {
    const expectedIds = state.commanderSources
      .filter(source => source.ownerSeatId !== defender.seatId)
      .map(source => source.id)
      .sort();
    assert.deepEqual(Object.keys(defender.commanderDamageReceived).sort(), expectedIds,
      `P${defender.seatId + 1} must see exactly the other players' commander sources`);
  }
}

async function fixture(counts = [1, 1, 1]) {
  const created = await createPod({ playerCount: counts.length, commanderCount: counts[0] });
  const claims = {
    0: { connectionId: created.connectionId, reclaimToken: created.reclaimToken },
  };
  for (let seatId = 1; seatId < counts.length; seatId += 1) {
    claims[seatId] = await claimSeat(created.podId, seatId, { commanderCount: counts[seatId] });
  }
  return { ...created, claims };
}

live('commander source labels, stable IDs, ordering, and defender choices follow each seat count', async () => {
  const f = await fixture([1, 2, 1]);
  const state = await snapshot(f.podId);
  assertCommanderShape(state, [1, 2, 1]);
  assert.deepEqual(state.commanderSources.map(source => source.label), ['P1', 'P2 A', 'P2 B', 'P3']);
  assert.ok(Object.values(seat(state, 0).commanderDamageReceived).every(value => value === 0));
});

live('a defender can edit only damage received by their own seat, including a commander another player controls', async () => {
  const f = await fixture([1, 1]);
  let state = await snapshot(f.podId);
  const p1 = sourceId(0);
  const p2 = sourceId(1);

  const p2Update = await mutate(f.podId, f.claims[1].connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [p1]: 9 },
  });
  state = p2Update.snapshot;
  assert.equal(seat(state, 1).commanderDamageReceived[p1], 9);
  assert.equal(seat(state, 0).commanderDamageReceived[p2], 0);

  const p1Update = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [p2]: 4 },
  });
  state = p1Update.snapshot;
  assert.equal(seat(state, 1).commanderDamageReceived[p1], 9,
    'P1 write must not alter P2 damage received');

  const ownSource = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [p1]: 21 },
  }, { raw: true });
  assert.equal(ownSource.status, 200);
  assert.equal(ownSource.body.snapshot.seats[0].commanderDamageReceived[p1], 21);
  assert.equal(ownSource.body.snapshot.seats[1].commanderDamageReceived[p1], 9,
    'the defender-owned write must not alter another seat');
});

live('changing one commander to partners preserves A damage and adds B at zero for every defender', async () => {
  const f = await fixture([1, 1, 1]);
  let state = await snapshot(f.podId);
  const seeded = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [sourceId(1)]: 8, [sourceId(2)]: 5 },
  });
  const expanded = await mutate(f.podId, f.claims[1].connectionId, {
    baseVersion: seeded.snapshot.version,
    commanderCount: 2,
  });
  state = expanded.snapshot;

  assertCommanderShape(state, [1, 2, 1]);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(1)], 8);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(1, 'b')], 0);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(2)], 5,
    'adding P2 B must not disturb damage from P3');
  assert.equal(seat(state, 2).commanderDamageReceived[sourceId(1, 'b')], 0);
});

live('changing partners to one commander removes B deterministically without corrupting other damage', async () => {
  const f = await fixture([1, 2, 1]);
  let state = await snapshot(f.podId);
  const seeded = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: {
      [sourceId(1)]: 6,
      [sourceId(1, 'b')]: 10,
      [sourceId(2)]: 4,
    },
  });
  const collapsed = await mutate(f.podId, f.claims[1].connectionId, {
    baseVersion: seeded.snapshot.version,
    commanderCount: 1,
  });
  state = collapsed.snapshot;

  assertCommanderShape(state, [1, 1, 1]);
  assert.equal(state.commanderSources.some(source => source.id === sourceId(1, 'b')), false);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(1)], 6);
  assert.equal(sourceId(1, 'b') in seat(state, 0).commanderDamageReceived, false);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(2)], 4,
    'removing P2 B must not shift or delete P3 damage');
});

live('all connected clients receive the same commander-count change', async () => {
  const f = await fixture([1, 1]);
  const streamA = await openSnapshotStream(f.podId, f.claims[0].connectionId);
  const streamB = await openSnapshotStream(f.podId, f.claims[1].connectionId);
  try {
    const [initialA, initialB] = await Promise.all([streamA.next(), streamB.next()]);
    assert.deepEqual(initialA, initialB);
    const fromA = streamA.next();
    const fromB = streamB.next();
    const changed = await mutate(f.podId, f.claims[1].connectionId, {
      baseVersion: initialA.version,
      commanderCount: 2,
    });
    const [seenA, seenB, authoritative] = await Promise.all([fromA, fromB, snapshot(f.podId)]);
    assert.deepEqual(seenA, changed.snapshot);
    assert.deepEqual(seenB, changed.snapshot);
    assert.deepEqual(authoritative, changed.snapshot);
    assertCommanderShape(authoritative, [1, 2]);
  } finally {
    await Promise.all([streamA.close(), streamB.close()]);
  }
});

live('reclaim preserves commander count and rejects a mismatched declaration', async () => {
  const f = await fixture([1, 2]);
  const original = f.claims[1];
  const reclaimed = await reclaimSeat(f.podId, 1, original.reclaimToken);
  assert.equal(seat(reclaimed.snapshot, 1).commanderCount, 2);
  assertCommanderShape(reclaimed.snapshot, [1, 2]);

  const mismatch = await reclaimSeat(f.podId, 1, original.reclaimToken, {
    commanderCount: 1,
    raw: true,
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, 'COMMANDER_COUNT_MISMATCH');
  assert.equal(seat(await snapshot(f.podId), 1).commanderCount, 2);
});

live('reset zeros dynamic commander damage but preserves every seat commander count', async () => {
  const f = await fixture([2, 1, 2]);
  let state = await snapshot(f.podId);
  const damaged = await mutate(f.podId, f.claims[0].connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [sourceId(1)]: 20, [sourceId(2, 'b')]: 7 },
  });
  const reset = await resetPod(f.podId, f.claims[0].connectionId, damaged.snapshot.version);
  state = reset.snapshot;

  assertCommanderShape(state, [2, 1, 2]);
  for (const defender of state.seats) {
    assert.ok(Object.values(defender.commanderDamageReceived).every(value => value === 0));
  }
});

live('simultaneous commander configuration and damage writes conflict cleanly, then converge on retry', async () => {
  const f = await fixture([1, 1]);
  const before = await snapshot(f.podId);
  const configure = { baseVersion: before.version, commanderCount: 2 };
  const damage = {
    baseVersion: before.version,
    commanderDamageReceived: { [sourceId(1)]: 9 },
  };
  const [configurationResult, damageResult] = await Promise.all([
    mutate(f.podId, f.claims[1].connectionId, configure, { raw: true }),
    mutate(f.podId, f.claims[0].connectionId, damage, { raw: true }),
  ]);

  assert.deepEqual([configurationResult.status, damageResult.status].sort(), [200, 409]);
  const loser = configurationResult.status === 409 ? configurationResult : damageResult;
  let authoritative = await snapshot(f.podId);
  assert.equal(loser.body.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(loser.body.snapshot, authoritative);
  assert.equal(authoritative.version, before.version + 1);

  if (configurationResult.status === 409) {
    authoritative = (await mutate(f.podId, f.claims[1].connectionId, {
      ...configure,
      baseVersion: authoritative.version,
    })).snapshot;
  } else {
    authoritative = (await mutate(f.podId, f.claims[0].connectionId, {
      ...damage,
      baseVersion: authoritative.version,
    })).snapshot;
  }

  assertCommanderShape(authoritative, [1, 2]);
  assert.equal(seat(authoritative, 0).commanderDamageReceived[sourceId(1)], 9);
  assert.equal(seat(authoritative, 0).commanderDamageReceived[sourceId(1, 'b')], 0);
});

live('commanderCount accepts only 1 or 2 and rejected updates do not mutate the room', async t => {
  for (const invalid of [0, 3]) {
    await t.test(`rejects ${invalid} when creating the host seat`, async () => {
      const result = await createPod({ playerCount: 2, commanderCount: invalid, raw: true });
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'INVALID_INPUT');
    });
  }

  await t.test('rejects an invalid count on first claim without reserving the seat', async () => {
    const created = await createPod({ playerCount: 2 });
    const before = await snapshot(created.podId);
    const rejected = await claimSeat(created.podId, 1, { commanderCount: 0, raw: true });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error.code, 'INVALID_INPUT');
    assert.deepEqual(await snapshot(created.podId), before);
    const valid = await claimSeat(created.podId, 1, { commanderCount: 2 });
    assert.equal(seat(valid.snapshot, 1).commanderCount, 2,
      'the rejected attempt must not reserve or partially configure the seat');
  });

  for (const invalid of [0, 3, -1, 1.5, '2', null]) {
    await t.test(`rejects ${JSON.stringify(invalid)}`, async () => {
      const f = await fixture([1, 1]);
      const before = await snapshot(f.podId);
      const result = await mutate(f.podId, f.claims[0].connectionId, {
        baseVersion: before.version,
        commanderCount: invalid,
      }, { raw: true });
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'INVALID_INPUT');
      assert.deepEqual(await snapshot(f.podId), before);
    });
  }
});
