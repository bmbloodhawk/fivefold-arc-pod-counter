import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPod,
  createPodWithConnection,
  enabled,
  newConnection,
  reclaimSeat,
  snapshot,
} from './adapter.mjs';

test('returning to setup requires a fresh connection and leaves the old room safe', { skip: !enabled }, async () => {
  const first = await createPod({ playerCount: 2, name: 'First host' });
  const firstBefore = await snapshot(first.podId);

  const reused = await createPodWithConnection(first.connectionId, {
    playerCount: 4,
    name: 'Second host',
    raw: true,
  });
  assert.equal(reused.status, 409);
  assert.equal(reused.body?.error?.code, 'CONNECTION_HAS_SEAT');

  const firstAfterRejectedReuse = await snapshot(first.podId);
  assert.deepEqual(firstAfterRejectedReuse, firstBefore, 'rejected reuse must not mutate the old room');

  const fresh = await newConnection();
  const second = await createPodWithConnection(fresh.connectionId, {
    playerCount: 4,
    name: 'Second host',
  });
  assert.notEqual(second.podId, first.podId);
  assert.equal(second.snapshot.seats[0].name, 'Second host');
  assert.equal(second.snapshot.seats.length, 4);

  const firstAfterFreshCreate = await snapshot(first.podId);
  assert.deepEqual(firstAfterFreshCreate, firstBefore, 'creating a new pod must not overwrite the old room');

  const reclaimed = await reclaimSeat(first.podId, 0, first.reclaimToken);
  assert.equal(reclaimed.snapshot.code, first.podId);
  assert.equal(reclaimed.snapshot.seats[0].claimed, true);
  assert.equal(reclaimed.snapshot.seats[0].name, 'First host');
  assert.deepEqual(reclaimed.snapshot.seats[0].counters, firstBefore.seats[0].counters);
});
