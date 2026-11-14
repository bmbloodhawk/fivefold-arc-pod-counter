import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppearanceCatchUp } from './appearance-catch-up.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const notice = { id: 'restored', skins: [{ id: 'field-notes', name: 'Field Notes' }, { id: 'rosewood', name: 'Rosewood' }] };
function fixture(overrides = {}) {
  const shown = [], acknowledgements = [], closed = [];
  const controller = createAppearanceCatchUp({ getToken: async () => 'own-session', requestNotice: async () => notice,
    acknowledge: async (id, token) => { acknowledgements.push({ id, token }); },
    canShow: () => true, show: value => shown.push(value), close: () => closed.push(true), ...overrides });
  return { controller, shown, acknowledgements, closed };
}

test('all restored skins appear together once and are acknowledged only after dismissal', async () => {
  const f = fixture();
  await Promise.all([f.controller.check(), f.controller.check()]);
  assert.deepEqual(f.shown, [notice]);
  assert.deepEqual(f.acknowledgements, []);
  await f.controller.dismiss();
  assert.deepEqual(f.acknowledgements, [{ id: 'restored', token: 'own-session' }]);
  await f.controller.check();
  assert.equal(f.shown.length, 1);
});

test('a blocked game/modal does not consume the notice; the next profile visit can show it', async () => {
  let allowed = false;
  const f = fixture({ canShow: () => allowed });
  await f.controller.check();
  assert.equal(f.shown.length, 0);
  assert.equal(f.acknowledgements.length, 0);
  allowed = true;
  await f.controller.check();
  assert.equal(f.shown.length, 1);
});

test('switching accounts discards a delayed notice from the previous profile', async () => {
  const pending = deferred();
  const f = fixture({ requestNotice: () => pending.promise });
  const work = f.controller.check();
  await Promise.resolve();
  f.controller.reset(); pending.resolve(notice); await work;
  assert.equal(f.shown.length, 0);
  assert.equal(f.acknowledgements.length, 0);
});

test('sign-out closes a displayed notice without acknowledging it for another account', async () => {
  const f = fixture(); await f.controller.check();
  f.controller.reset(); await f.controller.dismiss();
  assert.equal(f.closed.length, 1);
  assert.equal(f.acknowledgements.length, 0);
});

test('a failed acknowledgement retries on the next profile visit without another popup in the same session', async () => {
  let attempts = 0;
  const f = fixture({ acknowledge: async () => { attempts++; if (attempts === 1) throw Error('Offline'); } });
  await f.controller.check(); await f.controller.dismiss(); await f.controller.check();
  assert.equal(attempts, 2);
  assert.equal(f.shown.length, 1);
});

test('a long-open notice uses the refreshed account token when its dismissal is saved', async () => {
  let token = 'before-expiry';
  const f = fixture({ getToken: async () => token });
  await f.controller.check(); token = 'refreshed-session'; await f.controller.dismiss();
  assert.deepEqual(f.acknowledgements, [{ id: 'restored', token: 'refreshed-session' }]);
});

test('sign-out during dismissal token refresh cannot acknowledge the notice for another profile', async () => {
  const refreshing = deferred(); let calls = 0;
  const f = fixture({ getToken: async () => ++calls === 1 ? 'first-session' : refreshing.promise });
  await f.controller.check(); const saving = f.controller.dismiss();
  f.controller.reset(); refreshing.resolve('next-profile'); await saving;
  assert.deepEqual(f.acknowledgements, []);
});

test('empty notices and failed reads leave profile/gameplay available', async () => {
  for (const result of [null, { id: 'empty', skins: [] }]) {
    const f = fixture({ requestNotice: async () => result }); await f.controller.check();
    assert.equal(f.shown.length, 0);
  }
  const f = fixture({ requestNotice: async () => { throw Error('Offline'); } });
  await f.controller.check(); assert.equal(f.shown.length, 0);
});
