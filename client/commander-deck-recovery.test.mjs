import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const key = 'fivefold-arc:confirmed-commander-deck';
function sourceFunction(name) {
  const match = new RegExp(`function ${name}\\(`).exec(app);
  assert.ok(match, `${name} is integrated into the app`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Continue to the closing brace. */ }
  }
  assert.fail(`Unable to load ${name}`);
}
function fixture() {
  const storage = new Map();
  const context = {
    state: { podCode: 'ABC123', ownerPlayerId: 'P1', activePlayerId: 'P2', localSimulation: false,
      gameResult: { gameId: 'old-game' },
      players: [{ id: 'P1', commanderCount: 1, commanderNames: ['New commander'], commanderColors: [['U']] }, { id: 'P2', commanderCount: 1, commanderNames: ['Other commander'], commanderColors: [['R']] }] },
    transport: { seatId: 0 }, selectedDeckId: 'old-deck',
    sessionStorage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) },
    victoryKey: result => result?.gameId || null,
  };
  const api = runInNewContext(['confirmedCommanderDeck', 'selectedDeckForGame', 'rememberCommanderDeck'].map(sourceFunction).join('\n') + '\n({confirmedCommanderDeck, selectedDeckForGame, rememberCommanderDeck})', context);
  return { api, context, storage };
}

test('reload restores the next-game deck without changing the previous completed game association', () => {
  const h = fixture();
  h.api.rememberCommanderDeck('new-deck', { nextGame: true });
  h.context.selectedDeckId = '';
  assert.equal(h.api.confirmedCommanderDeck()?.deckId, 'new-deck');
  assert.equal(h.api.selectedDeckForGame('new-game'), 'new-deck');
  assert.equal(h.api.selectedDeckForGame('old-game'), 'old-deck');
});

test('another room, owned seat or confirmed commander setup never restores this deck', () => {
  for (const change of [
    context => { context.state.podCode = 'XYZ789'; },
    context => { context.transport.seatId = 1; context.state.ownerPlayerId = 'P2'; },
    context => { context.state.players[0].commanderNames = ['Different commander']; },
    context => { context.state.players[0].commanderCount = 2; },
    context => { context.state.players[0].commanderColors = [['W']]; },
    context => { context.state.ownerPlayerId = 'P2'; },
  ]) {
    const h = fixture(); h.api.rememberCommanderDeck('new-deck', { nextGame: true });
    h.context.selectedDeckId = ''; change(h.context);
    assert.equal(h.api.confirmedCommanderDeck(), null);
    assert.equal(h.api.selectedDeckForGame('new-game'), '');
  }
});

test('repeated next-game edits preserve the original previous-game deck across setup changes', () => {
  const h = fixture();
  h.api.rememberCommanderDeck('new-deck', { nextGame: true });
  h.context.state.players[0].commanderNames = ['Another new commander'];
  h.api.rememberCommanderDeck('third-deck', { nextGame: true });
  h.context.selectedDeckId = '';
  assert.equal(h.api.selectedDeckForGame('new-game'), 'third-deck');
  assert.equal(h.api.selectedDeckForGame('old-game'), 'old-deck');
});

test('manual selection remains an explicit empty deck instead of falling back to the old deck', () => {
  const h = fixture();
  h.api.rememberCommanderDeck('', { nextGame: true });
  h.context.selectedDeckId = 'stale-deck';
  assert.equal(h.api.confirmedCommanderDeck()?.deckId, '');
  assert.equal(h.api.selectedDeckForGame('new-game'), '');
  assert.equal(h.api.selectedDeckForGame('old-game'), 'old-deck');
});

test('a normal confirmed setup commits its deck and preserves the legacy storage value', () => {
  const h = fixture(); h.api.rememberCommanderDeck('current-deck');
  assert.equal(h.context.selectedDeckId, 'current-deck');
  assert.equal(h.storage.get('fivefold-arc:selected-deck'), 'current-deck');
  h.context.selectedDeckId = '';
  assert.equal(h.api.selectedDeckForGame('finished-current-game'), 'current-deck');
});

test('a later intermission starts a new previous-game boundary', () => {
  const h = fixture(); h.api.rememberCommanderDeck('new-deck', { nextGame: true });
  h.context.state.gameResult = { gameId: 'new-game' };
  h.api.rememberCommanderDeck('third-deck', { nextGame: true });
  h.context.selectedDeckId = '';
  assert.equal(h.api.selectedDeckForGame('new-game'), 'new-deck');
  assert.equal(h.api.selectedDeckForGame('third-game'), 'third-deck');
});

test('malformed or unavailable optional storage safely falls back to the current selected deck', () => {
  const h = fixture(); h.storage.set(key, '{broken');
  assert.equal(h.api.confirmedCommanderDeck(), null);
  assert.equal(h.api.selectedDeckForGame('game'), 'old-deck');
  h.context.sessionStorage = { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); } };
  h.api.rememberCommanderDeck('new-deck', { nextGame: true });
  assert.equal(h.context.selectedDeckId, 'new-deck');
  assert.equal(h.api.selectedDeckForGame('new-game'), 'new-deck');
});
