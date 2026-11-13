import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyedWriteQueue } from '../src/keyed-write-queue.js';

const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('an independent Table progresses while another Table is blocked', { timeout: 2000 }, async (t) => {
  const queue = new KeyedWriteQueue({ concurrency: 2 }), blocked = gate(), completed = [];
  t.after(blocked.release);
  const first = queue.enqueue('room_A', async () => { await blocked.promise; completed.push('A'); });
  await queue.enqueue('room_B', () => completed.push('B'));
  assert.deepEqual(completed, ['B']);
  blocked.release(); await first; await queue.flush();
  assert.deepEqual(completed, ['B', 'A']);
});

test('each Table retains FIFO order through a rejected or synchronous failing write', async () => {
  const queue = new KeyedWriteQueue(), completed = [];
  const first = queue.enqueue('room_A', async () => { await tick(); completed.push(1); });
  const failed = assert.rejects(queue.enqueue('room_A', () => { completed.push(2); throw new Error('fixture failure'); }), /fixture failure/);
  const last = queue.enqueue('room_A', () => completed.push(3));
  await Promise.all([first, failed, last]); await queue.flush();
  assert.deepEqual(completed, [1, 2, 3]);
});

test('writes across many Tables never exceed the configured concurrency', async (t) => {
  const queue = new KeyedWriteQueue({ concurrency: 3 }), blocked = gate();
  t.after(blocked.release);
  let running = 0, peak = 0, started = 0;
  const jobs = Array.from({ length: 12 }, (_, index) => queue.enqueue(`room_${index}`, async () => {
    started++; running++; peak = Math.max(peak, running); await blocked.promise; running--;
  }));
  await tick(); assert.equal(started, 3);
  blocked.release(); await Promise.all(jobs); await queue.flush();
  assert.equal(started, 12); assert.equal(peak, 3); assert.equal(running, 0);
});

test('a busy Table goes behind independent Tables already waiting for a slot', async (t) => {
  const queue = new KeyedWriteQueue({ concurrency: 1 }), blocked = gate(), completed = [];
  t.after(blocked.release);
  queue.enqueue('room_A', async () => { await blocked.promise; completed.push('A1'); });
  queue.enqueue('room_A', () => completed.push('A2'));
  queue.enqueue('room_B', () => completed.push('B1'));
  queue.enqueue('room_A', () => completed.push('A3'));
  blocked.release(); await queue.flush();
  assert.deepEqual(completed, ['A1', 'B1', 'A2', 'A3']);
});

test('flush waits for admitted work without waiting for future Table writes', { timeout: 2000 }, async (t) => {
  const queue = new KeyedWriteQueue({ concurrency: 1 }), first = gate(), later = gate();
  t.after(() => { first.release(); later.release(); });
  let lateFinished = false;
  queue.enqueue('room_A', () => first.promise);
  const flushed = queue.flush();
  const late = queue.enqueue('room_A', async () => { await later.promise; lateFinished = true; });
  first.release(); await flushed;
  assert.equal(lateFinished, false);
  later.release(); await late; await queue.flush();
  assert.equal(lateFinished, true);
});

test('invalid scheduling limits or jobs are rejected before running work', () => {
  for (const concurrency of [0, -1, 33, 1.5, '2']) assert.throws(() => new KeyedWriteQueue({ concurrency }), /concurrency/i);
  const queue = new KeyedWriteQueue();
  assert.throws(() => queue.enqueue('', () => {}), /key/i);
  assert.throws(() => queue.enqueue('room_A', null), /function/i);
});
