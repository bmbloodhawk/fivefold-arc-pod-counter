import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Competitions, scopePath } from '../src/competitions.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('simultaneous saves from domains sharing a store retain every same-Pod update in arrival order', async () => {
  const store = new MemoryAccountHistoryStore();
  const first = new Competitions({ store }), second = new Competitions({ store });
  const pod = await first.createPod('host', { name: 'Busy Pod', displayName: 'Host' });
  const update = store.update.bind(store), active = new Set();
  store.update = async (path, change) => {
    if (active.has(path)) throw Object.assign(new Error('Contending writer'), { code: 'HISTORY_BUSY' });
    active.add(path);
    try { await setImmediate(); return await update(path, change); }
    finally { active.delete(path); }
  };
  const responses = await Promise.allSettled(Array.from({ length: 64 }, (_, index) =>
    (index % 2 ? first : second).changeScope('pod', pod.id, scope => { scope.audit.push({ testSave: index }); })));
  assert.equal(responses.filter(row => row.status === 'rejected').length, 0);
  const saved = await first.readScope('pod', pod.id);
  assert.deepEqual(saved.audit.filter(row => 'testSave' in row).map(row => row.testSave), Array.from({ length: 64 }, (_, index) => index));
});

test('a stalled Pod save does not block another Pod, the directory or reads', { timeout: 5000 }, async t => {
  const store = new MemoryAccountHistoryStore(), domain = new Competitions({ store });
  const slow = await domain.createPod('host', { name: 'Slow', displayName: 'Host' });
  const other = await domain.createPod('host', { name: 'Other', displayName: 'Host' });
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const update = store.update.bind(store);
  store.update = async (path, change) => {
    if (path === scopePath('pod', slow.id)) { entered.resolve(); await release.promise; }
    return update(path, change);
  };
  const blocked = domain.changeScope('pod', slow.id, scope => { scope.name = 'Released'; });
  await entered.promise;
  const saved = await domain.changeScope('pod', other.id, scope => { scope.name = 'Independent'; });
  assert.equal(saved.name, 'Independent');
  await domain.changeDirectory(directory => { directory.testMarker = true; return directory; });
  assert.equal((await domain.directory()).testMarker, true);
  assert.equal((await domain.readScope('pod', slow.id)).name, 'Slow');
  release.resolve(); assert.equal((await blocked).name, 'Released');
});

test('one failed save does not poison later saves on the same Pod', async () => {
  const domain = new Competitions({ store: new MemoryAccountHistoryStore() });
  const pod = await domain.createPod('host', { name: 'Before', displayName: 'Host' });
  const rejected = assert.rejects(domain.changeScope('pod', pod.id, () => { throw new Error('Rejected save'); }), /Rejected save/);
  const next = domain.changeScope('pod', pod.id, scope => { scope.name = 'After'; });
  await rejected; assert.equal((await next).name, 'After');
  assert.equal((await domain.readScope('pod', pod.id)).name, 'After');
});

test('an explicit unchanged scope result preserves the version and stored evidence', async () => {
  const domain = new Competitions({ store: new MemoryAccountHistoryStore() });
  const pod = await domain.createPod('host', { name: 'Stable', displayName: 'Host' });
  const before = await domain.readScope('pod', pod.id);
  const after = await domain.changeScope('pod', pod.id, scope => { scope.name = 'Discarded'; return false; });
  assert.deepEqual(after, before);
  assert.deepEqual(await domain.readScope('pod', pod.id), before);
});
