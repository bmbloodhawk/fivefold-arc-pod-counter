import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, Script } from 'node:vm';
import { renderDeckLibrary as renderSavedDeckLibrary } from './deck-library-view.js';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `Actual app function ${name} exists.`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const text = app.slice(match.index, end + 1);
    try { new Script(`(${text})`); return text; } catch { /* Keep the complete function. */ }
  }
  assert.fail(`Complete function ${name} was not found.`);
}
function sourceStatement(prefix, last = false) {
  const start = last ? app.lastIndexOf(prefix) : app.indexOf(prefix);
  assert.ok(start >= 0, `Actual event binding ${prefix} exists.`);
  for (let end = app.indexOf(';', start); end >= 0; end = app.indexOf(';', end + 1)) {
    const text = app.slice(start, end + 1);
    try { new Script(text); return text; } catch { /* Include the arrow callback body. */ }
  }
  assert.fail(`Complete statement ${prefix} was not found.`);
}
const from = app.indexOf('let deckEditorOpen');
const source = app.slice(from, app.indexOf('async function saveAccountPreferences(', from))
  + '\n' + ['escapeHtml', 'normaliseIdentity', 'lookupCommanderIdentity'].map(sourceFunction).join('\n')
  + '\n' + sourceStatement('[deckCommanderName, deckCommanderNameTwo].forEach(')
  + '\n' + sourceStatement("$$('input[name=\"deckCommanderCount\"]').forEach(", true)
  + '\n' + ["closeMyDecksButton.addEventListener('click'", "myDecksDialog.addEventListener('cancel'", "myDecksDialog.addEventListener('close'"]
    .filter(prefix => app.includes(prefix)).map(prefix => sourceStatement(prefix)).join('\n');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const exact = (name, colors) => ({ kind: 'exact', card: { name, colors } });
const selection = (...matches) => ({ kind: 'selection', matches });
const krenko = { name: 'Krenko, Mob Boss', colors: ['R'] };
const tinStreet = { name: 'Krenko, Tin Street Kingpin', colors: ['R'] };

function fixture({ count = '1', names = ['kranko mob boss', ''], replies = {} } = {}) {
  let context, activeCount = count, latestLookup;
  const nodes = new Map();
  function element(tag = 'DIV', connected = true) {
    const listeners = new Map(), attributes = new Map(); let text = '', html = '';
    const node = { tagName: tag.toUpperCase(), rootConnected: connected, parentNode: null, children: [], value: '', checked: false,
      hidden: false, disabled: false, dataset: {}, className: '',
      get isConnected() { return this.parentNode ? this.parentNode.isConnected : this.rootConnected; },
      get textContent() { return text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.replaceChildren(); text = String(value); },
      get innerHTML() { return html; }, set innerHTML(value) { this.replaceChildren(); html = String(value); },
      append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } },
      appendChild(child) { this.append(child); return child; },
      replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; text = ''; html = ''; this.append(...children); },
      contains(child) { return this.children.some(item => item === child || item.contains?.(child)); },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(selector === 'button' && child.tagName === 'BUTTON' ? [child] : []), ...child.querySelectorAll(selector)]); },
      setAttribute(name, value) { attributes.set(name, String(value)); }, removeAttribute(name) { attributes.delete(name); },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
      dispatch(type) { const event = { currentTarget: this, target: this, preventDefault() {} }; this[`on${type}`]?.(event); for (const callback of listeners.get(type) || []) callback(event); },
      click() { if (!this.disabled) this.dispatch('click'); }, focus() { context.document.activeElement = this; }, scrollIntoView() {}, reset() {},
    };
    return node;
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const radios = ['1', '2'].map(value => { const input = element('INPUT'); input.value = value;
    Object.defineProperty(input, 'checked', { get: () => activeCount === value, set(selected) { if (selected) activeCount = value; } }); return input; });
  const colors = ['W', 'U', 'B', 'R', 'G'].map(value => Object.assign(element('INPUT'), { value }));
  const fields = ['deckLibraryView', 'deckEditor', 'deckSearch', 'addDeckButton', 'cancelDeckEditorButton', 'myDecksTitle', 'closeMyDecksButton',
    'deckCommanderName', 'deckCommanderNameTwo', 'deckCommanderNameTwoField', 'deckName', 'deckNotes', 'deckFavorite',
    'deckCommanderStatus', 'myDecksStatus', 'createDeckButton', 'findDeckColorsButton', 'myDecksSignInButton', 'myDecksContent'];
  const deck = { deckId: 'existing', commanderName: 'Existing commander', commanderNames: ['Existing commander'], name: 'Existing deck', notes: 'Existing notes', colors: ['G'] };
  const replyMap = new Map(Object.entries({
    'kranko mob boss': selection(krenko), 'krenko mob boss': exact(krenko.name, krenko.colors),
    [krenko.name]: exact(krenko.name, krenko.colors), [tinStreet.name]: exact(tinStreet.name, tinStreet.colors), ...replies,
  }));
  const dialog = Object.assign(element('DIALOG'), { open: true,
    showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); } });
  context = createContext({ ...Object.fromEntries(fields.map(name => [name, node(name)])),
    renderSavedDeckLibrary,
    deckCommanderMatches: [node('deckCommanderMatches'), node('deckCommanderMatchesTwo')],
    awardProfileEpoch: 0, editingDeckId: null, deckCommanderColors: [], selectedDeckId: '', savedDecks: [deck], setupDecks: [], commanderDecks: [],
    myDecksDialog: dialog,
    document: { activeElement: null, createElement: tag => element(tag, false) }, window: { scrollTo() {} },
    IDENTITY_ORDER: ['W', 'U', 'B', 'R', 'G'], sessionStorage: { removeItem() {} },
    apiBaseFromPage: () => '', currentAccountToken: async () => 'fixture-account', googleAccountToken: async () => 'fixture-account',
    renderHomeAccount() {}, resetAwardProfile() { context.awardProfileEpoch++; }, loadSetupDecks: async () => {},
    $(selector) { if (selector.startsWith('input[name="deckCommanderCount"]')) { const value = /\[value="([12])"\]/.exec(selector)?.[1]; return radios.find(input => input.value === (value || activeCount)); } return node(selector.replace(/^#/, '')); },
    $$(selector) { if (selector === 'input[name="deckColors"]') return colors; if (selector === 'input[name="deckColors"]:checked') return colors.filter(input => input.checked); if (selector === 'input[name="deckCommanderCount"]') return radios; return []; },
    dom: Object.fromEntries(['createDeck', 'joinDeck', 'saveGameDeck', 'commanderDeck', 'createDeckField', 'joinDeckField', 'commanderDeckField'].map(name => [name, element()])),
    lookups: [], writes: [],
    async fetch(url, options = {}) {
      if (url.startsWith('/api/commander-identity?')) {
        const name = new URL(url, 'http://fixture.invalid').searchParams.get('name'); context.lookups.push(name);
        let reply = replyMap.get(name); if (typeof reply === 'function') reply = await reply();
        if (reply instanceof Error) throw reply;
        return { ok: Boolean(reply), status: reply ? 200 : 404, json: async () => reply || { error: { message: 'No commander found.' } } };
      }
      if (options.body) { context.writes.push({ url, method: options.method, body: JSON.parse(options.body) }); return { ok: true }; }
      return { ok: true, json: async () => ({ decks: [deck] }) };
    },
  });
  runInContext(source, context);
  const confirm = context.confirmDeckCommanderColors;
  context.confirmDeckCommanderColors = (...args) => { latestLookup = confirm(...args); return latestLookup; };
  context.beginNewDeck(); activeCount = count; node('deckCommanderName').value = names[0]; node('deckCommanderNameTwo').value = names[1] || '';
  node('deckName').value = 'Phone Test Deck'; node('deckNotes').value = 'Safari test';
  return { context, node, radios, colors, replies: replyMap,
    find: () => context.confirmDeckCommanderColors(), save: () => context.createDeck(),
    buttons: slot => context.deckCommanderMatches[slot].querySelectorAll('button'),
    async click(button) { assert.ok(button, 'A suggested commander button is rendered.'); button.click(); await settle(); if (latestLookup) await latestLookup; },
    edit(slot, value) { const input = slot ? node('deckCommanderNameTwo') : node('deckCommanderName'); input.value = value; input.dispatch('input'); },
  };
}

test('a missing comma exact response still canonicalizes directly and confirms Red', async () => {
  const f = fixture({ names: ['krenko mob boss'] }); assert.equal(await f.find(), true);
  assert.equal(f.node('deckCommanderName').value, krenko.name); assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['R']);
  assert.equal(f.buttons(0).length, 0);
});
test('a typo selection response offers a real choice instead of only reporting lookup failure', async () => {
  const f = fixture(); assert.equal(await f.find(), false);
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.buttons(0).length, 1);
  assert.match(f.buttons(0)[0].textContent, /Krenko, Mob Boss/); assert.equal(f.buttons(0)[0].type, 'button');
  assert.equal(f.context.writes.length, 0);
});
test('choosing one of several candidates applies that candidate and confirms its colors', async () => {
  const f = fixture({ names: ['krenko'], replies: { krenko: selection(krenko, tinStreet) } }); await f.find();
  assert.equal(f.buttons(0).length, 2); await f.click(f.buttons(0)[1]);
  assert.equal(f.node('deckCommanderName').value, tinStreet.name); assert.equal(f.context.document.activeElement, f.node('deckCommanderName'));
  assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['R']); assert.equal(f.buttons(0).length, 0);
});
test('Save blocks an unresolved selection and never writes the typed typo through manual fallback', async () => {
  const f = fixture(); await f.save(); assert.equal(f.context.writes.length, 0);
  assert.equal(f.node('deckEditor').hidden, false); assert.equal(f.buttons(0).length, 1); assert.equal(f.node('createDeckButton').disabled, false);
});
test('choosing a Save suggestion confirms it but saving still requires an explicit second Save', async () => {
  const f = fixture(); await f.save(); await f.click(f.buttons(0)[0]); assert.equal(f.context.writes.length, 0);
  await f.save(); assert.equal(f.context.writes.length, 1);
  assert.deepEqual([...f.context.writes[0].body.commanderNames], [krenko.name]); assert.deepEqual([...f.context.writes[0].body.colors], ['R']);
});
test('paired lookup exposes either rejected field and applies colors atomically after choosing it', async () => {
  const tymna = { name: 'Tymna the Weaver', colors: ['W', 'B'] }, thrasios = { name: 'Thrasios, Triton Hero', colors: ['U', 'G'] };
  const f = fixture({ count: '2', names: ['tymna weavr', 'thrasios triton hero'], replies: {
    'tymna weavr': selection(tymna), [tymna.name]: exact(tymna.name, tymna.colors), 'thrasios triton hero': exact(thrasios.name, thrasios.colors), [thrasios.name]: exact(thrasios.name, thrasios.colors),
  } });
  f.colors.find(input => input.value === 'R').checked = true; await f.find();
  assert.equal(f.buttons(0).length, 1); assert.equal(f.buttons(1).length, 0);
  assert.equal(f.node('deckCommanderNameTwo').value, 'thrasios triton hero'); assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['R']);
  await f.click(f.buttons(0)[0]); assert.equal(f.node('deckCommanderNameTwo').value, thrasios.name);
  assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['W', 'U', 'B', 'G']);
});
test('two rejected partner names each get their own candidate buttons', async () => {
  const f = fixture({ count: '2', names: ['first typo', 'second typo'], replies: { 'first typo': selection(krenko), 'second typo': selection(tinStreet) } });
  await f.find(); assert.equal(f.buttons(0).length, 1); assert.equal(f.buttons(1).length, 1);
});
test('choosing a second-commander suggestion changes only that commander field', async () => {
  const f = fixture({ count: '2', names: [krenko.name, 'second typo'], replies: { 'second typo': selection(tinStreet) } });
  await f.find(); assert.equal(f.buttons(0).length, 0); await f.click(f.buttons(1)[0]);
  assert.equal(f.node('deckCommanderName').value, krenko.name); assert.equal(f.node('deckCommanderNameTwo').value, tinStreet.name);
  assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['R']);
});
test('a selection in either partner blocks Save even if the other lookup is unavailable', async () => {
  const f = fixture({ count: '2', names: ['kranko mob boss', 'offline'], replies: { offline: new Error('Network unavailable') } });
  await f.save(); assert.equal(f.context.writes.length, 0); assert.equal(f.buttons(0).length, 1);
});
for (const [name, reply] of [['unknown commander', null], ['offline', new Error('Network unavailable')]]) {
  test(`genuine lookup failure still permits the existing manual-color Save (${name})`, async () => {
    const f = fixture({ names: [name], replies: { [name]: reply } }); f.colors.find(input => input.value === 'G').checked = true;
    await f.save(); assert.equal(f.context.writes.length, 1); assert.deepEqual([...f.context.writes[0].body.commanderNames], [name]);
    assert.deepEqual([...f.context.writes[0].body.colors], ['G']);
  });
}
test('a genuine Find failure preserves manual colors and reports the fallback', async () => {
  const f = fixture({ names: ['unknown commander'] }); f.colors.find(input => input.value === 'G').checked = true;
  assert.equal(await f.find(), false); assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['G']);
  assert.match(f.node('deckCommanderStatus').textContent, /kept/);
});
test('a delayed selection lookup cannot publish choices for an edited name', async () => {
  const gate = deferred(), f = fixture({ replies: { 'kranko mob boss': () => gate.promise } });
  const pending = f.find(); await settle(); f.edit(0, 'New draft');
  gate.resolve(selection(krenko)); await pending;
  assert.equal(f.node('deckCommanderName').value, 'New draft'); assert.equal(f.buttons(0).length + f.buttons(1).length, 0);
});
test('a Save selection arriving after an edit blocks the old typo without publishing old choices', async () => {
  const gate = deferred(), f = fixture({ replies: { 'kranko mob boss': () => gate.promise } });
  const pending = f.save(); await settle(); f.edit(0, 'New draft');
  gate.resolve(selection(krenko)); await pending;
  assert.equal(f.context.writes.length, 0); assert.equal(f.node('deckCommanderName').value, 'New draft');
  assert.equal(f.buttons(0).length + f.buttons(1).length, 0);
});
test('editing the name clears suggestions and makes an old button inert', async () => {
  const f = fixture(); await f.find(); const old = f.buttons(0)[0]; f.edit(0, 'New draft'); const before = f.context.lookups.length;
  assert.equal(f.buttons(0).length, 0); await f.click(old);
  assert.equal(f.node('deckCommanderName').value, 'New draft'); assert.equal(f.context.lookups.length, before);
});
test('changing paired to single clears both panels and makes the old partner button inert', async () => {
  const f = fixture({ count: '2', names: [krenko.name, 'second typo'], replies: { 'second typo': selection(tinStreet) } });
  await f.find(); const old = f.buttons(1)[0]; f.radios[0].checked = true; f.radios[0].dispatch('change');
  assert.equal(f.buttons(0).length + f.buttons(1).length, 0); await f.click(old); assert.equal(f.node('deckCommanderNameTwo').value, '');
});
for (const mode of ['find', 'save']) test(`Cancel/Add retires an old ${mode} choice even for a same-valued new draft`, async () => {
  const f = fixture(); await f[mode](); const old = f.buttons(0)[0];
  f.context.cancelDeckEditor(); f.context.beginNewDeck(); f.edit(0, 'kranko mob boss'); const before = f.context.lookups.length;
  await f.click(old); assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
});
test('account cleanup removes suggestions and rejects an old account candidate click', async () => {
  const f = fixture(); await f.find(); const old = f.buttons(0)[0]; f.context.awardProfileEpoch++; f.context.clearPrivateDeckState({ signedIn: true });
  f.context.beginNewDeck(); f.edit(0, 'kranko mob boss'); const before = f.context.lookups.length;
  await f.click(old); assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
});
test('removing candidate nodes makes an old queued click inert even if its fields remain unchanged', async () => {
  const f = fixture(); await f.find(); const old = f.buttons(0)[0]; f.context.clearDeckCommanderMatches(); const before = f.context.lookups.length;
  await f.click(old); assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
});
test('suggestion labels are text and do not create markup from the candidate name', async () => {
  const name = '<img src=x onerror=alert(1)>';
  const f = fixture({ replies: { 'kranko mob boss': selection({ name, colors: ['R'] }) } }); await f.find();
  assert.equal(f.buttons(0).length, 1); assert.ok(f.buttons(0)[0].textContent.includes(name));
  assert.equal(f.buttons(0)[0].children.length, 0);
});
test('each commander offers at most five candidate choices', async () => {
  const matches = Array.from({ length: 8 }, (_, index) => ({ name: `Candidate ${index + 1}`, colors: ['R'] }));
  const f = fixture({ count: '2', names: ['first typo', 'second typo'], replies: {
    'first typo': selection(...matches), 'second typo': selection(...matches),
  } });
  await f.find();
  for (const slot of [0, 1]) {
    assert.equal(f.buttons(slot).length, 5);
    assert.ok(f.buttons(slot)[4].textContent.includes('Candidate 5'));
    assert.equal(f.buttons(slot).some(button => button.textContent.includes('Candidate 6')), false);
  }
});
test('native dismissal clears choices and an old candidate cannot alter a later editor', async () => {
  const f = fixture(); await f.find(); const old = f.buttons(0)[0];
  f.context.myDecksDialog.close(); const before = f.context.lookups.length;
  await f.click(old);
  assert.equal(f.node('deckCommanderName').value, ''); assert.equal(f.buttons(0).length, 0);
  assert.equal(f.context.lookups.length, before); assert.equal(f.context.writes.length, 0);
  f.context.openMyDecks(); assert.equal(f.node('deckEditor').hidden, true);
  f.context.beginNewDeck(); f.edit(0, 'kranko mob boss'); await f.click(old);
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
  await f.find(); await f.click(f.buttons(0)[0]);
  assert.equal(f.node('deckCommanderName').value, krenko.name);
});
test('successful Save clears existing suggestions and leaves an old candidate inert', async () => {
  const f = fixture(); await f.find(); const old = f.buttons(0)[0];
  assert.ok(old, 'The editor has an unresolved candidate before Save.');
  f.replies.set('kranko mob boss', exact(krenko.name, krenko.colors));
  await f.save();
  assert.equal(f.context.writes.length, 1); assert.equal(f.node('deckEditor').hidden, true);
  assert.equal(f.buttons(0).length + f.buttons(1).length, 0);
  assert.ok(f.context.deckCommanderMatches.every(panel => panel.hidden));
  f.context.beginNewDeck(); f.edit(0, 'kranko mob boss'); const before = f.context.lookups.length;
  await f.click(old);
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
});
test('a new lookup retires its previous candidate before the replacement reply arrives', async () => {
  const gate = deferred(), f = fixture(); await f.find(); const old = f.buttons(0)[0];
  assert.ok(old, 'The editor has a candidate from the previous lookup.');
  f.replies.set('kranko mob boss', () => gate.promise);
  const pending = f.find(); await settle(); const before = f.context.lookups.length;
  assert.equal(f.buttons(0).length, 0); old.click(); await settle();
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
  gate.resolve(selection(tinStreet)); await pending;
  assert.equal(f.buttons(0).length, 1); assert.ok(f.buttons(0)[0].textContent.includes(tinStreet.name));
});
test('an offered Save candidate still confirms after editing notes and the explicit later Save uses those notes', async () => {
  const f = fixture(); await f.save();
  f.node('deckNotes').value = 'Updated while choosing my commander';
  await f.click(f.buttons(0)[0]);
  assert.equal(f.node('deckCommanderName').value, krenko.name);
  assert.equal(f.node('deckNotes').value, 'Updated while choosing my commander');
  assert.deepEqual(f.colors.filter(input => input.checked).map(input => input.value), ['R']);
  assert.equal(f.context.writes.length, 0, 'Choosing a card never resumes the previous Save.');
  await f.save(); assert.equal(f.context.writes.length, 1);
  assert.equal(f.context.writes[0].body.notes, 'Updated while choosing my commander');
  assert.deepEqual([...f.context.writes[0].body.commanderNames], [krenko.name]);
});
test('a delayed Save selection after editing notes does not publish choices for its old submitted draft', async () => {
  const gate = deferred(), f = fixture({ replies: { 'kranko mob boss': () => gate.promise } });
  const pending = f.save(); await settle(); f.node('deckNotes').value = 'Newer private notes';
  gate.resolve(selection(krenko)); await pending;
  assert.equal(f.context.writes.length, 0);
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.node('deckNotes').value, 'Newer private notes');
  assert.equal(f.buttons(0).length + f.buttons(1).length, 0);
});
for (const mode of ['find', 'save']) test(`header Close retires a delayed ${mode} selection before a same-valued replacement editor`, async () => {
  const gate = deferred(), f = fixture({ replies: { 'kranko mob boss': () => gate.promise } });
  const pending = f[mode](); await settle(); f.node('closeMyDecksButton').dispatch('click');
  assert.equal(f.context.myDecksDialog.open, true); assert.equal(f.node('deckEditor').hidden, true);
  assert.equal(f.node('deckCommanderName').value, '');
  f.context.beginNewDeck(); f.edit(0, 'kranko mob boss');
  gate.resolve(selection(krenko)); await pending;
  assert.equal(f.buttons(0).length + f.buttons(1).length, 0, 'The canceled editor cannot offer choices in its same-valued replacement.');
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss');
  assert.equal(f.node('deckEditor').hidden, false); assert.equal(f.context.writes.length, 0);
});
test('header Close clears offered choices and keeps their old candidate inert in a replacement editor', async () => {
  const f = fixture(); await f.find(); const old = f.buttons(0)[0];
  f.node('closeMyDecksButton').dispatch('click');
  assert.equal(f.context.myDecksDialog.open, true); assert.equal(f.node('deckEditor').hidden, true);
  assert.equal(f.buttons(0).length + f.buttons(1).length, 0);
  f.context.beginNewDeck(); f.edit(0, 'kranko mob boss'); const before = f.context.lookups.length;
  await f.click(old);
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss'); assert.equal(f.context.lookups.length, before);
  assert.equal(f.context.writes.length, 0);
});
test('a failed suggestion render cannot let Save fall back to writing the unresolved typo', async () => {
  const f = fixture();
  f.context.deckCommanderMatches[0].scrollIntoView = () => { throw new Error('Suggestion scrolling failed'); };
  await f.save();
  assert.equal(f.context.writes.length, 0, 'A rendering failure cannot turn a required card choice into a manual-color save.');
  assert.equal(f.node('deckCommanderName').value, 'kranko mob boss');
  assert.equal(f.node('createDeckButton').disabled, false);
});
