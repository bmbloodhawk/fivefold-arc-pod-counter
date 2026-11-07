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
