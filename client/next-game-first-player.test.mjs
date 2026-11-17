import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';
import { nextGameStarterPolicy } from './next-game-starter.js';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `${name} is integrated into the real app`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Continue to the closing brace. */ }
  }
  assert.fail(`Unable to load ${name}`);
}
function harness(options = {}) {
  const calls = { refreshes: 0, selections: [], starts: [], errors: [] };
  let context;
  const dom = {
    nextGameConfirmDialog: { open: false, attributes: {}, showModal() { this.open = true; }, close(value) { this.open = false; this.returnValue = value; }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } },
    nextGameConfirmDetail: {}, nextGameConfirmRoster: {}, nextGameStarter: { value: '', innerHTML: '', disabled: false }, nextGameStarterHelp: {},
    confirmNextGameStart: { disabled: false, textContent: '' }, cancelNextGameStartButton: { disabled: false }, nextGameConfirmForm: {},
  };
  context = {
    dom, nextGameConfirmation: null, nextGameStarterPending: false, nextGameStartPending: false,
    state: {
      podCode: 'ABC123', version: 8, ownerPlayerId: 'P1', localSimulation: false, hostSeatId: 0,
      gameResult: { gameId: 'finished-game' }, turn: { gameStarted: false, activeSeatId: 2, startingPlayerSeatId: 2 },
      lifecycle: { status: 'intermission', seatIds: [0, 2, 1], readySeatIds: [0, 2, 1],
        nextGameStarter: { previousStarterSeatId: 0, previousSeatIds: [0, 2, 1], defaultSeatId: 2, overrideSeatId: null } },
      players: [{ id: 'P1', name: 'Alex', connectionStatus: 'connected' }, { id: 'P2', name: 'Sam', connectionStatus: 'connected' }, { id: 'P3', name: 'Morgan', connectionStatus: 'connected' }, { id: 'P4', name: 'Removed', connectionStatus: 'connected' }],
    },
    transport: {
      status: 'connected', seatId: 0, sessionEpoch: 3,
      async refreshRoom() { calls.refreshes++; return options.refresh ? options.refresh(context) : {}; },
      async chooseStartingPlayer(seatId, { useDefault }) {
        calls.selections.push({ seatId, useDefault });
        const result = await (options.choose ? options.choose(context) : {});
        if (!result?.blocked && !result?.conflict && !result?.ignored) {
          context.state.lifecycle.nextGameStarter.overrideSeatId = useDefault ? null : seatId;
          context.state.turn.startingPlayerSeatId = useDefault ? context.state.lifecycle.nextGameStarter.defaultSeatId : seatId;
          context.state.turn.activeSeatId = context.state.turn.startingPlayerSeatId;
          context.state.version++;
        }
        return result;
      },
    },
    nextGameRosterKey: () => JSON.stringify(context.state?.lifecycle?.seatIds || []),
    nextGameConfirmationMatches(saved) {
      return Boolean(saved && context.state?.lifecycle?.status === 'intermission' && saved.roomCode === context.state.podCode
        && saved.sessionEpoch === context.transport.sessionEpoch && saved.rosterKey === context.nextGameRosterKey()
        && saved.starterSeatId === context.state.turn.startingPlayerSeatId && saved.version === context.state.version
        && context.state.lifecycle.seatIds.includes(saved.starterSeatId)
        && context.state.lifecycle.seatIds.length >= 2 && context.state.lifecycle.seatIds.every(id => context.state.lifecycle.readySeatIds.includes(id)));
    },
    async startGame(input) {
      calls.starts.push(input);
      if (options.start) await options.start(context);
      context.state.lifecycle.status = 'playing'; context.state.turn.gameStarted = true;
    },
    escapeHtml: value => String(value ?? ''), displayName: player => player?.name || player?.id || 'Player',
    renderTurnFlow() {}, render() {},
    showTableActionError(message) { calls.errors.push(message); },
    showTableRequestError(error) { calls.errors.push(error.message); },
    showError(error) { calls.errors.push(error.message); },
  };
  const functions = ['renderNextGameConfirmation', 'confirmNextGameStart', 'chooseNextGameStarter', 'submitNextGameStart'];
  const api = runInNewContext(functions.map(sourceFunction).join('\n') + '\n({renderNextGameConfirmation, confirmNextGameStart, chooseNextGameStarter, submitNextGameStart})', context);
  return { api, context, dom, calls,
    submit: (value = 'confirm') => api.submitNextGameStart({ submitter: { value }, currentTarget: dom.nextGameConfirmForm, preventDefault() {} }),
    optionValues: () => [...dom.nextGameStarter.innerHTML.matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(match => match[1]),
  };
}

test('confirmation lists Default and current players in actual table order, excluding removed seats', () => {
  const h = harness(); h.api.renderNextGameConfirmation();
  assert.deepEqual(h.optionValues(), ['default', '0', '2', '1']);
  assert.equal(h.dom.nextGameStarter.value, 'default');
  assert.match(h.dom.nextGameStarter.innerHTML, /Default[^<]*Morgan/);
  assert.doesNotMatch(h.dom.nextGameStarter.innerHTML, /Removed/);
  assert.ok(h.dom.nextGameConfirmRoster.innerHTML.indexOf('Morgan') < h.dom.nextGameConfirmRoster.innerHTML.indexOf('Sam'));
});

test('an authoritative host override stays selected when the confirmation is rendered again', () => {
  const h = harness();
  h.context.state.lifecycle.nextGameStarter.overrideSeatId = 1;
  h.context.state.turn.startingPlayerSeatId = 1;
  h.api.renderNextGameConfirmation();
  assert.equal(h.dom.nextGameStarter.value, '1');
  assert.equal(h.context.nextGameConfirmation.starterSeatId, 1);
});

test('a refreshed confirmation cannot offer Start while a listed player is unready', () => {
  const h = harness();
  h.context.state.lifecycle.readySeatIds = [0, 2];
  h.api.renderNextGameConfirmation();
  assert.equal(h.dom.confirmNextGameStart.disabled, true);
});

test('a new occupant of the departed starter seat is not described as last game’s starter', () => {
  const h = harness();
  h.context.state.lifecycle.nextGameStarter.departedSeatIds = [0];
  h.context.state.players[0].name = 'New arrival';
  h.api.renderNextGameConfirmation();
  assert.doesNotMatch(h.dom.nextGameStarterHelp.textContent, /after New arrival/);
  assert.match(h.dom.nextGameStarterHelp.textContent, /last game/);
});

test('opening the confirmation refreshes the room before displaying its current roster', async () => {
  const h = harness({ refresh(context) { context.state.version = 9; return {}; } });
  await h.api.confirmNextGameStart();
  assert.equal(h.calls.refreshes, 1);
  assert.equal(h.dom.nextGameConfirmDialog.open, true);
  assert.equal(h.context.nextGameConfirmation.version, 9);
});

test('a phase change or unready player during refresh prevents opening the confirmation', async () => {
  for (const change of [context => { context.state.lifecycle.status = 'playing'; }, context => { context.state.lifecycle.readySeatIds = [0]; }]) {
    const h = harness({ refresh(context) { change(context); return {}; } });
    await h.api.confirmNextGameStart();
    assert.equal(h.dom.nextGameConfirmDialog.open, false);
    assert.equal(h.calls.starts.length, 0);
  }
});

test('a failed room refresh never opens a stale confirmation', async () => {
  const h = harness({ refresh() { throw new Error('Refresh interrupted'); } });
  await h.api.confirmNextGameStart();
  assert.equal(h.dom.nextGameConfirmDialog.open, false);
  assert.equal(h.calls.starts.length, 0);
  assert.ok(h.calls.errors.length > 0);
});

test('choosing Default clears an override through the versioned starter request', async () => {
  const h = harness();
  h.context.state.lifecycle.nextGameStarter.overrideSeatId = 1;
  h.context.state.turn.startingPlayerSeatId = 1;
  await h.api.confirmNextGameStart(); h.dom.nextGameStarter.value = 'default';
  await h.api.chooseNextGameStarter();
  assert.deepEqual(h.calls.selections, [{ seatId: undefined, useDefault: true }]);
  assert.equal(h.dom.nextGameStarter.value, 'default');
  assert.equal(h.context.state.turn.startingPlayerSeatId, 2);
  assert.equal(h.context.nextGameConfirmation.version, 9);
});

test('choosing a listed player sends an explicit host override', async () => {
  const h = harness(); await h.api.confirmNextGameStart(); h.dom.nextGameStarter.value = '1';
  await h.api.chooseNextGameStarter();
  assert.deepEqual(h.calls.selections, [{ seatId: 1, useDefault: false }]);
  assert.equal(h.dom.nextGameStarter.value, '1');
  assert.equal(h.context.state.turn.startingPlayerSeatId, 1);
});

test('a removed seat cannot be submitted as a first-player override', async () => {
  const h = harness(); await h.api.confirmNextGameStart(); h.dom.nextGameStarter.value = '3';
  await h.api.chooseNextGameStarter();
  assert.deepEqual(h.calls.selections, []);
  assert.equal(h.calls.starts.length, 0);
});

test('Start remains blocked while a first-player selection is pending', async () => {
  let release;
  const h = harness({ choose: () => new Promise(resolve => { release = resolve; }) });
  await h.api.confirmNextGameStart(); h.dom.nextGameStarter.value = '1';
  const selecting = h.api.chooseNextGameStarter();
  assert.equal(h.dom.confirmNextGameStart.disabled, true);
  h.dom.nextGameStarter.value = '0';
  await h.api.chooseNextGameStarter();
  assert.equal(h.calls.selections.length, 1);
  await h.submit();
  assert.equal(h.calls.starts.length, 0);
  release({}); await selecting;
  assert.equal(h.context.nextGameStarterPending, false);
  assert.equal(h.dom.confirmNextGameStart.disabled, false);
});

test('a rejected starter request resets the displayed selection without starting', async () => {
  for (const choose of [() => ({ conflict: true }), () => ({ blocked: true }), () => ({ ignored: true }), () => { throw new Error('Selection interrupted'); }]) {
    const h = harness({ choose }); await h.api.confirmNextGameStart(); h.dom.nextGameStarter.value = '1';
    await h.api.chooseNextGameStarter();
    assert.equal(h.context.nextGameStarterPending, false);
    assert.equal(h.dom.nextGameStarter.value, 'default');
    assert.equal(h.calls.starts.length, 0);
  }
});

test('changed roster, starter, version, readiness or session requires a fresh confirmation before Start', async () => {
  for (const change of [
    context => { context.state.lifecycle.seatIds = [0, 1]; context.state.lifecycle.readySeatIds = [0, 1]; },
    context => { context.state.turn.startingPlayerSeatId = 1; },
    context => { context.state.version++; },
    context => { context.state.lifecycle.readySeatIds = [0]; },
    context => { context.transport.sessionEpoch++; },
    context => { context.state.lifecycle.status = 'playing'; },
  ]) {
    const h = harness(); await h.api.confirmNextGameStart(); const captured = h.context.nextGameConfirmation;
    change(h.context); await h.submit();
    assert.equal(h.calls.starts.length, 0);
    assert.ok(!h.dom.nextGameConfirmDialog.open || h.context.nextGameConfirmation !== captured, 'Stale confirmation is closed or refreshed for another deliberate confirmation');
  }
});

test('a valid confirmation starts with its captured version and closes on entering the new game', async () => {
  const h = harness(); await h.api.confirmNextGameStart();
  await h.submit();
  assert.equal(h.calls.starts.length, 1);
  assert.equal(h.calls.starts[0]?.baseVersion, 8);
  assert.equal(h.dom.nextGameConfirmDialog.open, false);
});

test('rapid repeated confirmation cannot start the same next game twice', async () => {
  let release;
  const h = harness({ start: () => new Promise(resolve => { release = resolve; }) });
  await h.api.confirmNextGameStart();
  const starting = h.submit(); await h.submit();
  assert.equal(h.calls.starts.length, 1);
  release(); await starting;
  assert.equal(h.context.nextGameStartPending, false);
});

test('local next-game setup uses the shared rotation policy through reorder, override and removal', async () => {
  const h = harness();
  Object.assign(h.context.state, { localSimulation: true });
  h.context.state.lifecycle.status = 'complete';
  h.context.state.turn.startingPlayerSeatId = 0;
  h.context.transport.status = 'local';
  Object.assign(h.context, { nextGameStarterPolicy, victoryKey: result => result?.gameId, showTableView() {} });
  const local = runInNewContext(['refreshLocalNextGameStarter', 'beginIntermission', 'moveNextGameSeat', 'skipNextGameSeat'].map(sourceFunction).join('\n') + '\n({beginIntermission, moveNextGameSeat, skipNextGameSeat})', h.context);
  await local.beginIntermission('finished-game');
  assert.deepEqual([...h.context.state.lifecycle.seatIds], [0, 2, 1]);
  assert.equal(h.context.state.turn.startingPlayerSeatId, 2);
  await local.moveNextGameSeat(1, -1);
  assert.equal(h.context.state.turn.startingPlayerSeatId, 1);
  h.context.state.lifecycle.readySeatIds = [0, 1, 2];
  await h.api.confirmNextGameStart(); h.dom.nextGameStarter.value = '2';
  await h.api.chooseNextGameStarter();
  assert.equal(h.context.state.lifecycle.nextGameStarter.overrideSeatId, 2);
  await local.moveNextGameSeat(2, -1);
  assert.equal(h.context.state.turn.startingPlayerSeatId, 2);
  assert.equal(h.context.state.lifecycle.nextGameStarter.overrideSeatId, 2);
  await local.skipNextGameSeat(2);
  assert.equal(h.context.state.lifecycle.nextGameStarter.overrideSeatId, null);
  assert.equal(h.context.state.turn.startingPlayerSeatId, 1);
  assert.equal(h.calls.selections.length, 0);
});
