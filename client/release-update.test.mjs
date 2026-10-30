import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseUpdatePresentation, refreshIsAllowed, watchForReleaseUpdate } from './release-update.js';

test('a waiting release stays deferred during active or reconnecting play', () => {
  assert.deepEqual(releaseUpdatePresentation({ waiting: true, lifecycle: 'playing', connectionStatus: 'connected' }), {
    kind: 'deferred',
    message: 'An update is ready and will wait until this game is over.'
  });
  assert.equal(refreshIsAllowed({ lifecycle: 'playing', connectionStatus: 'connected' }), false);
  assert.equal(refreshIsAllowed({ lifecycle: 'intermission', connectionStatus: 'reconnecting' }), false);
  assert.deepEqual(releaseUpdatePresentation({ waiting: true, lifecycle: 'complete', connectionStatus: 'connected' }), {
    kind: 'deferred',
    message: 'An update is ready. Review the result, then move to next-game setup.'
  });
});

test('a waiting release can be refreshed only at a confirmed safe boundary', () => {
  assert.deepEqual(releaseUpdatePresentation({ waiting: true, lifecycle: 'intermission', connectionStatus: 'connected' }), {
    kind: 'ready',
    message: 'This game is complete. Refresh when you are ready to use the update.'
  });
  assert.equal(refreshIsAllowed({ lifecycle: 'intermission', connectionStatus: 'connected' }), true);
  assert.equal(refreshIsAllowed({ lifecycle: 'lobby', connectionStatus: 'connected' }), true);
  assert.equal(refreshIsAllowed({ lifecycle: null, connectionStatus: 'idle' }), true);
  assert.deepEqual(releaseUpdatePresentation({ waiting: true, lifecycle: null, connectionStatus: 'idle' }), {
    kind: 'ready',
    message: 'A new version is ready. Refresh when convenient.'
  });
});

test('no waiting worker means no update notice', () => {
  assert.deepEqual(releaseUpdatePresentation({ waiting: false, lifecycle: 'playing', connectionStatus: 'connected' }), { kind: 'hidden', message: '' });
});

test('the coordinator refuses to reload a playing table even when a worker is waiting', async () => {
  const registration = new EventTarget();
  registration.waiting = { state: 'installed' };
  const serviceWorker = { register: async () => registration };
  const controller = await watchForReleaseUpdate({ serviceWorker, onChange: () => {} });
  let reloads = 0;

  assert.equal(controller.refreshAtSafeBoundary({ lifecycle: 'playing', connectionStatus: 'connected', reload: () => { reloads += 1; } }), false);
  assert.equal(reloads, 0);
  assert.equal(controller.refreshAtSafeBoundary({ lifecycle: 'intermission', connectionStatus: 'connected', reload: () => { reloads += 1; } }), true);
  assert.equal(reloads, 1);
});
