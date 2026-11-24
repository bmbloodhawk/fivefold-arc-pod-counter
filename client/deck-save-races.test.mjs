import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { renderDeckLibrary as renderSavedDeckLibrary } from './deck-library-view.js';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const start = app.indexOf('function setDeckColors(');
const end = app.indexOf('async function saveAccountPreferences(', start);
assert.ok(start >= 0 && end > start, 'Load the actual deck editor/save implementation.');
const source = app.slice(start, end);
const navigationStart = app.indexOf('let deckEditorOpen');
const navigationSource = navigationStart < 0 ? '' : app.slice(navigationStart, app.indexOf('async function showMyDecks(', navigationStart));
const librarySource = app.slice(app.indexOf('async function showMyDecks('), start);
const resetStart = app.indexOf('function resetAwardProfile()');
const resetSource = app.slice(resetStart, app.indexOf('async function saveGameToHistory(', resetStart));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const copy = value => JSON.parse(JSON.stringify(value));

function fixture({ delayedToken = false, delayedLookup = false, delayedSave = false, lookupFails = false, editId = null, saveResponses = [], actualLibrary = false } = {}) {
  const token = deferred(), lookup = deferred(), response = deferred(), lookupEntered = deferred(), saveEntered = deferred();
  const libraryResponse = deferred(), libraryEntered = deferred();
  const element = value => ({ value, checked: false, disabled: false, hidden: false, textContent: '', setAttribute() {}, removeAttribute() {}, focus() {}, reset() {} });
  const count = element('1'), colorInputs = ['W', 'U', 'B', 'R', 'G'].map(element);
  colorInputs.find(input => input.value === 'R').checked = true;
  const context = createContext({
    renderSavedDeckLibrary,
    awardProfileEpoch: 0, editingDeckId: editId, deckCommanderColors: [['R']],
    deckCommanderName: element('Commander A'), deckCommanderNameTwo: element(''), deckCommanderNameTwoField: element(''),
    deckName: element('A deck'), deckNotes: element('A private notes'), deckFavorite: { ...element(''), checked: true },
    deckCommanderStatus: { ...element(''), textContent: 'A commander status' },
    myDecksStatus: { ...element(''), textContent: 'A library status' },
    createDeckButton: { ...element(''), textContent: editId ? 'Update deck' : 'Save deck' }, findDeckColorsButton: element(''),
    currentAccountToken: () => delayedToken ? token.promise : Promise.resolve('token_A'),
    normaliseIdentity: colors => [...new Set(colors)],
    $: selector => selector.startsWith('input[name="deckCommanderCount"]') ? count : null,
    $$: selector => selector === 'input[name="deckColors"]:checked' ? colorInputs.filter(input => input.checked)
      : selector === 'input[name="deckColors"]' ? colorInputs : [],
    lookupCommanderIdentity(name) {
      lookupEntered.resolve();
      if (delayedLookup) return lookup.promise;
      if (lookupFails) return Promise.reject(new Error('Fixture lookup unavailable'));
      return Promise.resolve({ name: `${name} confirmed`, colors: ['W', 'U'] });
    },
    fetch(url, options = {}) {
      if (!options.body) {
        context.libraryRequests.push({ url, options });
        libraryEntered.resolve();
        return libraryResponse.promise;
      }
      context.requests.push({ url, options: { ...options, headers: { ...options.headers } }, body: JSON.parse(options.body) });
      saveEntered.resolve();
      if (saveResponses.length) return saveResponses[context.requests.length - 1].promise;
      return delayedSave ? response.promise : Promise.resolve({ ok: true });
    },
    requests: [], libraryRequests: [], listRefreshes: 0, setupRefreshes: 0,
    myDecksContent: element(''), myDecksSignInButton: element(''), savedDecks: [],
    deckLibraryView: element(''), deckEditor: element(''), deckSearch: element(''), addDeckButton: element(''),
    cancelDeckEditorButton: element(''), myDecksTitle: element(''), closeMyDecksButton: element(''),
    myDecksDialog: { open: true, addEventListener() {}, showModal() { this.open = true; } },
    deckCommanderMatches: [0, 1].map(() => ({ hidden: true, replaceChildren() {} })),
    escapeHtml: value => String(value), renderHomeAccount() {}, googleAccountToken: async () => 'token_A',
    appearanceCatchUp: { reset() {} }, savedGameKey: null, savingGameKey: null, savedGameMoment: null,
    unlockedAchievementsByGame: new Map(),
    async showMyDecks() { context.listRefreshes++; context.myDecksStatus.textContent = 'Library refreshed'; context.createDeckButton.disabled = false; },
    async loadSetupDecks() { context.setupRefreshes++; },
  });
  runInContext(navigationSource + (actualLibrary ? librarySource : '') + source + '\n' + resetSource, context);
  const activateEditor = () => { if (navigationSource) runInContext('deckEditorOpen = true; deckEditor.hidden = false; deckLibraryView.hidden = true;', context); };
  activateEditor();
  context.deckEditor.reset = () => {
    context.deckCommanderName.value = ''; context.deckCommanderNameTwo.value = ''; context.deckName.value = ''; context.deckNotes.value = '';
    context.deckFavorite.checked = false; count.value = '1'; colorInputs.forEach(input => { input.checked = false; });
  };
  const draft = () => ({
    commanderNames: [context.deckCommanderName.value, context.deckCommanderNameTwo.value], count: count.value,
    name: context.deckName.value, notes: context.deckNotes.value, favorite: context.deckFavorite.checked,
    editingDeckId: context.editingDeckId, colors: colorInputs.filter(input => input.checked).map(input => input.value),
  });
  const ui = () => ({ ...draft(), status: context.myDecksStatus.textContent,
    commanderStatus: context.deckCommanderStatus.textContent, buttonLabel: context.createDeckButton.textContent,
    buttonDisabled: context.createDeckButton.disabled, lookupDisabled: context.findDeckColorsButton.disabled });
  const changeDraft = ({ otherProfile = false, disabled = false } = {}) => {
    activateEditor();
    if (otherProfile) context.awardProfileEpoch++;
    context.editingDeckId = 'deck_B'; count.value = '1';
    context.deckCommanderName.value = 'Commander B'; context.deckCommanderNameTwo.value = '';
    context.deckName.value = 'B deck'; context.deckNotes.value = 'B private notes'; context.deckFavorite.checked = false;
    context.deckCommanderColors = [['G']]; colorInputs.forEach(input => { input.checked = input.value === 'G'; });
    context.myDecksStatus.textContent = 'B library status'; context.deckCommanderStatus.textContent = 'B commander status';
    context.createDeckButton.textContent = 'Update B deck'; context.createDeckButton.disabled = disabled;
    context.findDeckColorsButton.disabled = disabled;
    return ui();
  };
  return { context, token, lookup, response, lookupEntered, saveEntered, libraryResponse, libraryEntered, count, colorInputs, draft, ui, changeDraft,
    finishLookup: () => lookup.resolve({ name: 'Commander A confirmed', colors: ['W', 'U'] }),
    finishSave: () => response.resolve({ ok: true }),
  };
}

test('a token returned after the profile changes cannot start an old deck save', async () => {
  const f = fixture({ delayedToken: true });
  const saving = f.context.createDeck();
  const nextUi = f.changeDraft({ otherProfile: true, disabled: true });
  f.token.resolve('token_A');
  await saving;
  assert.equal(f.context.requests.length, 0, 'No old-token write may start after the profile changes.');
  assert.deepEqual(f.ui(), nextUi);
});

test('an old token failure cannot replace the next profile status or reject outside the save handler', async () => {
  const f = fixture({ delayedToken: true });
  const saving = f.context.createDeck();
  const nextUi = f.changeDraft({ otherProfile: true, disabled: true });
  f.token.reject(new Error('Old token lookup failed'));
  await assert.doesNotReject(saving);
  assert.deepEqual(f.ui(), nextUi);
  assert.equal(f.context.requests.length, 0);
});

test('a commander lookup completing after an account switch cannot save or mutate the new editor', async () => {
  const f = fixture({ delayedLookup: true });
  const saving = f.context.createDeck();
  await f.lookupEntered.promise;
  const nextUi = f.changeDraft({ otherProfile: true, disabled: true });
  f.finishLookup();
  await saving;
  assert.equal(f.context.requests.length, 0, 'The old account must not receive the new account draft.');
  assert.deepEqual(f.ui(), nextUi);
});

for (const outcome of ['success', 'failure']) {
  test(`a save ${outcome} arriving after account switching leaves the new editor and pending controls intact`, async () => {
    const f = fixture({ delayedSave: true });
    const saving = f.context.createDeck();
    await f.saveEntered.promise;
    const nextUi = f.changeDraft({ otherProfile: true, disabled: true });
    if (outcome === 'success') f.finishSave();
    else f.response.reject(new Error('Old save request failed'));
    await saving;
    assert.deepEqual(f.ui(), nextUi);
    assert.equal(f.context.listRefreshes + f.context.setupRefreshes, 0, 'An old completion must not refresh the new profile.');
  });
}

test('editing while a token is pending never mixes a later draft into the submitted account write', async () => {
  const f = fixture({ delayedToken: true, editId: 'deck_A' });
  const saving = f.context.createDeck();
  const nextDraft = f.changeDraft();
  f.token.resolve('token_A');
  await saving;
  for (const request of f.context.requests) {
    assert.equal(request.url, '/api/account/decks/deck_A');
    assert.equal(request.options.method, 'PATCH');
    assert.equal(request.body.name, 'A deck');
    assert.equal(request.body.notes, 'A private notes');
    assert.equal(request.body.favorite, true);
    assert.deepEqual(request.body.commanderNames, ['Commander A confirmed']);
  }
  assert.deepEqual(f.draft(), {
    commanderNames: nextDraft.commanderNames, count: nextDraft.count, name: nextDraft.name, notes: nextDraft.notes,
    favorite: nextDraft.favorite, editingDeckId: nextDraft.editingDeckId, colors: nextDraft.colors,
  });
  assert.equal(f.context.createDeckButton.disabled, false, 'The newer draft remains usable.');
});

test('an edit target and all submitted fields stay together while commander lookup is pending', async () => {
  const f = fixture({ delayedLookup: true, editId: 'deck_A' });
  const saving = f.context.createDeck();
  await f.lookupEntered.promise;
  const nextDraft = f.changeDraft();
  f.finishLookup();
  await saving;
  for (const request of f.context.requests) {
    assert.equal(request.url, '/api/account/decks/deck_A');
    assert.equal(request.options.headers.authorization, 'Bearer token_A');
    assert.equal(request.body.name, 'A deck');
    assert.equal(request.body.notes, 'A private notes');
    assert.equal(request.body.favorite, true);
    assert.deepEqual(request.body.commanderNames, ['Commander A confirmed']);
  }
  assert.equal(f.context.deckCommanderName.value, nextDraft.commanderNames[0]);
  assert.equal(f.context.deckName.value, nextDraft.name);
  assert.equal(f.context.deckNotes.value, nextDraft.notes);
  assert.equal(f.context.editingDeckId, nextDraft.editingDeckId);
  assert.deepEqual(copy(f.context.deckCommanderColors), [['G']]);
});

test('a successful save cannot clear a newer draft entered while its write is pending', async () => {
  const f = fixture({ delayedSave: true });
  const saving = f.context.createDeck();
  await f.saveEntered.promise;
  const nextDraft = f.changeDraft();
  f.finishSave();
  await saving;
  assert.equal(f.context.deckName.value, nextDraft.name);
  assert.equal(f.context.deckNotes.value, nextDraft.notes);
  assert.equal(f.context.deckCommanderName.value, nextDraft.commanderNames[0]);
  assert.equal(f.context.editingDeckId, nextDraft.editingDeckId);
});

test('a normal create still saves canonical commanders and clears only its submitted draft', async () => {
  const f = fixture();
  await f.context.createDeck();
  assert.equal(f.context.requests.length, 1);
  const request = f.context.requests[0];
  assert.equal(request.url, '/api/account/decks');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer token_A');
  assert.deepEqual(request.body, { commanderNames: ['Commander A confirmed'], commanderColors: [['W', 'U']],
    name: 'A deck', colors: ['W', 'U'], notes: 'A private notes', favorite: true });
  assert.equal(f.context.deckName.value, '');
  assert.equal(f.context.deckNotes.value, '');
  assert.equal(f.context.deckCommanderName.value, '');
  assert.equal(f.context.editingDeckId, null);
  assert.equal(f.context.createDeckButton.textContent, 'Save deck');
  assert.equal(f.context.listRefreshes, 1);
  assert.equal(f.context.setupRefreshes, 1);
});

test('a normal edit keeps its encoded target and PATCH method', async () => {
  const f = fixture({ editId: 'deck A/?' });
  await f.context.createDeck();
  assert.equal(f.context.requests[0].url, '/api/account/decks/deck%20A%2F%3F');
  assert.equal(f.context.requests[0].options.method, 'PATCH');
});

test('lookup failure still permits saving the submitted manual color fallback', async () => {
  const f = fixture({ lookupFails: true });
  await f.context.createDeck();
  assert.equal(f.context.requests.length, 1);
  assert.deepEqual(f.context.requests[0].body, { commanderNames: ['Commander A'], commanderColors: [['R']],
    name: 'A deck', colors: ['R'], notes: 'A private notes', favorite: true });
});

for (const outcome of ['success', 'failure']) {
  test(`a standalone commander blur lookup ${outcome} after account switching cannot alter the next editor`, async () => {
    const f = fixture({ delayedLookup: true });
    const looking = f.context.confirmDeckCommanderColors();
    await f.lookupEntered.promise;
    const nextUi = f.changeDraft({ otherProfile: true, disabled: true });
    if (outcome === 'success') f.finishLookup();
    else f.lookup.reject(new Error('Old commander lookup failed'));
    assert.equal(await looking, false);
    assert.deepEqual(f.ui(), nextUi);
    assert.equal(f.context.requests.length, 0);
  });
}

test('normal same-profile blur normalization still permits the submitted draft to clear on save', async () => {
  const f = fixture({ delayedLookup: true });
  // Clicking Save can blur the commander field and start both real code paths.
  const looking = f.context.confirmDeckCommanderColors();
  const saving = f.context.createDeck();
  await f.lookupEntered.promise;
  f.finishLookup();
  assert.equal(await looking, true);
  await saving;
  assert.equal(f.context.requests.length, 1);
  assert.deepEqual(f.context.requests[0].body, { commanderNames: ['Commander A confirmed'], commanderColors: [['W', 'U']],
    name: 'A deck', colors: ['W', 'U'], notes: 'A private notes', favorite: true });
  assert.equal(f.context.deckCommanderName.value, '');
  assert.equal(f.context.deckName.value, '');
  assert.equal(f.context.deckNotes.value, '');
  assert.equal(f.context.findDeckColorsButton.disabled, false);
  assert.equal(f.context.createDeckButton.disabled, false);
});

for (const outcome of ['success', 'failure']) {
  test(`an older save ${outcome} cannot clear or re-enable a newer save still in flight`, async () => {
    const first = deferred(), second = deferred();
    const f = fixture({ saveResponses: [first, second] });
    const oldSaving = f.context.createDeck();
    await f.saveEntered.promise;
    f.changeDraft();
    const newSaving = f.context.createDeck();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.context.requests.length, 2);
    const nextUi = f.ui();
    assert.equal(nextUi.buttonDisabled, true, 'The second save is pending.');
    if (outcome === 'success') first.resolve({ ok: true });
    else first.reject(new Error('Earlier save failed'));
    await oldSaving;
    assert.deepEqual(f.ui(), nextUi);
    assert.equal(f.context.listRefreshes + f.context.setupRefreshes, 0);
    assert.equal(f.context.requests[0].body.notes, 'A private notes');
    assert.equal(f.context.requests[1].body.notes, 'B private notes');
    second.resolve({ ok: true });
    await newSaving;
    assert.equal(f.context.deckNotes.value, '');
    assert.equal(f.context.editingDeckId, null);
    assert.equal(f.context.createDeckButton.disabled, false);
  });
}

test('a normal paired-commander save keeps both canonical names and per-commander colors', async () => {
  const f = fixture();
  f.count.value = '2'; f.context.deckCommanderNameTwo.value = 'Partner A';
  f.context.deckCommanderColors = [['R'], ['G']];
  await f.context.createDeck();
  assert.equal(f.context.requests.length, 1);
  assert.deepEqual(f.context.requests[0].body, {
    commanderNames: ['Commander A confirmed', 'Partner A confirmed'], commanderColors: [['W', 'U'], ['W', 'U']],
    name: 'A deck', colors: ['W', 'U'], notes: 'A private notes', favorite: true,
  });
  assert.equal(f.context.deckCommanderName.value, '');
  assert.equal(f.context.deckCommanderNameTwo.value, '');
});

test('actual profile reset makes commander lookup usable before a retired lookup finishes', async () => {
  const f = fixture({ delayedLookup: true });
  const looking = f.context.confirmDeckCommanderColors();
  await f.lookupEntered.promise;
  assert.equal(f.context.findDeckColorsButton.disabled, true);
  f.context.resetAwardProfile();
  assert.equal(f.context.findDeckColorsButton.disabled, false, 'New profile must not inherit an old disabled lookup button.');
  const nextUi = f.changeDraft();
  f.finishLookup();
  assert.equal(await looking, false);
  assert.deepEqual(f.ui(), nextUi);
});

for (const outcome of ['success', 'failure']) {
  test(`an old save-triggered library ${outcome} cannot replace or enable a newer pending save`, async () => {
    const first = deferred(), second = deferred(); first.resolve({ ok: true });
    const f = fixture({ actualLibrary: true, saveResponses: [first, second] });
    const oldSaving = f.context.createDeck();
    await f.libraryEntered.promise;
    f.changeDraft();
    const newSaving = f.context.createDeck();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.context.requests.length, 2);
    f.context.myDecksContent.innerHTML = 'Current library presentation'; f.context.myDecksContent.hidden = false;
    f.context.savedDecks = [{ deckId: 'current_deck', commanderName: 'Current commander' }];
    const nextUi = f.ui(), nextLibrary = copy(f.context.savedDecks);
    if (outcome === 'success') f.libraryResponse.resolve({ ok: true,
      json: async () => ({ decks: [{ deckId: 'old_deck', commanderName: 'Old refresh commander', notes: 'Old refresh notes' }] }) });
    else f.libraryResponse.reject(new Error('Old library refresh failed'));
    await oldSaving;
    try {
      assert.deepEqual(f.ui(), nextUi);
      assert.deepEqual(copy(f.context.savedDecks), nextLibrary);
      assert.equal(f.context.myDecksContent.innerHTML, 'Current library presentation');
      assert.equal(f.context.myDecksContent.hidden, false);
    } finally {
      // Retire the test's still-pending second save without triggering another library read.
      f.context.awardProfileEpoch++;
      second.resolve({ ok: true });
      await newSaving;
    }
  });
}
