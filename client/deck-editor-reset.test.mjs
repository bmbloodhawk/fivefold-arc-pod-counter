import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const extract = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const navigationStart = app.indexOf('let deckEditorOpen');
const navigationSource = navigationStart < 0 ? '' : app.slice(navigationStart, app.indexOf('async function showMyDecks(', navigationStart));
const source = navigationSource + extract('async function showMyDecks(', 'async function saveAccountPreferences(')
  + extract('async function finishAccountSignIn(', 'async function restoreSavedAccountSession(')
  + extract('async function signOut()', 'function openSignIn(')
  + extract('async function deleteAccountData()', 'function clearAccountAppearance(')
  + extract('function resetAwardProfile()', 'async function saveGameToHistory(');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const copy = value => JSON.parse(JSON.stringify(value));
const privateDeck = { deckId: 'deck_A', commanderName: 'Private Commander A',
  commanderNames: ['Private Commander A', 'Private Partner A'], commanderColors: [['R'], ['G']],
  name: 'Private A deck', notes: 'PRIVATE_A_NOTES', colors: ['R', 'G'], favorite: true };

function fixture({ failSignOut = false, pendingLookup = false, pendingWrite = false, pendingPreferences = false,
  confirmDelete = true, failDelete = false, failPopup = false, pendingSignOut = false, pendingDelete = false,
  pendingToken = false } = {}) {
  const lookup = deferred(), write = deferred(), preferences = deferred();
  const lookupEntered = deferred(), writeEntered = deferred(), preferencesEntered = deferred();
  const signOutResponse = deferred(), deleteResponse = deferred(), deleteEntered = deferred(), tokenResponse = deferred();
  const element = value => ({ value: value ?? '', checked: false, disabled: false, hidden: false,
    textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {}, focus() {}, reset() {} });
  const radio = ['1', '2'].map(element), colors = ['W', 'U', 'B', 'R', 'G'].map(element);
  radio[1].checked = true;
  colors.forEach(input => { input.checked = ['R', 'G'].includes(input.value); });
  const dialog = () => ({ open: false, close() { this.open = false; }, showModal() { this.open = true; } });
  let token = 'token_A';
  const context = createContext({
    awardProfileEpoch: 0, editingDeckId: 'deck_A', deckCommanderColors: [['R'], ['G']],
    deckCommanderName: element('Private Commander A'), deckCommanderNameTwo: element('Private Partner A'),
    deckCommanderNameTwoField: element(), deckName: element('Private A deck'), deckNotes: element('PRIVATE_A_NOTES'),
    deckFavorite: { ...element(), checked: true },
    deckCommanderStatus: { ...element(), textContent: 'Editing private A colors' },
    createDeckButton: { ...element(), textContent: 'Update deck' }, findDeckColorsButton: element(),
    myDecksStatus: { ...element(), textContent: 'Editing Private Commander A' },
    myDecksContent: { ...element(), innerHTML: '<ul><li>PRIVATE_A_NOTES</li></ul>' }, myDecksSignInButton: element(),
    deckLibraryView: element(), deckEditor: element(), deckSearch: element(), addDeckButton: element(),
    cancelDeckEditorButton: element(), myDecksTitle: element(), closeMyDecksButton: element(),
    myGamesStatus: element(), myGamesDialog: dialog(), myDecksDialog: dialog(),
    myGamesContent: element(), exportAccountButton: element(), deleteAccountButton: element(),
    signOutButton: element(), homeSignOutButton: element(), homeAccountMessage: element(),
    accountSignedInStatus: element(), signInButton: element(), myGamesButton: element(), myDecksButton: element(),
    savedDecks: [copy(privateDeck)], setupDecks: [copy(privateDeck)], commanderDecks: [copy(privateDeck)], selectedDeckId: 'deck_A',
    signOutInFlight: false, homeAccountSignedIn: true, pendingSignInReturn: null,
    state: { podCode: 'TABLE1', ownerPlayerId: 'P2', players: [{ id: 'P2', life: 37 }] },
    transport: { status: 'connected', roomCode: 'TABLE1', seatId: 1,
      clearSession() { assert.fail('Account privacy cleanup must not leave the shared Table.'); } },
    dom: { createName: element(), joinName: element(), roundLimitMinutes: element(), landing: element(), joinSeatView: element(),
      createDeck: { ...element(), innerHTML: '<option>Private A deck</option>' },
      joinDeck: { ...element(), innerHTML: '<option>Private A deck</option>' },
      saveGameDeck: { ...element(), innerHTML: '<option>Private A deck</option>' },
      commanderDeck: { ...element(), innerHTML: '<option>Private A deck</option>' },
      createDeckField: element(), joinDeckField: element(), commanderDeckField: element() },
    currentAccountToken: async () => pendingToken ? tokenResponse.promise : token,
    async googleAccountToken() { if (failPopup) throw new Error('Popup cancelled'); return token; },
    async signOutAccount() {
      const retiringToken = token;
      if (pendingSignOut) await signOutResponse.promise;
      if (failSignOut) throw new Error('Provider sign-out unavailable');
      if (token === retiringToken) token = null;
    },
    normaliseIdentity: values => [...new Set(values)], escapeHtml: value => String(value),
    $(selector) {
      if (selector.includes('input[name="deckCommanderCount"]')) {
        const value = /\[value=["']?([12])/.exec(selector)?.[1];
        return value ? radio.find(input => input.value === value) : radio.find(input => input.checked);
      }
      return element();
    },
    $$(selector) {
      if (selector === 'input[name="deckColors"]:checked') return colors.filter(input => input.checked);
      if (selector === 'input[name="deckColors"]') return colors;
      if (selector === 'input[name="deckCommanderCount"]') return radio;
      return [];
    },
    lookupCommanderIdentity(name) { lookupEntered.resolve(); return pendingLookup ? lookup.promise : Promise.resolve({ name, colors: ['G'] }); },
    requests: [], deletions: [],
    async fetch(url, options = {}) {
      if (options.method === 'DELETE') {
        context.deletions.push({ url, options });
        deleteEntered.resolve();
        return pendingDelete ? deleteResponse.promise : { ok: !failDelete };
      }
      if (url === '/api/account/preferences') {
        preferencesEntered.resolve();
        return pendingPreferences ? preferences.promise : { ok: true, json: async () => ({ preferences: { defaultPlayerCount: 4 } }) };
      }
      if (['POST', 'PATCH'].includes(options.method)) {
        context.requests.push({ url, method: options.method, headers: { ...options.headers }, body: JSON.parse(options.body) });
        writeEntered.resolve(); return pendingWrite ? write.promise : { ok: true };
      }
      return { ok: true, json: async () => ({ decks: token === 'token_A' ? [copy(privateDeck)] : [] }) };
    },
    appearanceCatchUp: { reset() {} }, unlockedAchievementsByGame: new Map(),
    savedGameKey: null, savingGameKey: null, savedGameMoment: null,
    clearAccountAppearance() {}, applyAccountPreferences() {}, competitionHub: { authChanged() {} },
    removedStorage: [], sessionStorage: { removeItem(key) { context.removedStorage.push(key); } },
    window: { confirm: () => confirmDelete },
    async loadSetupDecks() { context.setupDecks = token === 'token_A' ? [copy(privateDeck)] : []; },
    showView() {}, showJoinStep() {},
  });
  runInContext(source, context);
  const activateEditor = () => { if (navigationSource) runInContext('deckEditorOpen = true; deckEditor.hidden = false; deckLibraryView.hidden = true;', context); };
  activateEditor();
  context.deckEditor.reset = () => {
    context.deckCommanderName.value = ''; context.deckCommanderNameTwo.value = ''; context.deckName.value = ''; context.deckNotes.value = '';
    context.deckFavorite.checked = false; radio.forEach(input => { input.checked = input.value === '1'; });
    colors.forEach(input => { input.checked = false; });
  };
  const draft = () => ({ commanderNames: [context.deckCommanderName.value, context.deckCommanderNameTwo.value],
    count: radio.find(input => input.checked)?.value, name: context.deckName.value, notes: context.deckNotes.value,
    favorite: context.deckFavorite.checked, colors: colors.filter(input => input.checked).map(input => input.value),
    commanderColors: copy(context.deckCommanderColors), editingDeckId: context.editingDeckId });
  const assertCleared = () => {
    assert.deepEqual(draft(), { commanderNames: ['', ''], count: '1', name: '', notes: '', favorite: false,
      colors: [], commanderColors: [], editingDeckId: null });
    assert.equal(context.deckCommanderNameTwoField.hidden, true);
    assert.equal(context.createDeckButton.textContent, 'Save deck');
    assert.doesNotMatch(context.deckCommanderStatus.textContent + context.myDecksStatus.textContent, /Private|PRIVATE_A|private A/);
    assert.doesNotMatch(context.myDecksContent.innerHTML, /PRIVATE_A_NOTES/);
    assert.equal(context.savedDecks.some(deck => deck.deckId === 'deck_A'), false);
    assert.equal(context.commanderDecks.some(deck => deck.deckId === 'deck_A'), false);
    assert.equal(context.selectedDeckId, '');
    for (const name of ['createDeck', 'joinDeck', 'saveGameDeck', 'commanderDeck']) {
      assert.doesNotMatch(context.dom[name].innerHTML, /Private|PRIVATE_A/);
    }
    for (const name of ['createDeckField', 'joinDeckField', 'commanderDeckField']) assert.equal(context.dom[name].hidden, true);
    assert.ok(context.removedStorage.includes('fivefold-arc:confirmed-commander-deck'));
  };
  const fillB = () => {
    activateEditor();
    context.editingDeckId = null;
    radio[0].checked = true; radio[1].checked = false;
    context.deckCommanderName.value = 'Commander B'; context.deckCommanderNameTwo.value = '';
    context.deckName.value = 'Fresh B deck'; context.deckNotes.value = 'Private B notes'; context.deckFavorite.checked = false;
    context.deckCommanderColors = []; colors.forEach(input => { input.checked = input.value === 'G'; });
  };
  return { context, radio, colors, draft, assertCleared, fillB, lookup, write, preferences,
    lookupEntered, writeEntered, preferencesEntered, signOutResponse, deleteResponse, deleteEntered, tokenResponse,
    setToken(value) { token = value; },
    signInB() { token = 'token_B'; return context.finishAccountSignIn(token); } };
}

test('successful sign-out removes the previous private deck editor and cached library', async () => {
  const f = fixture();
  await f.context.signOut();
  f.assertCleared();
  assert.equal(f.context.homeAccountSignedIn, false);
});

test('a new signed-in profile clears the old editor before preferences finish loading', async () => {
  const f = fixture({ pendingPreferences: true });
  const signingIn = f.signInB();
  await f.preferencesEntered.promise;
  const checkpoint = f.draft();
  f.preferences.resolve({ ok: true, json: async () => ({ preferences: { defaultPlayerCount: 4 } }) });
  await signingIn;
  assert.equal(checkpoint.notes, '', 'The old private notes must leave the DOM before network reads finish.');
  f.assertCleared();
});

test('successful sign-out keeps the shared Table seat and gameplay state intact', async () => {
  const f = fixture();
  const state = copy(f.context.state);
  await f.context.signOut();
  assert.deepEqual(copy(f.context.state), state);
  assert.equal(f.context.transport.status, 'connected');
  assert.equal(f.context.transport.roomCode, 'TABLE1');
  assert.equal(f.context.transport.seatId, 1);
});

test('a fresh deck after account switching uses POST and the new account rather than the old edit target', async () => {
  const f = fixture();
  await f.context.signOut();
  await f.signInB();
  assert.equal(f.context.editingDeckId, null, 'The old account edit target must be retired.');
  f.fillB();
  await f.context.createDeck();
  assert.equal(f.context.requests.length, 1);
  assert.equal(f.context.requests[0].method, 'POST');
  assert.equal(f.context.requests[0].url, '/api/account/decks');
  assert.equal(f.context.requests[0].headers.authorization, 'Bearer token_B');
  assert.equal(f.context.requests[0].body.notes, 'Private B notes');
});

test('successful Google sign-in from My Decks clears the previous private editor and advances its profile generation', async () => {
  const f = fixture();
  f.setToken('token_B');
  const beforeEpoch = f.context.awardProfileEpoch;
  await f.context.showMyDecks(true);
  f.assertCleared();
  assert.ok(f.context.awardProfileEpoch > beforeEpoch);
  assert.equal(f.context.homeAccountSignedIn, true);
});

test('a cancelled Google sign-in from My Decks preserves the current authenticated draft', async () => {
  const f = fixture({ failPopup: true });
  const before = f.draft(), beforeEpoch = f.context.awardProfileEpoch;
  await f.context.showMyDecks(true);
  assert.deepEqual(f.draft(), before);
  assert.equal(f.context.awardProfileEpoch, beforeEpoch);
  assert.equal(f.context.homeAccountSignedIn, true);
  assert.match(f.context.myDecksStatus.textContent, /Popup cancelled/);
});

test('ordinary close and reopen in the same profile preserves the current unsaved draft', async () => {
  const f = fixture();
  const before = f.draft();
  f.context.myDecksDialog.close(); f.context.myDecksDialog.showModal();
  await f.context.showMyDecks();
  assert.deepEqual(f.draft(), before);
});

test('failed sign-out preserves the authenticated account draft and enables retry', async () => {
  const f = fixture({ failSignOut: true });
  const before = f.draft();
  await f.context.signOut();
  assert.deepEqual(f.draft(), before);
  assert.equal(f.context.homeAccountSignedIn, true);
  assert.equal(f.context.homeSignOutButton.disabled, false);
  assert.match(f.context.homeAccountMessage.textContent, /Provider sign-out unavailable/);
});

test('a sign-in without a returned account session does not erase the current draft', async () => {
  const f = fixture();
  const before = f.draft();
  await assert.rejects(f.context.finishAccountSignIn(null), /did not return an account session/);
  assert.deepEqual(f.draft(), before);
});

test('an old commander lookup cannot restore private fields after successful sign-out', async () => {
  const f = fixture({ pendingLookup: true });
  const lookingUp = f.context.confirmDeckCommanderColors();
  await f.lookupEntered.promise;
  await f.context.signOut();
  f.lookup.resolve({ name: 'Private Commander A canonical', colors: ['R'] });
  await lookingUp;
  f.assertCleared();
});

test('an old accepted save cannot restore the cleared editor or erase the next account draft', async () => {
  const f = fixture({ pendingWrite: true });
  const saving = f.context.createDeck();
  await f.writeEntered.promise;
  await f.context.signOut();
  await f.signInB();
  f.assertCleared();
  f.fillB(); const before = f.draft();
  f.write.resolve({ ok: true });
  await saving;
  assert.deepEqual(f.draft(), before);
  assert.equal(f.context.requests.length, 1);
  assert.equal(f.context.requests[0].headers.authorization, 'Bearer token_A');
  assert.equal(f.context.requests[0].body.notes, 'PRIVATE_A_NOTES');
});

test('discovering an expired account session clears the private editor and cached selectors', async () => {
  const f = fixture();
  f.setToken(null);
  await f.context.showMyDecks();
  f.assertCleared();
  assert.equal(f.context.createDeckButton.disabled, true);
  assert.equal(f.context.requests.length, 0);
});

test('successful account-data deletion clears the private editor without requiring another login', async () => {
  const f = fixture();
  await f.context.deleteAccountData();
  f.assertCleared();
  assert.equal(f.context.deletions.length, 1);
  assert.equal(f.context.deletions[0].url, '/api/account');
});

test('cancelling account-data deletion preserves the current private draft and sends no deletion', async () => {
  const f = fixture({ confirmDelete: false });
  const before = f.draft();
  await f.context.deleteAccountData();
  assert.deepEqual(f.draft(), before);
  assert.equal(f.context.deletions.length, 0);
});

test('a failed account-data deletion preserves the current private draft', async () => {
  const f = fixture({ failDelete: true });
  const before = f.draft();
  await assert.rejects(f.context.deleteAccountData(), /could not be deleted/);
  assert.deepEqual(f.draft(), before);
  assert.equal(f.context.deletions.length, 1);
});

test('a lookup begun while sign-out is pending cannot repopulate the editor after successful sign-out', async () => {
  const f = fixture({ pendingSignOut: true, pendingLookup: true });
  const signingOut = f.context.signOut();
  const lookingUp = f.context.confirmDeckCommanderColors();
  await f.lookupEntered.promise;
  f.signOutResponse.resolve();
  await signingOut;
  f.assertCleared();
  f.lookup.resolve({ name: 'PRIVATE_A_LATE_LOOKUP', colors: ['R'] });
  await lookingUp;
  f.assertCleared();
});

test('a lookup begun while account deletion is pending cannot repopulate the editor after deletion', async () => {
  const f = fixture({ pendingDelete: true, pendingLookup: true });
  const deleting = f.context.deleteAccountData();
  await f.deleteEntered.promise;
  const lookingUp = f.context.confirmDeckCommanderColors();
  await f.lookupEntered.promise;
  f.deleteResponse.resolve({ ok: true });
  await deleting;
  f.assertCleared();
  f.lookup.resolve({ name: 'PRIVATE_A_LATE_LOOKUP', colors: ['R'] });
  await lookingUp;
  f.assertCleared();
});

for (const outcome of ['success', 'failure']) {
  test(`an old provider sign-out ${outcome} cannot clear or replace a newly signed-in account editor`, async () => {
    const f = fixture({ pendingSignOut: true });
    const signingOut = f.context.signOut();
    await f.signInB();
    f.fillB();
    f.context.myDecksStatus.textContent = 'B current deck status';
    f.context.myGamesStatus.textContent = 'B current profile status';
    const before = f.draft();
    if (outcome === 'success') f.signOutResponse.resolve();
    else f.signOutResponse.reject(new Error('Old provider request failed'));
    await assert.doesNotReject(signingOut);
    assert.deepEqual(f.draft(), before);
    assert.equal(f.context.myDecksStatus.textContent, 'B current deck status');
    assert.equal(f.context.myGamesStatus.textContent, 'B current profile status');
    assert.equal(f.context.homeAccountSignedIn, true);
  });

  test(`an old account deletion ${outcome} cannot clear or replace a newly signed-in account editor`, async () => {
    const f = fixture({ pendingDelete: true });
    const deleting = f.context.deleteAccountData();
    await f.deleteEntered.promise;
    await f.signInB();
    f.fillB();
    f.context.myDecksStatus.textContent = 'B current deck status';
    f.context.myGamesStatus.textContent = 'B current profile status';
    const before = f.draft();
    if (outcome === 'success') f.deleteResponse.resolve({ ok: true });
    else f.deleteResponse.reject(new Error('Old deletion request failed'));
    await assert.doesNotReject(deleting);
    assert.deepEqual(f.draft(), before);
    assert.equal(f.context.myDecksStatus.textContent, 'B current deck status');
    assert.equal(f.context.myGamesStatus.textContent, 'B current profile status');
    assert.equal(f.context.homeAccountSignedIn, true);
  });
}

test('an old account deletion cannot start after its token arrives in a newly signed-in profile', async () => {
  const f = fixture({ pendingToken: true });
  const deleting = f.context.deleteAccountData();
  await f.signInB();
  f.fillB(); const before = f.draft();
  f.tokenResponse.resolve('token_A');
  await deleting;
  assert.equal(f.context.deletions.length, 0);
  assert.deepEqual(f.draft(), before);
});
