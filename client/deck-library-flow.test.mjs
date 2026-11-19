import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, Script } from 'node:vm';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const page = await readFile(new URL('./index.html', import.meta.url), 'utf8');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `Actual app function ${name} must exist.`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Find the complete function. */ }
  }
  assert.fail(`Complete app function ${name} was not found.`);
}
const matches = (deck, query) => runInContext(`(${sourceFunction('deckMatchesSearch')})(deck, query)`, createContext({ deck, query }));
const single = Object.freeze({ deckId: 'single', name: 'Phone Test Deck', commanderName: 'Krenko, Mob Boss',
  commanderNames: Object.freeze(['Krenko, Mob Boss']), notes: 'PRIVATE_NOTES_SENTINEL', colors: Object.freeze(['R']) });
const partners = Object.freeze({ deckId: 'partners', name: 'Connected Engines', commanderName: 'Partner commanders',
  commanderNames: Object.freeze(['Tymna the Weaver', 'Thrasios, Triton Hero']), archived: true });

for (const query of ['', ' ', '\t\n']) test(`blank deck search retains all saved decks (${JSON.stringify(query)})`, () => {
  assert.equal(matches(single, query), true);
  assert.equal(matches(partners, query), true);
});
for (const query of ['Phone', 'phone test', ' TEST DECK ', 'kReNkO', 'mob boss']) {
  test(`deck search finds a saved name or commander without case sensitivity (${query})`, () => {
    assert.equal(matches(single, query), true);
  });
}
for (const query of ['Tymna', 'THRASIOS', 'Triton Hero']) test(`deck search includes either paired commander (${query})`, () => {
  assert.equal(matches(partners, query), true);
});
test('search retains archived decks when their name or commander matches', () => {
  assert.equal(matches(partners, 'Connected Engines'), true);
});
test('commander-only saved decks are searchable without an optional deck name', () => {
  assert.equal(matches({ deckId: 'unnamed', commanderName: 'Veyran, Voice of Duality' }, 'Veyran'), true);
});
test('no-match queries do not match private notes, unrelated names, or markup', () => {
  for (const query of ['PRIVATE_NOTES_SENTINEL', 'Atraxa', '<img src=x onerror=alert(1)>']) assert.equal(matches(single, query), false);
});
test('matching treats HTML-like names as literal text without modifying the saved deck', () => {
  const deck = Object.freeze({ name: '<script>literal deck</script>', commanderName: 'Commander' });
  assert.equal(matches(deck, '<script>'), true);
  assert.equal(deck.name, '<script>literal deck</script>');
});

test('the deck editor is hidden in the initial HTML before the library opens', () => {
  const editor = page.match(/<form\b[^>]*\bid="deckEditor"[^>]*>/)?.[0];
  assert.ok(editor, 'The saved-deck editor has its own form.');
  assert.match(editor, /\bhidden(?:\s|>|=)/, 'The first paint must show the library without the add form.');
});

test('the saved library exposes a named Add deck action and search field', () => {
  assert.match(page, /<button\b[^>]*id="addDeckButton"[^>]*>\s*Add deck\s*<\/button>/);
  assert.match(page, /<input\b[^>]*id="deckSearch"[^>]*>/);
  const search = page.match(/<input\b[^>]*id="deckSearch"[^>]*>/)?.[0] || '';
  assert.match(search, /type="search"/);
  assert.ok(/<label[^>]*for="deckSearch"[^>]*>\s*Search decks/.test(page)
    || /<label[^>]*>\s*Search decks[\s\S]*?id="deckSearch"/.test(page), 'Search must have a visible label.');
});
test('search is outside the editor form and cannot implicitly submit a dialog-close form', () => {
  const start = page.indexOf('<dialog id="myDecksDialog"');
  const dialog = page.slice(start, page.indexOf('</dialog>', start));
  assert.doesNotMatch(dialog, /<form\b[^>]*method="dialog"/);
  const editor = /<form\b[^>]*\bid="deckEditor"[^>]*>[\s\S]*?<\/form>/.exec(dialog)?.[0];
  assert.ok(editor); assert.doesNotMatch(editor, /id="deckSearch"/);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const copy = value => JSON.parse(JSON.stringify(value));
function fixture({ waitForToken = false, waitForWrite = false, failWrite = false, failRead = false, decks = [single, partners] } = {}) {
  const token = deferred(), write = deferred(), writeEntered = deferred();
  const nodes = new Map(); let context, count = '1', load;
  function element(value = '') {
    const listeners = new Map(), attributes = new Map();
    return { value, hidden: false, disabled: false, checked: false, textContent: '', innerHTML: '', dataset: {},
      focus() { context.document.activeElement = this; },
      setAttribute(name, value) { attributes.set(name, String(value)); }, removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
      dispatch(type) { for (const callback of listeners.get(type) || []) callback({ preventDefault() {}, currentTarget: this }); },
      scrollIntoView() {}, reset() {},
    };
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const radio = ['1', '2'].map(value => { const input = element(value); Object.defineProperty(input, 'checked', { get: () => count === value, set(checked) { if (checked) count = value; } }); return input; });
  const colors = ['W', 'U', 'B', 'R', 'G'].map(element);
  const dialog = { ...element(), open: false, frames: [],
    showModal() { this.open = true; this.frames.push({ editorHidden: node('deckEditor').hidden, libraryHidden: node('deckLibraryView').hidden }); },
    close() { this.open = false; this.dispatch('close'); },
    querySelector: selector => node(selector.replace(/^#/, '')),
  };
  node('deckEditor').hidden = true;
  const fieldNames = ['deckLibraryView', 'deckEditor', 'deckSearch', 'addDeckButton', 'cancelDeckEditorButton', 'myDecksTitle', 'closeMyDecksButton',
    'deckCommanderName', 'deckCommanderNameTwo', 'deckCommanderNameTwoField', 'deckName', 'deckNotes', 'deckFavorite',
    'deckCommanderStatus', 'myDecksStatus', 'createDeckButton', 'findDeckColorsButton', 'myDecksSignInButton', 'myDecksContent'];
  node('deckEditor').reset = () => {
    for (const name of ['deckCommanderName', 'deckCommanderNameTwo', 'deckName', 'deckNotes']) node(name).value = '';
    node('deckFavorite').checked = false; colors.forEach(input => { input.checked = false; }); count = '1';
  };
  context = createContext({ ...Object.fromEntries(fieldNames.map(name => [name, node(name)])), myDecksDialog: dialog,
    deckCommanderMatches: [0, 1].map(() => ({ hidden: true, replaceChildren() {} })),
    awardProfileEpoch: 0, deckEditorOpen: false, deckLibraryRequest: 0,
    editingDeckId: null, deckCommanderColors: [], selectedDeckId: '',
    savedDecks: copy(decks), serverDecks: copy(decks), setupDecks: [], commanderDecks: [], homeAccountSignedIn: true,
    document: { activeElement: null }, window: { scrollTo() {} },
    $(selector) {
      if (selector.startsWith('input[name="deckCommanderCount"]')) { const value = /\[value="([12])"\]/.exec(selector)?.[1]; return radio.find(input => input.value === (value || count)); }
      return node(selector.replace(/^#/, ''));
    },
    $$(selector) { if (selector === 'input[name="deckColors"]') return colors; if (selector === 'input[name="deckColors"]:checked') return colors.filter(input => input.checked); if (selector === 'input[name="deckCommanderCount"]') return radio; return []; },
    dom: Object.fromEntries(['createDeck', 'joinDeck', 'saveGameDeck', 'commanderDeck', 'createDeckField', 'joinDeckField', 'commanderDeckField'].map(name => [name, element()])),
    IDENTITY_ORDER: ['W', 'U', 'B', 'R', 'G'], sessionStorage: { removeItem() {} },
    currentAccountToken: () => waitForToken ? token.promise : Promise.resolve('fixture-token'), googleAccountToken: async () => 'fixture-token',
    resetAwardProfile() { context.awardProfileEpoch++; }, renderHomeAccount(value) { context.homeAccountSignedIn = value; },
    lookupCommanderIdentity: async name => ({ name, colors: ['R'] }), requests: [], reads: 0, setupReads: 0,
    async loadSetupDecks() { context.setupReads++; },
    async fetch(url, options = {}) {
      if (!options.body) { context.reads++; return { ok: !failRead, json: async () => ({ decks: copy(context.serverDecks) }) }; }
      const body = JSON.parse(options.body); context.requests.push({ url, method: options.method, body }); writeEntered.resolve();
      const result = waitForWrite ? await write.promise : { ok: !failWrite };
      if (result.ok) {
        const deckId = options.method === 'PATCH' ? decodeURIComponent(url.split('/').at(-1)) : `new_${context.requests.length}`;
        const record = { deckId, ...body, commanderName: body.commanderNames.join(' / ') };
        context.serverDecks = [...context.serverDecks.filter(deck => deck.deckId !== deckId), record];
      }
      return result;
    },
  });
  const profile = sourceFunction('showMyGames'), from = app.indexOf(profile) + profile.length;
  const feature = app.slice(from, app.indexOf('async function saveAccountPreferences(', from));
  runInContext(sourceFunction('escapeHtml') + '\n' + sourceFunction('normaliseIdentity') + '\n' + feature, context);
  const actualReader = context.showMyDecks;
  context.showMyDecks = (...args) => { load = actualReader(...args); return load; };
  const fill = (name = 'Phone Test Deck') => {
    node('deckCommanderName').value = 'Krenko, Mob Boss'; node('deckName').value = name; node('deckNotes').value = 'Safari test';
  };
  return { context, node, dialog, token, write, writeEntered, fill,
    async open() { context.openMyDecks(); if (load) await load; },
    get draft() { return { id: context.editingDeckId, name: node('deckName').value, commander: node('deckCommanderName').value, partner: node('deckCommanderNameTwo').value, notes: node('deckNotes').value, count, favorite: node('deckFavorite').checked }; },
  };
}

test('opening My decks shows the library without opening or clearing the editor', async () => {
  const f = fixture(); await f.open();
  assert.equal(f.node('deckEditor').hidden, true); assert.equal(f.node('deckLibraryView').hidden, false);
  assert.ok(f.dialog.frames.every(frame => frame.editorHidden && !frame.libraryHidden));
  assert.match(f.node('myDecksContent').innerHTML, /Krenko/); assert.equal(f.node('addDeckButton').disabled, false);
});
test('Add deck opens a blank one-commander editor rather than changing the library data', async () => {
  const f = fixture(); await f.open(); const before = copy(f.context.savedDecks);
  f.context.beginNewDeck();
  assert.equal(f.node('deckEditor').hidden, false); assert.equal(f.node('deckLibraryView').hidden, true);
  assert.deepEqual(f.draft, { id: null, name: '', commander: '', partner: '', notes: '', count: '1', favorite: false });
  assert.deepEqual(copy(f.context.savedDecks), before); assert.equal(f.context.requests.length, 0);
});
test('editing a paired saved deck opens its populated editor and Cancel returns to its filtered library', async () => {
  const f = fixture(); await f.open(); f.node('deckSearch').value = 'Thrasios'; f.context.renderDeckLibrary();
  f.context.beginDeckEdit('partners');
  assert.equal(f.node('deckEditor').hidden, false); assert.equal(f.draft.id, 'partners');
  assert.equal(f.draft.partner, 'Thrasios, Triton Hero'); assert.equal(f.draft.count, '2');
  f.node('deckName').value = 'Unsaved change'; f.context.cancelDeckEditor();
  assert.equal(f.node('deckEditor').hidden, true); assert.equal(f.node('deckLibraryView').hidden, false);
  assert.equal(f.node('deckSearch').value, 'Thrasios'); assert.equal(f.context.requests.length, 0);
  assert.equal(f.context.savedDecks.find(deck => deck.deckId === 'partners').name, 'Connected Engines');
});
test('native Close and reopening preserve an unfinished editor draft', async () => {
  const f = fixture(); await f.open(); f.context.beginNewDeck(); f.fill(); const draft = f.draft;
  f.dialog.close(); await f.open();
  assert.equal(f.node('deckEditor').hidden, false); assert.deepEqual(f.draft, draft);
});
test('search filters the existing saved collection without extra network requests and keeps its actions', async () => {
  const f = fixture(); await f.open(); const beforeReads = f.context.reads;
  f.node('deckSearch').value = 'thrasios'; f.context.renderDeckLibrary();
  const html = f.node('myDecksContent').innerHTML;
  assert.match(html, /Connected Engines/); assert.doesNotMatch(html, /Phone Test Deck/);
  for (const action of ['edit-deck', 'toggle-favorite', 'toggle-archive', 'export-deck', 'remove-deck']) assert.match(html, new RegExp(`data-${action}="partners"`));
  assert.match(html, /Archived/); assert.equal(f.context.reads, beforeReads);
  f.node('deckSearch').value = ''; f.context.renderDeckLibrary(); assert.match(f.node('myDecksContent').innerHTML, /Phone Test Deck/);
});
test('search keeps the typed query and keyboard focus while replacing results', async () => {
  const f = fixture(); await f.open(); f.node('deckSearch').focus(); f.node('deckSearch').value = '  KRENKO  ';
  f.context.renderDeckLibrary();
  assert.equal(f.node('deckSearch').value, '  KRENKO  '); assert.equal(f.context.document.activeElement, f.node('deckSearch'));
});
test('filtered deck names, commanders and private notes render as escaped text', async () => {
  const f = fixture({ decks: [{ deckId: 'literal', name: '<img src=x onerror=alert(1)>', commanderName: '<script>Commander</script>', notes: '<b>Private note</b>' }] });
  await f.open(); f.node('deckSearch').value = '<img'; f.context.renderDeckLibrary();
  const html = f.node('myDecksContent').innerHTML;
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.match(html, /&lt;b&gt;Private note/);
  assert.doesNotMatch(html, /<(?:img|script|b)\b/);
});
test('no-match search exposes a clear empty state and never inserts query markup', async () => {
  const f = fixture(); await f.open(); f.node('deckSearch').value = '<img src=x onerror=alert(1)>'; f.context.renderDeckLibrary();
  assert.match(f.node('myDecksContent').innerHTML + f.node('myDecksStatus').textContent, /no .*match|no .*found/i);
  assert.doesNotMatch(f.node('myDecksContent').innerHTML, /<img\b/);
});
test('saving the submitted new deck returns to a library containing the saved name and notes', async () => {
  const f = fixture(); await f.open(); f.context.beginNewDeck(); f.fill(); await f.context.createDeck();
  assert.equal(f.node('deckEditor').hidden, true); assert.equal(f.node('deckLibraryView').hidden, false);
  assert.equal(f.context.requests.length, 1); assert.equal(f.context.requests[0].method, 'POST');
  assert.match(f.node('myDecksContent').innerHTML, /Phone Test Deck/); assert.match(f.node('myDecksContent').innerHTML, /Safari test/);
});
test('saving an edited search result updates only that deck and returns to the same search', async () => {
  const f = fixture(); await f.open(); f.node('deckSearch').value = 'Thrasios'; f.context.renderDeckLibrary();
  f.context.beginDeckEdit('partners'); f.node('deckName').value = 'Renamed Engines'; await f.context.createDeck();
  assert.equal(f.node('deckEditor').hidden, true); assert.equal(f.node('deckSearch').value, 'Thrasios');
  assert.equal(f.context.requests[0].method, 'PATCH'); assert.equal(f.context.requests[0].url, '/api/account/decks/partners');
  assert.equal(f.context.serverDecks.length, 2); assert.match(f.node('myDecksContent').innerHTML, /Renamed Engines/);
  assert.equal(f.context.serverDecks.find(deck => deck.deckId === 'single').name, 'Phone Test Deck');
});
test('failed save leaves the editor and submitted draft available for correction or retry', async () => {
  const f = fixture({ failWrite: true }); await f.open(); f.context.beginNewDeck(); f.fill(); const draft = f.draft;
  await f.context.createDeck(); assert.equal(f.node('deckEditor').hidden, false); assert.deepEqual(f.draft, draft);
  assert.match(f.node('myDecksStatus').textContent, /could not be saved/); assert.equal(f.node('createDeckButton').disabled, false);
});
for (const sameFields of [false, true]) test(`an old save cannot close a replacement editor (${sameFields ? 'same-valued' : 'newer'} draft)`, async () => {
  const f = fixture({ waitForWrite: true }); await f.open(); f.context.beginNewDeck(); f.fill();
  const pending = f.context.createDeck(); await f.writeEntered.promise;
  f.context.cancelDeckEditor(); f.context.beginNewDeck(); f.fill(sameFields ? 'Phone Test Deck' : 'Newer draft'); const draft = f.draft;
  f.write.resolve({ ok: true }); await pending;
  assert.equal(f.node('deckEditor').hidden, false); assert.deepEqual(f.draft, draft);
});
test('private account cleanup removes the search and closes the previous private editor', async () => {
  const f = fixture(); await f.open(); f.node('deckSearch').value = 'Private query'; f.context.beginDeckEdit('single');
  f.context.clearPrivateDeckState();
  assert.equal(f.node('deckSearch').value, ''); assert.equal(f.node('deckEditor').hidden, true);
  assert.equal(f.node('deckLibraryView').hidden, false); assert.equal(f.context.savedDecks.length, 0);
  assert.doesNotMatch(f.node('myDecksContent').innerHTML, /Krenko|PRIVATE/);
});
test('Add deck stays disabled while account lookup is pending and when no session is found', async () => {
  const f = fixture({ waitForToken: true }), pending = f.open();
  assert.equal(f.node('addDeckButton').disabled, true);
  f.token.resolve(null); await pending;
  assert.equal(f.node('addDeckButton').disabled, true); assert.equal(f.node('deckEditor').hidden, true);
});
test('a failed private-library read does not enable Add deck', async () => {
  const f = fixture({ failRead: true }); await f.open();
  assert.equal(f.node('addDeckButton').disabled, true); assert.equal(f.node('deckEditor').hidden, true);
  assert.match(f.node('myDecksStatus').textContent, /not available|could not/);
});
