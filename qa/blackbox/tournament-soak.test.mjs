import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enabled, createPod, claimSeat, reclaimSeat, mutate, openSnapshotStream,
  roomAction, snapshot,
} from './adapter.mjs';

const live = enabled ? test : test.skip;
const TABLE_COUNT = 4;
const PLAYERS_PER_TABLE = 4;

async function createTable(tableIndex) {
  const host = await createPod({
    playerCount: PLAYERS_PER_TABLE,
    name: `Table ${tableIndex + 1} host`,
  });
  const claims = [{ connectionId: host.connectionId, reclaimToken: host.reclaimToken }];
  for (let seatId = 1; seatId < PLAYERS_PER_TABLE; seatId += 1) {
    claims.push(await claimSeat(host.podId, seatId, { name: `T${tableIndex + 1}P${seatId + 1}` }));
  }
  return { ...host, claims };
}

async function nextAtLeast(stream, version) {
  let received;
  do received = await stream.next(); while (received.version < version);
  return received;
}

live('tournament soak: four four-player tables coexist, converge, hand off, and reclaim', async () => {
  const tables = await Promise.all(Array.from({ length: TABLE_COUNT }, (_, index) => createTable(index)));
  const streamGroups = await Promise.all(tables.map(table => Promise.all(
    table.claims.map(claim => openSnapshotStream(table.podId, claim.connectionId)),
  )));

  try {
    // All 16 phones share one localhost address here, matching a venue Wi-Fi NAT.
    await Promise.all(streamGroups.flat().map(stream => stream.next()));

    await Promise.all(tables.map(async table => {
      let state = await snapshot(table.podId);
      state = (await roomAction(table.podId, table.claims[0].connectionId, 'choose-starting-player', {
        baseVersion: state.version, startingSeatId: 0,
      })).snapshot;
      await roomAction(table.podId, table.claims[0].connectionId, 'start-game', { baseVersion: state.version });
    }));

    await Promise.all(tables.map(async (table, index) => {
      let state = await snapshot(table.podId);
      state = (await mutate(table.podId, table.claims[index].connectionId, {
        baseVersion: state.version,
        counters: { life: 40 - (index + 1), poison: index },
      })).snapshot;
      const activeSeatId = state.turn.activeSeatId;
      await roomAction(table.podId, table.claims[activeSeatId].connectionId, 'turn-handoff', {
        baseVersion: state.version,
      });
    }));

    const reclaimTable = tables[1];
    const priorClaim = reclaimTable.claims[2];
    reclaimTable.claims[2] = await reclaimSeat(reclaimTable.podId, 2, priorClaim.reclaimToken);
    // Reclaim deliberately closes the stale stream; model the returning phone
    // by subscribing with its replacement connection before checking convergence.
    streamGroups[1][2] = await openSnapshotStream(reclaimTable.podId, reclaimTable.claims[2].connectionId);
    const expected = await Promise.all(tables.map(table => snapshot(table.podId)));

    await Promise.all(streamGroups.flatMap((streams, tableIndex) => streams.map(async stream => {
      const received = await nextAtLeast(stream, expected[tableIndex].version);
      assert.deepEqual(received, expected[tableIndex]);
    })));

    for (const [tableIndex, state] of expected.entries()) {
      assert.equal(state.seats[tableIndex].counters.life, 40 - (tableIndex + 1));
      assert.equal(state.seats[tableIndex].counters.poison, tableIndex);
      assert.equal(state.turn.activeSeatId, 1, `table ${tableIndex + 1} should hand off from its host`);
    }
    assert.notEqual(reclaimTable.claims[2].connectionId, priorClaim.connectionId);
  } finally {
    await Promise.all(streamGroups.flat().map(stream => stream.close()));
  }
});
