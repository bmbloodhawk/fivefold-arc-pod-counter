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

live('create, join, and owner rename normalize names and converge over SSE', async () => {
  const created = await createPod({
    playerCount: 2,
    commanderCount: 1,
    name: '  A\u030Asta\t  Mage  ',
  });
  const joined = await claimSeat(created.podId, 1, {
    commanderCount: 2,
    name: '  Bob\n Smith  ',
  });
  let state = joined.snapshot;
  assert.deepEqual(state.seats.map(value => value.name), ['Åsta Mage', 'Bob Smith']);
  assert.deepEqual(state.commanderSources, [
    { id: sourceId(0), label: 'Åsta Mage', ownerSeatId: 0 },
    { id: sourceId(1), label: 'Bob Smith A', ownerSeatId: 1 },
    { id: sourceId(1, 'b'), label: 'Bob Smith B', ownerSeatId: 1 },
  ]);

  const hostStream = await openSnapshotStream(created.podId, created.connectionId);
  const playerStream = await openSnapshotStream(created.podId, joined.connectionId);
  try {
    const [initialHost, initialPlayer] = await Promise.all([hostStream.next(), playerStream.next()]);
    assert.deepEqual(initialHost, state);
    assert.deepEqual(initialPlayer, state);
    const nextHost = hostStream.next();
    const nextPlayer = playerStream.next();
    const renamed = await mutate(created.podId, joined.connectionId, {
      baseVersion: state.version,
      name: '  N\u0303ora   Prime  ',
    });
    const [seenHost, seenPlayer, authoritative] = await Promise.all([
      nextHost, nextPlayer, snapshot(created.podId),
    ]);
    state = renamed.snapshot;
    assert.equal(seat(state, 1).name, 'Ñora Prime');
    assert.deepEqual(seenHost, state);
    assert.deepEqual(seenPlayer, state);
    assert.deepEqual(authoritative, state);
  } finally {
    await Promise.all([hostStream.close(), playerStream.close()]);
  }
});

live('blank, non-text, overlong, control, and format names are rejected atomically', async t => {
  const invalidNames = [
    ['blank', '   \t\n  '],
    ['null', null],
    ['non-text', 7],
    ['25 code points', 'a'.repeat(25)],
    ['control character', 'A\u0007B'],
    ['format character', 'A\u200BB'],
  ];

  for (const [label, name] of invalidNames) {
    await t.test(`create rejects ${label}`, async () => {
      const rejected = await createPod({ playerCount: 2, name, raw: true });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error.code, 'INVALID_INPUT');
    });
  }

  await t.test('claim rejection does not reserve or mutate the seat', async () => {
    const created = await createPod({ playerCount: 2, name: 'Host' });
    const before = await snapshot(created.podId);
    for (const [, name] of invalidNames) {
      const rejected = await claimSeat(created.podId, 1, { name, raw: true });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error.code, 'INVALID_INPUT');
      assert.deepEqual(await snapshot(created.podId), before);
    }
    const valid = await claimSeat(created.podId, 1, { name: 'Valid' });
    assert.equal(seat(valid.snapshot, 1).name, 'Valid');
  });

  for (const [label, name] of invalidNames) {
    await t.test(`owner rename rejects ${label}`, async () => {
      const created = await createPod({ playerCount: 2, name: 'Stable' });
      const before = await snapshot(created.podId);
      const rejected = await mutate(created.podId, created.connectionId, {
        baseVersion: before.version,
        name,
      }, { raw: true });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error.code, 'INVALID_INPUT');
      assert.deepEqual(await snapshot(created.podId), before);
    });
  }
});

live('name length uses Unicode code points and permits printable Unicode, punctuation, emoji, and HTML-like text', async () => {
  const boundary = '😀'.repeat(24);
  const created = await createPod({ playerCount: 2, name: boundary });
  assert.equal(seat(created.snapshot, 0).name, boundary);

  const htmlLike = '<b>Ada</b>';
  const joined = await claimSeat(created.podId, 1, { name: htmlLike });
  assert.equal(seat(joined.snapshot, 1).name, htmlLike);
  assert.equal(joined.snapshot.commanderSources.find(source => source.ownerSeatId === 1).label, htmlLike);

  const tooLong = await createPod({ playerCount: 2, name: '😀'.repeat(25), raw: true });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error.code, 'INVALID_INPUT');
});

live('duplicate display names never replace stable seat and commander identity', async () => {
  const created = await createPod({ playerCount: 2, commanderCount: 2, name: 'Alex' });
  const joined = await claimSeat(created.podId, 1, { commanderCount: 2, name: 'Alex' });
  let state = joined.snapshot;
  assert.deepEqual(state.seats.map(value => value.name), ['Alex', 'Alex']);
  assert.deepEqual(state.commanderSources.map(source => [source.id, source.label, source.ownerSeatId]), [
    [sourceId(0), 'Alex A', 0],
    [sourceId(0, 'b'), 'Alex B', 0],
    [sourceId(1), 'Alex A', 1],
    [sourceId(1, 'b'), 'Alex B', 1],
  ]);

  state = (await setCommanderCastCounts(created.podId, joined.connectionId,
    state.version, { [sourceId(1, 'b')]: 2 })).snapshot;
  state = (await mutate(created.podId, created.connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [sourceId(1)]: 7 },
  })).snapshot;
  assert.equal(seat(state, 1).commanderCastCounts[sourceId(1, 'b')], 2);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(1)], 7);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(0)] === undefined, true,
    'duplicate names must not confuse own and opposing source IDs');
});

live('rename changes presentation only and preserves source IDs, ownership, damage, and casts', async () => {
  const created = await createPod({ playerCount: 2, name: 'Host' });
  const joined = await claimSeat(created.podId, 1, { commanderCount: 2, name: 'Before' });
  let state = joined.snapshot;
  state = (await setCommanderCastCounts(created.podId, joined.connectionId,
    state.version, { [sourceId(1)]: 1, [sourceId(1, 'b')]: 2 })).snapshot;
  state = (await mutate(created.podId, created.connectionId, {
    baseVersion: state.version,
    commanderDamageReceived: { [sourceId(1)]: 6, [sourceId(1, 'b')]: 3 },
  })).snapshot;
  const beforeSources = state.commanderSources.map(({ id, ownerSeatId }) => ({ id, ownerSeatId }));

  state = (await mutate(created.podId, joined.connectionId, {
    baseVersion: state.version,
    name: 'After',
  })).snapshot;
  assert.deepEqual(state.commanderSources.map(({ id, ownerSeatId }) => ({ id, ownerSeatId })), beforeSources);
  assert.deepEqual(state.commanderSources.filter(source => source.ownerSeatId === 1).map(source => source.label),
    ['After A', 'After B']);
  assert.deepEqual(seat(state, 1).commanderCastCounts,
    { [sourceId(1)]: 1, [sourceId(1, 'b')]: 2 });
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(1)], 6);
  assert.equal(seat(state, 0).commanderDamageReceived[sourceId(1, 'b')], 3);
});

live('omitted names fall back to P# and reclaim/reset preserve current names', async () => {
  const created = await createPod({ playerCount: 2 });
  const joined = await claimSeat(created.podId, 1, { commanderCount: 2 });
  let state = joined.snapshot;
  assert.deepEqual(state.seats.map(value => value.name), ['P1', 'P2']);
  assert.deepEqual(state.commanderSources.map(source => source.label), ['P1', 'P2 A', 'P2 B']);

  state = (await mutate(created.podId, joined.connectionId, {
    baseVersion: state.version,
    name: 'Current Name',
  })).snapshot;
  const reclaimed = await reclaimSeat(created.podId, 1, joined.reclaimToken);
  state = reclaimed.snapshot;
  assert.equal(seat(state, 1).name, 'Current Name');

  state = (await resetPod(created.podId, created.connectionId, state.version)).snapshot;
  assert.deepEqual(state.seats.map(value => value.name), ['P1', 'Current Name']);
  assert.deepEqual(state.commanderSources.filter(source => source.ownerSeatId === 1).map(source => source.label),
    ['Current Name A', 'Current Name B']);
});
