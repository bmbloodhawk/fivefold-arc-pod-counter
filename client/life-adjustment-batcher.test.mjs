import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeAdjustmentBatcher } from './life-adjustment-batcher.js';

test('shared life batches schedule and cancel timers with the browser receiver', (t) => {
  const callbacks = new Map();
  let nextTimer = 0;
  t.mock.method(globalThis, 'setTimeout', function (callback) {
    assert.ok(this == null || this === globalThis, 'invalid timer receiver');
    callbacks.set(++nextTimer, callback);
    return nextTimer;
  });
  t.mock.method(globalThis, 'clearTimeout', function (timer) {
    assert.ok(this == null || this === globalThis, 'invalid timer receiver');
    callbacks.delete(timer);
  });

  const sent = [];
  const batcher = new LifeAdjustmentBatcher({
    send: adjustment => sent.push(adjustment),
    operationId: () => 'test-operation',
  });
  batcher.add(-1);
  batcher.add(-1);
  assert.deepEqual([...callbacks.keys()], [2]);
  callbacks.get(2)();
  assert.deepEqual(sent, [{ delta: -2, operationId: 'test-operation' }]);
});

function createBatcher(send) {
  let nextOperation = 0;
  let nextTimer = 0;
  const timers = new Map();
  const batcher = new LifeAdjustmentBatcher({
    send,
    operationId: () => `operation-${++nextOperation}`,
    schedule: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    cancel: timer => timers.delete(timer),
  });
  return { batcher, timers };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

for (const [startingLife, inputs, expectedLife, expectedDeltas] of [
  [-999, [999, 1], 1, [999, 1]],
  [999, [-999, -1], -1, [-999, -1]],
  [-999, [999, 999, 999, 1], 999, [999, 999, 999, 1]],
  [999, [-999, -999, -999, -1], -999, [-999, -999, -999, -1]],
]) {
  test(`life burst ${inputs.join(',')} preserves the bounded total from ${startingLife}`, async () => {
    let life = startingLife;
    const sent = [];
    const { batcher } = createBatcher(adjustment => {
      assert.ok(Math.abs(adjustment.delta) <= 999, 'server rejects life deltas outside ±999');
      assert.ok(Number.isInteger(adjustment.delta));
      life = Math.max(-999, Math.min(999, life + adjustment.delta));
      sent.push(adjustment);
    });
    for (const delta of inputs) batcher.add(delta);
    await batcher.flush();
    assert.equal(life, expectedLife);
    assert.deepEqual(sent.map(({ delta }) => delta), expectedDeltas);
    assert.equal(new Set(sent.map(({ operationId }) => operationId)).size, sent.length);
  });
}

test('opposite life inputs cancel before sending and manual flush cancels its timer', async () => {
  const sent = [];
  const { batcher, timers } = createBatcher(adjustment => sent.push(adjustment));
  batcher.add(999);
  batcher.add(-999);
  assert.equal(await batcher.flush(), null);
  assert.equal(timers.size, 0);
  assert.deepEqual(sent, []);
  batcher.add(999);
  batcher.add(-998);
  await batcher.flush();
  assert.deepEqual(sent, [{ delta: 1, operationId: 'operation-1' }]);
});

test('flushes serialize their captured bursts while new inputs remain separately cancellable', async () => {
  const firstSend = deferred();
  const sent = [];
  const { batcher } = createBatcher(adjustment => {
    sent.push(adjustment);
    return sent.length === 1 ? firstSend.promise : { saved: true };
  });
  batcher.add(999);
  batcher.add(1);
  const firstFlush = batcher.flush();
  batcher.add(-2);
  const secondFlush = batcher.flush();
  batcher.add(5);
  batcher.add(-5);
  assert.equal(await batcher.flush(), null);
  assert.deepEqual(sent.map(({ delta }) => delta), [999]);
  firstSend.resolve({ saved: true });
  await Promise.all([firstFlush, secondFlush]);
  assert.deepEqual(sent.map(({ delta }) => delta), [999, 1, -2]);
  assert.equal(new Set(sent.map(({ operationId }) => operationId)).size, 3);
});

for (const outcome of ['blocked', 'locked', 'ignored', 'local', 'failed']) {
  test(`${outcome} stops unsent chunks and queued inputs without replay`, async () => {
    const firstSend = deferred();
    const sent = [];
    const { batcher, timers } = createBatcher(adjustment => {
      sent.push(adjustment);
      return firstSend.promise;
    });
    batcher.add(999);
    batcher.add(1);
    const firstFlush = batcher.flush();
    batcher.add(2);
    const secondFlush = batcher.flush();
    batcher.add(3);
    firstSend.resolve({ [outcome]: true });
    assert.deepEqual(await firstFlush, { [outcome]: true });
    await secondFlush;
    await batcher.flush();
    assert.deepEqual(sent.map(({ delta }) => delta), [999]);
    assert.equal(timers.size, 0);
  });
}

test('a lethal negative chunk stops when the game locks instead of replaying the remainder', async () => {
  let life = 40;
  let gamePlaying = true;
  const sent = [];
  const { batcher } = createBatcher(adjustment => {
    sent.push(adjustment);
    if (!gamePlaying) return { locked: true };
    life = Math.max(-999, life + adjustment.delta);
    if (life <= 0) gamePlaying = false;
    return { saved: true };
  });
  batcher.add(-999);
  batcher.add(-999);
  batcher.add(-1);
  await batcher.flush();
  assert.equal(life, -959);
  assert.deepEqual(sent.map(({ delta }) => delta), [-999, -999]);
  await batcher.flush();
  assert.equal(sent.length, 2, 'locked remainder must not be replayed');
});

for (const oldOutcome of [{ saved: true }, { locked: true }]) {
  test(`clear retires old work while a late ${Object.keys(oldOutcome)[0]} outcome preserves new inputs`, async () => {
    const firstSend = deferred();
    const sent = [];
    const { batcher } = createBatcher(adjustment => {
      sent.push(adjustment);
      return sent.length === 1 ? firstSend.promise : { saved: true };
    });
    batcher.add(999);
    batcher.add(1);
    const firstFlush = batcher.flush();
    batcher.add(2);
    const retiredFlush = batcher.flush();
    batcher.clear();
    batcher.add(7);
    const newFlush = batcher.flush();
    batcher.add(8);
    firstSend.resolve(oldOutcome);
    await Promise.all([firstFlush, retiredFlush, newFlush]);
    await batcher.flush();
    assert.deepEqual(sent.map(({ delta }) => delta), [999, 7, 8]);
  });
}

test('clear cancels pending timer work without sending it', async () => {
  const sent = [];
  const { batcher, timers } = createBatcher(adjustment => sent.push(adjustment));
  batcher.add(999);
  batcher.add(1);
  batcher.clear();
  assert.equal(timers.size, 0);
  assert.equal(await batcher.flush(), null);
  assert.deepEqual(sent, []);
});

test('a failed send drops its uncertain remainder and does not poison later healthy flushes', async () => {
  const firstSend = deferred();
  const sent = [];
  const { batcher } = createBatcher(adjustment => {
    sent.push(adjustment);
    return sent.length === 1 ? firstSend.promise : { saved: true };
  });
  batcher.add(999);
  batcher.add(1);
  const firstFlush = batcher.flush();
  const failed = assert.rejects(firstFlush, /connection lost/);
  batcher.add(2);
  const retiredFlush = batcher.flush();
  firstSend.reject(new Error('connection lost'));
  await failed;
  await retiredFlush;
  batcher.add(3);
  await batcher.flush();
  assert.deepEqual(sent.map(({ delta }) => delta), [999, 3]);
});
