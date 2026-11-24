import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDeckLibrary } from './deck-library-view.js';

const escapeHtml = value => String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const single = Object.freeze({ deckId: 'single', name: 'Phone Test Deck', commanderName: 'Krenko, Mob Boss' });
const partners = Object.freeze({ deckId: 'partners', name: 'Connected Engines', commanderName: 'Tymna / Thrasios',
  commanderNames: Object.freeze(['Tymna', 'Thrasios']), colors: Object.freeze(['W', 'U', 'B', 'G']),
  favorite: true, archived: true, notes: 'Private saved note' });

function view(decks, { query = '', editorOpen = false, initialStatus = '' } = {}) {
  const content = { innerHTML: 'Previous results', hidden: false };
  const status = { textContent: initialStatus };
  renderDeckLibrary({ content, status }, { decks, query, editorOpen, escapeHtml });
  return { content, status };
}

test('the saved collection retains favorite, archived and action labels with their exact deck ID', () => {
  const { content } = view([partners]);
  assert.equal(content.hidden, false);
  for (const text of ['★ Tymna / Thrasios', 'Archived', 'Connected Engines', 'W U B G', 'Private saved note',
    'Edit', 'Unfavorite', 'Restore', 'Export deck', 'Remove']) assert.ok(content.innerHTML.includes(text), text);
  for (const action of ['edit-deck', 'toggle-favorite', 'toggle-archive', 'export-deck', 'remove-deck']) {
    assert.ok(content.innerHTML.includes(`data-${action}="partners"`), action);
  }
  const active = view([single]).content.innerHTML;
  assert.match(active, />Favorite<\/button>/);
  assert.match(active, />Archive<\/button>/);
});

test('all saved fields and action IDs are escaped before insertion into markup', () => {
  const deck = { deckId: 'id" onclick="boom', commanderName: '<script>Commander</script>',
    name: '<img src=x onerror="boom">', notes: '<b>Private & note</b>', colors: ['W', '<svg>'] };
  const { content } = view([deck]);
  for (const value of [deck.commanderName, deck.name, deck.notes, deck.colors.join(' ')]) {
    assert.ok(content.innerHTML.includes(escapeHtml(value)), value);
  }
  for (const action of ['edit-deck', 'toggle-favorite', 'toggle-archive', 'export-deck', 'remove-deck']) {
    assert.ok(content.innerHTML.includes(`data-${action}="${escapeHtml(deck.deckId)}"`), action);
  }
  assert.doesNotMatch(content.innerHTML, /<(?:script|img|b|svg)\b/);
  assert.equal(content.innerHTML.includes('" onclick="'), false);
});

test('empty, unfiltered and filtered collections report their existing count or empty message', () => {
  const empty = view([]);
  assert.equal(empty.content.innerHTML, ''); assert.equal(empty.content.hidden, true);
  assert.equal(empty.status.textContent, 'No saved decks yet. Choose Add deck to save your first deck.');
  assert.equal(view([single]).status.textContent, '1 saved deck');
  assert.equal(view([single, partners]).status.textContent, '2 saved decks');
  const filtered = view([single, partners], { query: '  Thrasios  ' });
  assert.equal(filtered.status.textContent, '1 of 2 saved decks');
  assert.match(filtered.content.innerHTML, /Connected Engines/);
  assert.doesNotMatch(filtered.content.innerHTML, /Phone Test Deck/);
  const missing = view([single], { query: '  <img>  ' });
  assert.equal(missing.content.innerHTML, ''); assert.equal(missing.content.hidden, true);
  assert.equal(missing.status.textContent, 'No decks match “<img>”. Try a deck or commander name.');
});

test('rendering library results never replaces an open editor status', () => {
  for (const decks of [[], [single]]) {
    const { status } = view(decks, { query: 'missing', editorOpen: true, initialStatus: 'Saving the submitted draft…' });
    assert.equal(status.textContent, 'Saving the submitted draft…');
  }
});

test('searching and rendering preserve the saved collection, ordering and nested values', () => {
  const decks = Object.freeze([partners, single]);
  const before = structuredClone(decks);
  view(decks, { query: 'Krenko' });
  view(decks);
  assert.deepEqual(decks, before);
});
