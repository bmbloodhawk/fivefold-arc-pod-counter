import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `${name} is integrated into the real app`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Continue to the function's closing brace. */ }
  }
  assert.fail(`Unable to load ${name}`);
}

function harness(options = {}) {
  const calls = { ready: [], writes: [], errors: [], opens: 0, readyAtOpen: [], storage: [] };
  const fields = new Map([['gameCommanderCount', '2']]);
  const names = ['New commander A', 'New commander B'];
  const colors = [['U'], ['R']];
  let context;
  const dom = {
    commanderCountDialog: {
      open: true, dataset: {}, attributes: {},
      showModal() { this.open = true; calls.opens++; },
      close(value) { this.open = false; this.returnValue = value; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
    },
    commanderCountForm: { querySelectorAll: () => [] }, commanderCountDetail: {},
    commanderDeck: { value: 'new-deck' }, commanderDeckField: {},
    saveCommanderCountButton: { disabled: false, textContent: 'Save changes' },
    gameCommanderNames: { names: [], colors: [], replaceChildren() { this.names = []; this.colors = []; } },
  };
  context = {
    state: {
      podCode: 'ABC123', ownerPlayerId: 'P1', activePlayerId: 'P2', localSimulation: false,
      gameFormat: 'commander', gameResult: { gameId: 'finished-game' },
      lifecycle: { status: 'intermission', seatIds: [0, 1], readySeatIds: options.ready === false ? [] : [0, 1] },
      players: [{ id: 'P1', commanderCount: 1, commanderNames: ['Old commander'], commanderColors: [['G']] }, { id: 'P2', commanderCount: 1, commanderNames: ['Other commander'], commanderColors: [['W']] }],
    },
    dom, selectedDeckId: 'old-deck', pendingNextGameSetup: false,
    commanderSetupDraft: { nextGame: true, roomCode: 'ABC123', seatId: 0, sessionEpoch: 3, profileEpoch: 1, gameKey: 'finished-game', saving: false, writing: false, revision: 0 },
    commanderDecks: [{ deckId: 'new-deck', commanderNames: names, commanderColors: colors }],
    transport: {
      status: 'connected', seatId: 0, sessionEpoch: 3,
      async setNextGameReady(ready) {
        calls.ready.push(ready);
        const result = await (options.unready ? options.unready(context) : {});
        if (options.confirmUnready !== false && !result?.conflict && !result?.blocked && !result?.ignored) context.state.lifecycle.readySeatIds = context.state.lifecycle.readySeatIds.filter(id => id !== 0);
        return result;
      },
      async setNextGameCommanderSetup(count, nextNames, nextColors) {
        calls.writes.push({ count, names: [...nextNames], colors: nextColors.map(value => [...value]) });
        if (options.save) return options.save(context);
        return {};
      },
    },
    myIntermissionSeat() {
      return context.state?.lifecycle?.status === 'intermission' && context.state.lifecycle.seatIds.includes(0) && context.state.ownerPlayerId === 'P1' ? 0 : null;
    },
    openCommanderSetup({ nextGame }) {
      assert.equal(nextGame, true);
      calls.readyAtOpen.push([...context.state.lifecycle.readySeatIds]);
      dom.commanderCountDialog.showModal();
    },
    commanderSetupContextMatches: () => options.contextMatches !== false,
    FormData: class extends Map { constructor() { super(fields); } },
    commanderNamesFromForm: () => [...names], commanderColorsFromFields: () => colors.map(value => [...value]),
    confirmUnresolvedCommanderDetails: async () => options.validate ? options.validate(context) : ({ colors, unresolved: options.unresolved || [] }),
    selectedCommanderCount: () => Number(fields.get('gameCommanderCount')),
    savedDeckCommanderColors: deck => deck.commanderColors,
    renderCommanderNameFields(container, count, nextNames, nextColors) { container.count = count; container.names = [...nextNames]; container.colors = nextColors.map(value => [...value]); },
    $: () => ({ checked: false }),
    sessionStorage: { setItem(key, value) { calls.storage.push({ key, value }); } },
    showTableActionError(message) { calls.errors.push(message); },
    showTableRequestError(error) { calls.errors.push(error.message); },
    showError(error) { calls.errors.push(error.message); },
    showCommanderSetupError(message) { calls.errors.push(message); },
    rememberCommanderDeck(deckId) { context.selectedDeckId = deckId; context.sessionStorage.setItem('fivefold-arc:selected-deck', deckId); },
    render() {}, renderTurnFlow() {}, updateCommanderSetup: async () => true,
  };
  const namesToLoad = ['openNextGameSetup', 'saveCommanderSetupDraft', 'selectCommanderDeck'];
  const api = runInNewContext(namesToLoad.map(sourceFunction).join('\n') + '\n({openNextGameSetup, saveCommanderSetupDraft, selectCommanderDeck})', context);
  return { api, context, dom, calls, fields,
    submit(value = 'confirm') { return api.saveCommanderSetupDraft({ submitter: { value }, currentTarget: dom.commanderCountForm, preventDefault() {} }); },
  };
}

test('a ready player becomes unready before the next-game editor opens, with duplicate opens blocked', async () => {
  let release;
  const h = harness({ unready: () => new Promise(resolve => { release = resolve; }) });
  h.dom.commanderCountDialog.open = false;
  const first = h.api.openNextGameSetup();
  await h.api.openNextGameSetup();
  assert.equal(h.dom.commanderCountDialog.open, false);
  assert.deepEqual(h.calls.ready, [false]);
  release({}); await first;
  assert.equal(h.dom.commanderCountDialog.open, true);
  assert.equal(h.context.state.lifecycle.readySeatIds.includes(0), false);
  assert.equal(h.calls.opens, 1);
  assert.deepEqual(h.calls.readyAtOpen, [[1]]);
});

test('a player can edit directly before their first Ready', async () => {
  const h = harness({ ready: false }); h.dom.commanderCountDialog.open = false;
  await h.api.openNextGameSetup();
  assert.equal(h.dom.commanderCountDialog.open, true);
  assert.deepEqual(h.calls.ready, []);
});

test('a changed phase or removed own seat during unready prevents opening', async () => {
  for (const change of [context => { context.state.lifecycle.status = 'playing'; }, context => { context.state.lifecycle.seatIds = [1]; }]) {
    const h = harness({ unready(context) { change(context); return {}; } });
    h.dom.commanderCountDialog.open = false;
    await h.api.openNextGameSetup();
    assert.equal(h.dom.commanderCountDialog.open, false);
    assert.equal(h.calls.opens, 0);
  }
});

test('an unready conflict, blocked request or error keeps the editor closed', async () => {
  for (const unready of [() => ({ conflict: true }), () => ({ blocked: true }), () => ({ ignored: true }), () => { throw new Error('Connection interrupted'); }]) {
    const h = harness({ unready }); h.dom.commanderCountDialog.open = false;
    await h.api.openNextGameSetup();
    assert.equal(h.dom.commanderCountDialog.open, false);
    assert.equal(h.context.selectedDeckId, 'old-deck');
    assert.equal(h.context.pendingNextGameSetup, false);
  }
});

test('an unconfirmed readiness change cannot open the editor while the player remains ready', async () => {
  const h = harness({ confirmUnready: false }); h.dom.commanderCountDialog.open = false;
  await h.api.openNextGameSetup();
  assert.equal(h.dom.commanderCountDialog.open, false);
  assert.equal(h.context.state.lifecycle.readySeatIds.includes(0), true);
});

test('offline players and players outside the next-game roster cannot open the editor', async () => {
  for (const change of [context => { context.transport.status = 'disconnected'; }, context => { context.state.lifecycle.seatIds = [1]; }, context => { context.state.lifecycle.status = 'playing'; }]) {
    const h = harness({ ready: false }); change(h.context); h.dom.commanderCountDialog.open = false;
    await h.api.openNextGameSetup();
    assert.equal(h.dom.commanderCountDialog.open, false);
    assert.deepEqual(h.calls.ready, []);
  }
});

test('selecting a saved commander deck stages fields without changing the committed deck', () => {
  const h = harness();
  h.api.selectCommanderDeck({ currentTarget: h.dom.commanderDeck });
  assert.deepEqual(h.dom.gameCommanderNames.names, ['New commander A', 'New commander B']);
  assert.deepEqual(h.dom.gameCommanderNames.colors, [['U'], ['R']]);
  assert.equal(h.context.selectedDeckId, 'old-deck');
  assert.deepEqual(h.calls.storage, []);
});

test('successful next-game Save commits the selected deck, closes and stays unready', async () => {
  const h = harness({ ready: false });
  await h.submit();
  assert.deepEqual(h.calls.writes, [{ count: 2, names: ['New commander A', 'New commander B'], colors: [['U'], ['R']] }]);
  assert.equal(h.context.selectedDeckId, 'new-deck');
  assert.equal(h.dom.commanderCountDialog.open, false);
  assert.equal(h.context.state.lifecycle.readySeatIds.includes(0), false);
  assert.deepEqual(h.calls.ready, []);
  assert.equal(h.calls.storage.at(-1)?.value, 'new-deck');
});

test('local next-game Save changes the displayed owner even while another simulated seat is inspected', async () => {
  const h = harness({ ready: false });
  h.context.state.localSimulation = true;
  h.context.transport.status = 'local';
  h.context.state.commanderSources = [];
  h.context.activePlayer = () => h.context.state.players.find(player => player.id === h.context.state.activePlayerId);
  h.context.sourcesFromPlayers = () => [];
  h.context.remapLocalDamage = () => {};
  h.context.remapLocalCastCounts = () => {};
  h.context.updateCommanderSetup = runInNewContext(
    [sourceFunction('setLocalCommanderSetup'), sourceFunction('updateCommanderSetup'), 'updateCommanderSetup'].join('\n'),
    h.context
  );
  await h.submit();
  assert.equal(h.context.state.players[0].commanderCount, 2);
  assert.deepEqual(h.context.state.players[0].commanderNames, ['New commander A', 'New commander B']);
  assert.equal(h.context.state.players[1].commanderCount, 1);
  assert.deepEqual(h.context.state.players[1].commanderNames, ['Other commander']);
  assert.equal(h.calls.writes.length, 0);
});

test('validation leaves the next-game draft open without writing or committing a deck', async () => {
  const h = harness({ ready: false, unresolved: [0] });
  await h.submit();
  assert.deepEqual(h.calls.writes, []);
  assert.equal(h.dom.commanderCountDialog.open, true);
  assert.equal(h.dom.commanderDeck.value, 'new-deck');
  assert.equal(h.context.selectedDeckId, 'old-deck');
  assert.equal(h.dom.saveCommanderCountButton.disabled, false);
});

test('failed saves keep the editor draft open and preserve the committed deck for retry', async () => {
  for (const save of [() => ({ conflict: true }), () => ({ blocked: true }), () => ({ ignored: true }), () => { throw new Error('Save interrupted'); }]) {
    const h = harness({ ready: false, save });
    await h.submit();
    assert.equal(h.calls.writes.length, 1);
    assert.equal(h.dom.commanderCountDialog.open, true);
    assert.equal(h.dom.commanderDeck.value, 'new-deck');
    assert.equal(h.context.selectedDeckId, 'old-deck');
    assert.equal(h.dom.saveCommanderCountButton.disabled, false);
    assert.deepEqual(h.calls.storage, []);
  }
});

test('a changed editor context cannot save into another game, seat or profile', async () => {
  const h = harness({ ready: false, contextMatches: false });
  await h.submit();
  assert.deepEqual(h.calls.writes, []);
  assert.equal(h.context.selectedDeckId, 'old-deck');
  assert.equal(h.dom.commanderCountDialog.open, true);
});

test('a late successful response cannot commit a deck after the editor context changes', async () => {
  let release;
  const h = harness({ ready: false, save: () => new Promise(resolve => { release = resolve; }) });
  const saving = h.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.writes.length, 1);
  h.context.commanderSetupContextMatches = () => false;
  release({}); await saving;
  assert.equal(h.context.selectedDeckId, 'old-deck');
  assert.deepEqual(h.calls.storage, []);
});

test('changed commander fields during lookup cannot save the stale draft', async () => {
  let release;
  const h = harness({ ready: false, validate: () => new Promise(resolve => { release = resolve; }) });
  const saving = h.submit();
  h.context.commanderSetupDraft.revision++;
  release({ colors: [['U'], ['R']], unresolved: [] }); await saving;
  assert.deepEqual(h.calls.writes, []);
  assert.equal(h.context.selectedDeckId, 'old-deck');
  assert.equal(h.dom.commanderCountDialog.open, true);
});

test('repeated Save while the first request is pending sends only one setup change', async () => {
  let release;
  const h = harness({ ready: false, save: () => new Promise(resolve => { release = resolve; }) });
  const first = h.submit();
  await new Promise(resolve => setImmediate(resolve));
  await h.submit();
  assert.equal(h.calls.writes.length, 1);
  release({}); await first;
  assert.equal(h.context.selectedDeckId, 'new-deck');
});

test('Cancel after choosing a different deck never commits that choice', async () => {
  const h = harness({ ready: false });
  h.api.selectCommanderDeck({ currentTarget: h.dom.commanderDeck });
  await h.submit('cancel');
  assert.equal(h.context.selectedDeckId, 'old-deck');
  assert.deepEqual(h.calls.writes, []);
  assert.deepEqual(h.calls.storage, []);
});
