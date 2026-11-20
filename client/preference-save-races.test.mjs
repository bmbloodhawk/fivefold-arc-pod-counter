import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('async function saveAccountPreferences('), app.indexOf('async function removeAccountItem('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const token = deferred(), response = deferred(), body = deferred(), entered = deferred();
  const element = value => ({ value, checked: true, textContent: '' });
  const context = createContext({ awardProfileEpoch: 0, preferenceSaveAttempt: 0,
    accountPreferredName: element('Alice'), accountDefaultPlayerCount: element('4'), accountDefaultRoundLimit: element('60'),
    interfaceStyle: 'dial', accountPersonalSkin: element('skin_A'), accountUsePersonalSkin: element(''),
    accountPreferences: null, myGamesStatus: element(''), dom: { createName: element(''), joinName: element('') },
    currentAccountToken: () => token.promise, requests: [], appearanceCalls: 0,
    applySelectedAppearance() { context.appearanceCalls++; },
    fetch(url, options) { context.requests.push({ url, ...options }); entered.resolve(); return response.promise; },
  });
  runInContext(source, context);
  const retire = () => { context.awardProfileEpoch++; context.accountPreferences = null; context.myGamesStatus.textContent = 'Current profile'; };
  const ok = () => response.resolve({ ok: true, json: () => body.promise });
  return { context, token, response, body, entered, retire, ok };
}
test('a delayed preferences token cannot send after the account changes', async () => {
  const f = fixture(), saving = f.context.saveAccountPreferences(); f.retire(); f.token.resolve('token_A');
  f.ok(); f.body.resolve({ preferences: { preferredName: 'Alice' } }); await saving;
  assert.equal(f.context.requests.length, 0);
});
for (const boundary of ['response', 'json']) test(`a preferences ${boundary} after logout cannot restore the prior name or skin`, async () => {
  const f = fixture(), saving = f.context.saveAccountPreferences(); f.token.resolve('token_A'); await f.entered.promise;
  if (boundary === 'json') { f.ok(); await new Promise(resolve => setImmediate(resolve)); }
  f.retire(); f.ok(); f.body.resolve({ preferences: { preferredName: 'Alice', personalSkinId: 'skin_A' } }); await saving;
  assert.equal(f.context.accountPreferences, null); assert.equal(f.context.dom.createName.value, '');
  assert.equal(f.context.dom.joinName.value, ''); assert.equal(f.context.appearanceCalls, 0);
  assert.equal(f.context.myGamesStatus.textContent, 'Current profile');
});
test('preferences submit the captured draft while token acquisition is pending', async () => {
  const f = fixture(), saving = f.context.saveAccountPreferences();
  f.context.accountPreferredName.value = 'Later draft'; f.context.accountDefaultPlayerCount.value = '8';
  f.token.resolve('token_A'); await f.entered.promise; f.ok(); f.body.resolve({ preferences: { preferredName: 'Alice' } }); await saving;
  assert.equal(JSON.parse(f.context.requests[0].body).preferredName, 'Alice');
  assert.equal(JSON.parse(f.context.requests[0].body).defaultPlayerCount, 4);
});
test('current successful preferences still prefill empty names and apply appearance', async () => {
  const f = fixture(), saving = f.context.saveAccountPreferences(); f.token.resolve('token_A'); await f.entered.promise;
  f.ok(); f.body.resolve({ preferences: { preferredName: 'Alice' } }); await saving;
  assert.equal(f.context.dom.createName.value, 'Alice'); assert.equal(f.context.dom.joinName.value, 'Alice');
  assert.equal(f.context.appearanceCalls, 1); assert.match(f.context.myGamesStatus.textContent, /Saved/);
});
test('a retired failed request cannot replace the current profile status', async () => {
  const f = fixture(), saving = f.context.saveAccountPreferences(); f.token.resolve('token_A'); await f.entered.promise;
  f.retire(); f.response.reject(new Error('Old network failure')); await saving;
  assert.equal(f.context.myGamesStatus.textContent, 'Current profile');
});
