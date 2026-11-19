import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const extract = (start, next) => app.slice(app.indexOf(start), app.indexOf(next, app.indexOf(start)));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const privateDeck = { deckId: 'private_deck', commanderName: 'Private Commander', notes: 'PRIVATE_NOTES_SENTINEL' };

function fixture({ waitForToken = false } = {}) {
  const token = deferred(), response = deferred(), fetched = deferred();
  const element = () => ({ hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', open: false });
  const button = element();
  const context = createContext({
    currentAccountToken: () => waitForToken ? token.promise : Promise.resolve('account_token'),
    googleAccountToken: () => waitForToken ? token.promise : Promise.resolve('account_token'),
    fetchCalls: 0, fetch() { context.fetchCalls++; fetched.resolve(); return response.promise; },
    myDecksContent: element(), myDecksStatus: element(), myDecksSignInButton: element(), createDeckButton: element(),
    myGamesStatus: element(), signOutButton: element(), homeSignOutButton: element(), homeAccountMessage: element(),
    myGamesDialog: element(), myDecksDialog: element(), savedDecks: [], setupDecks: [], selectedDeckId: 'deck_before',
    dom: { createDeck: element(), joinDeck: element(), saveGameDeck: element() }, $: () => button,
    signOutInFlight: false, homeAccountSignedIn: true, awardProfileEpoch: 0,
    resetAwardProfile() { context.awardProfileEpoch++; }, signOutAccount: async () => {},
    sessionStorage: { removeItem() {} }, clearAccountAppearance() {}, clearPrivateDeckState() {}, competitionHub: { authChanged() {} },
    renderHomeAccount(signedIn) { context.homeAccountSignedIn = signedIn; },
    escapeHtml: value => String(value), sortSetupDecks: decks => decks, updateFormatSetup() {},
  });
  runInContext(extract('async function showMyDecks(', 'function setDeckColors(')
    + '\n' + extract('async function loadSetupDecks(', 'function renderVictory(')
    + '\n' + extract('async function loadSaveGameDecks(', 'async function loadCommanderDecks(')
    + '\n' + extract('async function signOut() {', 'function renderHomeAccount('), context);
  return { context, token, response, fetched, resolveDecks: () => response.resolve({ ok: true, json: async () => ({ decks: [privateDeck] }) }) };
}

for (const reader of ['showMyDecks', 'loadSetupDecks', 'loadSaveGameDecks']) {
  test(`${reader} discards a delayed account token after sign-out before fetching private data`, async () => {
    const f = fixture({ waitForToken: true });
    const reading = f.context[reader]();
    await f.context.signOut();
    f.token.resolve('old_account_token');
    f.resolveDecks();
    await reading;
    assert.equal(f.context.fetchCalls, 0);
    assert.equal(f.context.homeAccountSignedIn, false);
    assert.equal(f.context.savedDecks.length + f.context.setupDecks.length, 0);
  });

  test(`${reader} discards a private response that arrives after sign-out`, async () => {
    const f = fixture();
    const reading = f.context[reader]();
    await f.fetched.promise;
    await f.context.signOut();
    f.resolveDecks();
    await reading;
    assert.equal(f.context.homeAccountSignedIn, false);
    assert.equal(f.context.savedDecks.length + f.context.setupDecks.length, 0);
    assert.equal(f.context.myDecksContent.innerHTML.includes('PRIVATE_NOTES_SENTINEL'), false);
    assert.equal(f.context.dom.createDeck.innerHTML.includes('private_deck'), false);
    assert.equal(f.context.dom.joinDeck.innerHTML.includes('private_deck'), false);
    assert.equal(f.context.dom.saveGameDeck.innerHTML.includes('private_deck'), false);
  });
}

test('an old failed decks request cannot replace the new account status', async () => {
  const f = fixture();
  const reading = f.context.showMyDecks();
  await f.fetched.promise;
  await f.context.signOut();
  f.context.myDecksStatus.textContent = 'Current account status';
  f.response.reject(new Error('Old account request failed'));
  await reading;
  assert.equal(f.context.myDecksStatus.textContent, 'Current account status');
});

test('current account deck responses still populate private decks and setup options', async () => {
  for (const reader of ['showMyDecks', 'loadSetupDecks', 'loadSaveGameDecks']) {
    const f = fixture();
    const reading = f.context[reader]();
    await f.fetched.promise;
    f.resolveDecks();
    await reading;
    if (reader !== 'loadSaveGameDecks') assert.equal(f.context.savedDecks.length + f.context.setupDecks.length, 1);
    if (reader === 'showMyDecks') assert.equal(f.context.myDecksContent.innerHTML.includes('PRIVATE_NOTES_SENTINEL'), true);
    else assert.equal((reader === 'loadSetupDecks' ? f.context.dom.joinDeck : f.context.dom.saveGameDeck).innerHTML.includes('private_deck'), true);
  }
});
