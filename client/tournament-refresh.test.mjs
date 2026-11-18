import assert from 'node:assert/strict';
import test from 'node:test';
import { createTournamentRefresh } from './tournament-refresh.mjs';

function clock() {
  const tasks = new Map(); let id = 0;
  return { setTimeout(fn, ms) { tasks.set(++id, { fn, ms }); return id; }, clearTimeout(id) { tasks.delete(id); },
    tasks, async tick() { const task = tasks.values().next().value; tasks.clear(); if (task) await task.fn(); } };
}

test('visible event polling waits fifteen seconds, never overlaps, and stops on navigation', async () => {
  const timer = clock(); let visible = true, calls = 0, finish;
  const refresh = createTournamentRefresh({ timer, visible: () => visible });
  refresh.start(async () => { calls++; await new Promise(resolve => { finish = resolve; }); });
  assert.equal(timer.tasks.values().next().value.ms, 15000);
  const pending = timer.tick(); assert.equal(calls, 1); assert.equal(timer.tasks.size, 0);
  refresh.stop(); finish(); await pending; assert.equal(timer.tasks.size, 0);
});

test('hidden screens pause and resume polling without catch-up bursts', async () => {
  const timer = clock(); let visible = false, calls = 0;
  const refresh = createTournamentRefresh({ timer, visible: () => visible });
  refresh.start(async () => { calls++; }); assert.equal(timer.tasks.size, 0);
  visible = true; refresh.visibilityChanged(); assert.equal(timer.tasks.size, 1);
  await timer.tick(); assert.equal(calls, 1); assert.equal(timer.tasks.size, 1);
  visible = false; refresh.visibilityChanged(); assert.equal(timer.tasks.size, 0);
});

test('errors stop polling until an explicit new refresh view is started', async () => {
  const timer = clock(); let errors = 0;
  const refresh = createTournamentRefresh({ timer, visible: () => true });
  refresh.start(async () => { throw new Error('revoked'); }, () => { errors++; });
  await timer.tick(); assert.equal(errors, 1); assert.equal(timer.tasks.size, 0);
  refresh.visibilityChanged(); assert.equal(timer.tasks.size, 0);
});

test('opening a new event while an old refresh finishes starts the new view schedule', async () => {
  const timer = clock(); let finish, calls = 0;
  const refresh = createTournamentRefresh({ timer, visible: () => true });
  refresh.start(async () => { await new Promise(resolve => { finish = resolve; }); });
  const old = timer.tick();
  refresh.stop(); refresh.start(async () => { calls++; });
  finish(); await old;
  assert.equal(timer.tasks.size, 1);
  await timer.tick(); assert.equal(calls, 1);
});
