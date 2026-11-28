import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, Script } from 'node:vm';
import { mountExplorationCommission } from './exploration-commission.js';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `Actual app function ${name} must exist.`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Find complete function, including template expressions. */ }
  }
  assert.fail(`Complete app function ${name} was not found.`);
}
const restore = sourceFunction('restoreSavedAccountSession');
const from = app.indexOf(restore) + restore.length;
const source = app.slice(from, app.indexOf('async function showMyDecks(', from))
  + '\n' + sourceFunction('openSignIn') + '\n' + sourceFunction('openMyProfile');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const history = wins => ({ wins, gamesPlayed: wins + 1, winRate: 0, thisMonth: {},
  games: [], milestones: [], achievements: [], deckStats: [{ name: 'Fixture deck', wins: 0, gamesPlayed: 1 }] });
const settingsNames = ['accountPreferredNameField', 'accountDefaultPlayerCountField', 'accountDefaultRoundLimitField',
  'accountInterfaceStyleField', 'accountPersonalSkinField', 'accountUsePersonalSkinField', 'saveAccountPreferencesButton',
  'exportAccountButton', 'deleteAccountButton', 'signOutButton'];
const authNames = ['myGamesSignInButton', 'emailSignInButton', 'emailSignInFields', 'forgotPasswordButton', 'createAccountButton'];

test('the profile shows individual achievement progress without relocking a previously owned skin', () => {
  const context = createContext();
  runInContext(sourceFunction('escapeHtml') + '\n' + sourceFunction('skinRewardRowHtml'), context);
  const skin = { name: 'Prismatic Confluence', state: 'locked', achievement: { detail: 'One achievement' } };
  assert.match(context.skinRewardRowHtml(skin), /One achievement/);
  const progress = ['Color Wheel', 'Trusted Blade', 'Full Armory', 'Ten Crowns', 'Seasoned']
    .map((title, index) => ({ title, earned: index < 2 }));
  const row = context.skinRewardRowHtml({ ...skin, progress });
  assert.match(row, /2 of 5 achievements/);
  assert.equal((row.match(/class="earned"/g) || []).length, 2);
  assert.equal((row.match(/Still to earn/g) || []).length, 3);
  const priorOwner = context.skinRewardRowHtml({ ...skin, state: 'unlocked', progress });
  assert.match(priorOwner, /Unlocked/);
  assert.doesNotMatch(priorOwner, /of 5|Still to earn/);
});

function fixture({ holdTokens = false } = {}) {
  const tokens = [], histories = [], preferences = [], modalFrames = [];
  const fields = {};
  let context, latestLoad;
  function element(text = '') {
    const listeners = new Map(), attributes = new Map();
    return { hidden: false, disabled: false, textContent: text, value: '', checked: false, dataset: {},
      children: [], append(...children) { this.children.push(...children); }, querySelector() { return null; },
      classList: { replace() {} },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
      dispatch(type) { for (const callback of listeners.get(type) || []) callback({ currentTarget: this }); },
      click() { this.dispatch('click'); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      toggleAttribute(name, value) { if (value) attributes.set(name, ''); else attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      replaceChildren(text) { this.textContent = text; },
      focus() { if (context) context.document.activeElement = this; },
    };
  }
  for (const name of [...settingsNames, ...authNames, 'accountSkinRewards', 'accountPreferredName',
    'accountDefaultPlayerCount', 'accountDefaultRoundLimit', 'accountPersonalSkin', 'accountUsePersonalSkin', 'accountPassword']) fields[name] = element();
  fields.accountPassword.value = 'PRIOR_SIGNIN_PASSWORD';
  const title = element('Sign in'), status = element('Prior sign-in status'), closeButton = element('Close');
  const content = { ...element(), hidden: true, sections: [], tabs: [], _html: '',
    set innerHTML(value) {
      this._html = value; this.tabs = [];
      this.sections = [...value.matchAll(/<section><h3>([^<]*)<\/h3>/g)].map(match => {
        const heading = element(match[1]), paragraph = element();
        return { ...element(), querySelector: selector => selector === 'h3' ? heading : selector === 'p' ? paragraph : null,
          insertAdjacentHTML() {} };
      });
    },
    get innerHTML() { return this._html; },
    querySelector(selector) { return selector === ':scope > section:nth-of-type(2)' ? this.sections[1] : null; },
    querySelectorAll(selector) { return selector === ':scope > section' ? this.sections : selector === '[data-profile-tab]' ? this.tabs : []; },
    insertAdjacentHTML(position, value) {
      if (!value.includes('data-profile-tab')) return;
      this.tabs = [...value.matchAll(/<button[^>]*data-profile-tab="([^"]*)"[^>]*>([^<]*)<\/button>/g)]
        .map(match => {
          const tab = { ...element(match[2]), dataset: { profileTab: match[1] } };
          const current = /aria-current="([^"]*)"/.exec(match[0]);
          if (current) tab.setAttribute('aria-current', current[1]);
          return tab;
        });
    },
  };
  const snapshot = () => ({ open: dialog.open, title: title.textContent, status: status.textContent,
    contentHidden: content.hidden, content: content.innerHTML,
    auth: Object.fromEntries(authNames.map(name => [name, fields[name].hidden])),
    settings: Object.fromEntries(settingsNames.map(name => [name, fields[name].hidden])),
    skinRewardsHidden: fields.accountSkinRewards.hidden, password: fields.accountPassword.value,
    closeDisabled: closeButton.disabled });
  const dialog = { ...element(), open: false,
    showModal() { this.open = true; modalFrames.push(snapshot()); },
    close() { this.open = false; this.dispatch('close'); },
    querySelector(selector) { return selector === '#myGamesTitle' ? title : closeButton; },
    querySelectorAll() { return [...Object.values(fields), closeButton]; },
  };
  const fetchGate = list => {
    const request = deferred();
    list.push({ ...request, respond(body, { ok = true, json } = {}) { request.resolve({ ok, json: json || (async () => body) }); } });
    return request.promise;
  };
  context = createContext({ ...fields, awardProfileEpoch: 0,
    myGamesDialog: dialog, myGamesContent: content, myGamesStatus: status,
    myGamesTitle: title, profileRequestGeneration: 0, profileLoadAttempt: 0,
    pendingSignInReturn: null, joinStep: 2, registration: { pending: false },
    currentAccountToken() { const token = deferred(); tokens.push(token); if (!holdTokens) token.resolve('fixture-account'); return token.promise; },
    fetch(url) { if (url === '/api/account/history') return fetchGate(histories); if (url === '/api/account/preferences') return fetchGate(preferences); throw new Error(`Unexpected profile API: ${url}`); },
    accountSkinChoices: [], accountPreferences: null,
    applyAccountPreferences(value, skins = []) { context.accountPreferences = value; context.accountSkinChoices = skins; fields.accountPreferredName.value = value.preferredName || ''; },
    homeRenders: [], renderHomeAccount(value) { context.homeRenders.push(value); },
    loadSetupDecks: async () => {}, appearanceCatchUp: { check() {} },
    mountExplorationCommission,
    dom: { createName: element(), joinName: element(), roundLimitMinutes: element() },
    $: () => element(), $$: () => [], escapeHtml: value => String(value),
    document: { activeElement: null, createElement: () => element() }, window: { scrollTo() {} },
  });
  runInContext(source, context);
  const actualShow = context.showMyGames;
  context.showMyGames = (...args) => { latestLoad = actualShow(...args); return latestLoad; };
  return { context, title, status, content, fields, closeButton, dialog, tokens, histories, preferences, modalFrames, snapshot,
    open() { context.openMyProfile(); return latestLoad; },
    async historyReady(index = 0, wins = 1) { await settle(); histories[index].respond({ history: history(wins) }); await settle(); },
    async complete(index = 0, name = 'Fixture profile') { preferences[index].respond({ preferences: { preferredName: name, defaultPlayerCount: 4 }, skins: [] }); await settle(); },
  };
}
function assertLoading(frame) {
  assert.equal(frame.title, 'My profile');
  assert.match(frame.status, /Loading your profile/);
  assert.equal(frame.contentHidden, true);
  for (const [name, hidden] of Object.entries({ ...frame.auth, ...frame.settings })) assert.equal(hidden, true, `${name} must not flash while the profile loads.`);
  assert.equal(frame.skinRewardsHidden, true);
  assert.equal(frame.closeDisabled, false);
  assert.equal(frame.password, '', 'The previous password must be cleared before the profile opens.');
}

test('profile prepares one neutral loading view before the dialog first becomes visible', async () => {
  const f = fixture({ holdTokens: true }), loading = f.open();
  assertLoading(f.modalFrames[0]); assertLoading(f.snapshot());
  f.dialog.close(); f.tokens[0].resolve(null); await loading;
});
test('old Settings controls stay hidden through token, history and preferences waits', async () => {
  const f = fixture({ holdTokens: true }), loading = f.open();
  assertLoading(f.snapshot()); f.tokens[0].resolve('fixture-account'); await settle();
  assertLoading(f.snapshot()); await f.historyReady(); assertLoading(f.snapshot());
  await f.complete(); await loading;
  assert.equal(f.content.hidden, false); assert.equal(f.title.textContent, 'My profile');
});
test('loaded profile opens Overview and keeps Settings hidden until its tab is chosen', async () => {
  const f = fixture(), loading = f.open(); await f.historyReady(); await f.complete(); await loading;
  assert.deepEqual(f.content.tabs.map(tab => tab.textContent), ['Overview', 'Achievements', 'Deck stats', 'Games', 'Settings']);
  assert.deepEqual(f.content.sections.map(section => section.hidden), [false, true, true, true]);
  for (const name of settingsNames) assert.equal(f.fields[name].hidden, true);
  f.content.tabs.find(tab => tab.textContent === 'Settings').click();
  for (const name of settingsNames) assert.equal(f.fields[name].hidden, false);
  for (const tab of f.content.tabs) assert.equal(tab.getAttribute('aria-current'), tab.textContent === 'Settings' ? 'page' : null,
    'The selected Settings tab must retain the same active-state value used by its visual highlight.');
  f.content.tabs.find(tab => tab.textContent === 'Games').click();
  assert.equal(f.content.sections.find(section => section.querySelector('h3').textContent === 'Game history').hidden, false);
  for (const name of settingsNames) assert.equal(f.fields[name].hidden, true);
  for (const tab of f.content.tabs) assert.equal(tab.getAttribute('aria-current'), tab.textContent === 'Games' ? 'page' : null,
    'Selecting Games must move the active-state value and clear every previous tab.');
});

test('the mission mounts inside Achievements without adding or replacing a profile section', async () => {
  const f = fixture(), loading = f.open(); await f.historyReady(); await f.complete(); await loading;
  assert.deepEqual(f.content.sections.map(section => section.querySelector('h3').textContent),
    ['This month', 'Achievements', 'Deck statistics', 'Game history']);
  assert.equal(f.content.sections[1].children.length, 1);
  assert.match(f.content.sections[1].children[0].innerHTML, /Exploration Commission/);
  assert.match(f.content.sections[1].children[0].innerHTML, /Begin mission/);
});
test('closing Settings and reopening never shows the prior controls in the loading frame', async () => {
  const f = fixture(), first = f.open(); await f.historyReady(); await f.complete(); await first;
  f.content.tabs.find(tab => tab.textContent === 'Settings').click(); f.dialog.close();
  const second = f.open(); assertLoading(f.modalFrames.at(-1));
  await f.historyReady(1); assertLoading(f.snapshot()); await f.complete(1); await second;
  assert.deepEqual(f.content.sections.map(section => section.hidden), [false, true, true, true]);
});
test('current history failure leaves one profile error with Close and no sign-in/settings residue', async () => {
  const f = fixture(), loading = f.open(); await settle(); f.histories[0].reject(new Error('Fixture history failure')); await loading;
  assert.equal(f.dialog.open, true); assert.equal(f.title.textContent, 'My profile');
  assert.equal(f.status.textContent, 'Fixture history failure'); assert.equal(f.content.hidden, true);
  for (const name of [...authNames, ...settingsNames]) assert.equal(f.fields[name].hidden, true, `${name} must remain hidden after an authenticated load failure.`);
});
test('a tokenless profile request still opens the legitimate sign-in screen', async () => {
  const f = fixture({ holdTokens: true }), loading = f.open(); f.tokens[0].resolve(null); await loading;
  assert.equal(f.dialog.open, true); assert.equal(f.title.textContent, 'Sign in');
  assert.equal(f.fields.myGamesSignInButton.hidden, false); assert.equal(f.fields.emailSignInButton.hidden, false);
  assert.equal(f.fields.accountPreferredNameField.hidden, true);
});
test('an old token after account retirement cannot fetch history or reopen sign-in', async () => {
  const f = fixture({ holdTokens: true }), loading = f.open(); f.context.awardProfileEpoch++; f.dialog.close();
  const closed = f.snapshot(); f.tokens[0].resolve(null); await loading;
  assert.deepEqual(f.snapshot(), closed); assert.equal(f.histories.length, 0);
});
test('an old history failure cannot overwrite a newer account screen', async () => {
  const f = fixture(), loading = f.open(); await settle(); f.context.awardProfileEpoch++;
  f.title.textContent = 'New account'; f.status.textContent = 'New account status'; const current = f.snapshot();
  f.histories[0].reject(new Error('Prior account failure')); await loading; assert.deepEqual(f.snapshot(), current);
});
test('closing while history is pending prevents late settings/content mutations', async () => {
  const f = fixture(), loading = f.open(); await settle(); f.dialog.close(); const closed = f.snapshot();
  f.histories[0].respond({ history: history(1) }); await settle();
  if (f.preferences.length) f.preferences[0].respond({ preferences: { preferredName: 'Late private name' } });
  await loading; assert.deepEqual(f.snapshot(), closed);
});
test('closing then opening sign-in prevents a late profile failure replacing its message', async () => {
  const f = fixture(), loading = f.open(); await settle(); f.dialog.close(); f.context.openSignIn(); const signIn = f.snapshot();
  f.histories[0].reject(new Error('Obsolete profile failure')); await loading; assert.deepEqual(f.snapshot(), signIn);
});
test('closing while preferences are pending preserves the closed screen and private values', async () => {
  const f = fixture(), loading = f.open(); await f.historyReady(); f.dialog.close(); const closed = f.snapshot();
  f.preferences[0].respond({ preferences: { preferredName: 'Late private name' } }); await loading;
  assert.deepEqual(f.snapshot(), closed); assert.notEqual(f.fields.accountPreferredName.value, 'Late private name');
});
test('an older overlapping history request cannot replace a newer completed open', async () => {
  const f = fixture(), old = f.open(); await settle(); const current = f.open(); await settle();
  f.histories[1].respond({ history: history(7) }); await settle(); await f.complete(0, 'Current profile'); await current;
  const latest = f.snapshot(); f.histories[0].respond({ history: history(1) }); await settle();
  if (f.preferences.length > 1) f.preferences[1].respond({ preferences: { preferredName: 'Old profile' } });
  await old; assert.deepEqual(f.snapshot(), latest); assert.equal(f.fields.accountPreferredName.value, 'Current profile');
});
test('a stale nonempty account token cannot start a private history fetch', async () => {
  const f = fixture({ holdTokens: true }), loading = f.open(); f.context.awardProfileEpoch++;
  const current = f.snapshot(); f.tokens[0].resolve('retired-account-token'); await settle();
  // Finish an incorrectly started request so failures remain assertions, not dangling tests.
  if (f.histories.length) f.histories[0].respond({ history: history(1) });
  await loading; assert.equal(f.histories.length, 0); assert.deepEqual(f.snapshot(), current);
});
test('a history JSON body completed after closing cannot begin preferences or publish data', async () => {
  const f = fixture(), loading = f.open(), json = deferred(); await settle();
  f.histories[0].respond(null, { json: () => json.promise }); await settle();
  f.dialog.close(); const closed = f.snapshot(); json.resolve({ history: history(1) }); await settle();
  if (f.preferences.length) f.preferences[0].respond({ preferences: { preferredName: 'Late body' } });
  await loading; assert.equal(f.preferences.length, 0); assert.deepEqual(f.snapshot(), closed);
});
test('a preferences JSON body completed after closing cannot apply private preferences', async () => {
  const f = fixture(), loading = f.open(), json = deferred(); await f.historyReady();
  f.preferences[0].respond(null, { json: () => json.promise }); await settle();
  f.dialog.close(); const closed = f.snapshot(); json.resolve({ preferences: { preferredName: 'Late body' } }); await loading;
  assert.deepEqual(f.snapshot(), closed); assert.equal(f.context.accountPreferences, null);
});
test('a queued old close event after reopening does not cancel the new open', async () => {
  const f = fixture(), old = f.open(); await settle(); f.dialog.close(); const current = f.open(); await settle();
  f.dialog.dispatch('close'); // Native close events may be queued until after a subsequent showModal.
  f.histories[1].respond({ history: history(7) }); await settle(); await f.complete(0, 'Current profile'); await current;
  assert.equal(f.content.hidden, false); assert.equal(f.fields.accountPreferredName.value, 'Current profile');
  const latest = f.snapshot(); f.histories[0].respond({ history: history(1) }); await settle();
  if (f.preferences.length > 1) f.preferences[1].respond({ preferences: { preferredName: 'Old profile' } });
  await old; assert.deepEqual(f.snapshot(), latest);
});
test('profile opening focuses its non-editable title instead of a former sign-in input', async () => {
  const f = fixture({ holdTokens: true }), loading = f.open();
  assert.equal(f.title.tabIndex, -1); assert.equal(f.context.document.activeElement, f.title);
  f.dialog.close(); f.tokens[0].resolve(null); await loading;
});
test('ready data does not steal focus after the user moves to Close while loading', async () => {
  const f = fixture(), loading = f.open(); f.closeButton.focus(); await f.historyReady(); await f.complete(); await loading;
  assert.equal(f.context.document.activeElement, f.closeButton); assert.equal(f.content.hidden, false);
});
test('cancel retires the load before the browser queues its native close event', async () => {
  const f = fixture(), loading = f.open(); await f.historyReady();
  f.dialog.dispatch('cancel'); const cancelled = f.snapshot(); // The cancel event precedes the native close event.
  await f.complete(); await loading; assert.deepEqual(f.snapshot(), cancelled);
  assert.equal(f.context.accountPreferences, null); f.dialog.close(); assert.equal(f.dialog.open, false);
});
test('current preferences network failure stays in the neutral profile error view', async () => {
  const f = fixture(), loading = f.open(); await f.historyReady();
  f.preferences[0].reject(new Error('Fixture preferences failure')); await loading;
  assert.equal(f.dialog.open, true); assert.equal(f.title.textContent, 'My profile');
  assert.equal(f.status.textContent, 'Fixture preferences failure'); assert.equal(f.content.hidden, true);
  for (const name of [...authNames, ...settingsNames]) assert.equal(f.fields[name].hidden, true);
});
test('an unavailable preferences response still opens history with the existing default settings', async () => {
  const f = fixture(), loading = f.open(); await f.historyReady(); f.preferences[0].respond({}, { ok: false }); await loading;
  assert.equal(f.dialog.open, true); assert.equal(f.content.hidden, false); assert.match(f.status.textContent, /1 wins in 2 games/);
  assert.equal(f.context.accountPreferences.preferredName, null); assert.equal(f.context.accountPreferences.defaultPlayerCount, 4);
  assert.deepEqual(f.content.sections.map(section => section.hidden), [false, true, true, true]);
});
