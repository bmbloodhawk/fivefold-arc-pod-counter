import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, Script } from 'node:vm';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `Actual app function ${name} exists.`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Find the complete function. */ }
  }
  assert.fail(`Complete app function ${name} was not found.`);
}
const source = ['displayName', 'displayPlayer', 'displaySource', 'renderStatusMessage', 'renderLifeChange',
  'showLifeChange', 'countersLocked', 'renderMutationAvailability', 'render'].map(sourceFunction).join('\n');

function element() {
  let text = '', children = [];
  const classes = new Set(), attributes = new Map(), descendants = new Map();
  return { hidden: false, disabled: false, value: '', dataset: {}, style: { setProperty() {} },
    get textContent() { return text + children.map(child => child.textContent).join(' '); },
    set textContent(value) { text = String(value); children = []; },
    replaceChildren(...next) { text = ''; children = next; }, append(...next) { children.push(...next); },
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    setAttribute(name, value) { attributes.set(name, String(value)); }, getAttribute: name => attributes.get(name),
    querySelector(selector) { if (!descendants.has(selector)) descendants.set(selector, element()); return descendants.get(selector); },
    closest(selector) { return this.querySelector(selector); }, before() {}, prepend() {},
  };
}

function fixture({ active = 'P1', mode = 'life', format = 'commander', local = false, warning = null, preview = null } = {}) {
  const nodes = new Map(), deltas = [element(), element()], timers = new Map();
  let nextTimer = 0;
  const node = name => { if (!nodes.has(name)) nodes.set(name, element()); return nodes.get(name); };
  const dom = new Proxy({}, { get: (_, name) => node(name) });
  dom.inspectionNotice.hidden = true;
  const players = [{ id: 'P1', name: 'Phone Test', life: 40, commanderCount: 1 },
    { id: 'P2', name: 'Other Player', life: 40, commanderCount: 1 }];
  players.find(player => player.id === active).warning = warning;
  const context = createContext({ dom, state: { gameFormat: format, mode, localSimulation: local,
    ownerPlayerId: 'P1', activePlayerId: active, podCode: 'TEST', hostSeatId: 0, players, commanderCastCounts: {},
    turn: { gameStarted: true }, lifecycle: { status: 'playing' } }, interfaceStyle: 'dial',
    lifeChange: preview, lifeChangeTimer: null, pendingEliminationUndoId: null, announcedEliminationUndoId: null,
    transport: { status: local ? 'local' : 'connected', seatId: 0 }, developerMode: false, publishedSkins: [],
    document: { createElement: () => element() }, clearTimeout(timer) { timers.delete(timer); },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    $: selector => node(selector), $$: selector => selector === '[data-delta]' ? deltas : [],
    activePlayer() { return context.state.players.find(player => player.id === context.state.activePlayerId); },
    selectedSourceFor: () => ({ ownerPlayerId: 'P1', commanderName: 'Krenko, Mob Boss' }),
    tablePositionLabel: player => player.id, currentValue: player => player.life,
    playerIdentity: () => ['R'], identityBackground: () => '', canReturnToSetup: () => false,
    unlockedSkinChoices: () => [], tableSkinOptions: () => '', dialLayout: { update() {} }, productionSkinRenderer: { refreshArt() {} },
    ...Object.fromEntries(['renderDeveloperTools', 'evaluatePlayer', 'localLastPlayerStanding', 'renderPodStrip',
      'renderSources', 'renderModeNav', 'renderSeatPicker', 'renderCoinTossNotice', 'renderVictory', 'syncGameWakeLock',
      'renderDeviceAppearanceChoice', 'renderCommanderTaxQuick', 'renderTurnFlow', 'renderCommanderTaxDialog', 'saveLocal'].map(name => [name, () => {}])),
  });
  runInContext(source, context);
  return { context, dom, deltas, render: () => context.render(),
    feedback() { return [dom.statusMessage, dom.lifeChangeIndicator].filter(item => !item.hidden).map(item => item.textContent).join(' '); },
    expire() {
      assert.equal(timers.size, 1); const timer = [...timers.values()][0]; assert.equal(timer.delay, 4000);
      timers.clear(); timer.callback();
    },
  };
}

test('the owned counter shows the player name without a redundant YOU label and keeps its controls usable', () => {
  const f = fixture(); f.render();
  assert.equal(f.dom.counterContext.textContent, 'Phone Test');
  assert.equal(f.dom.dialGesture.getAttribute('aria-disabled'), 'false');
  assert.ok(f.deltas.every(button => !button.disabled));
  assert.doesNotMatch(f.feedback(), /VIEW ONLY/);
});
test('Commander counter context names the player while its source card carries the damage source', () => {
  const f = fixture({ mode: 'commander' }); f.render();
  assert.equal(f.dom.counterContext.textContent, 'Phone Test');
  assert.doesNotMatch(f.dom.counterContext.textContent, /DAMAGE FROM|Krenko|YOU/);
});
test('an inspected counter names its player and puts VIEW ONLY in existing feedback without an inspection strip', () => {
  const f = fixture({ active: 'P2' }); f.render();
  assert.equal(f.dom.counterContext.textContent, 'Other Player');
  assert.match(f.feedback(), /VIEW ONLY/); assert.equal(f.dom.inspectionNotice.hidden, true);
  assert.equal(f.dom.dialGesture.getAttribute('aria-disabled'), 'true');
  assert.ok(f.deltas.every(button => button.disabled));
});
test('VIEW ONLY feedback retains an inspected player warning', () => {
  const f = fixture({ active: 'P2', warning: 'LOW LIFE' }); f.render();
  assert.match(f.feedback(), /VIEW ONLY/); assert.match(f.feedback(), /LOW LIFE/);
  assert.equal((f.feedback().match(/LOW LIFE/g) || []).length, 1, 'Only one visible feedback output carries the warning.');
});
test('VIEW ONLY feedback retains the commander source and near-lethal warning', () => {
  const f = fixture({ active: 'P2', mode: 'commander', warning: 'Krenko, Mob Boss NEAR LETHAL' }); f.render();
  assert.match(f.feedback(), /VIEW ONLY/); assert.match(f.feedback(), /Krenko, Mob Boss/); assert.match(f.feedback(), /NEAR LETHAL/);
  assert.equal((f.feedback().match(/Krenko, Mob Boss/g) || []).length, 1);
  assert.equal((f.feedback().match(/NEAR LETHAL/g) || []).length, 1);
});
test('switching from an owned life preview to inspection shows VIEW ONLY and the inspected safety warning', () => {
  const f = fixture({ active: 'P2', warning: 'LOW LIFE', preview: { playerId: 'P1', delta: 3, from: 2, to: 5 } }); f.render();
  assert.match(f.feedback(), /VIEW ONLY/); assert.match(f.feedback(), /LOW LIFE/);
  assert.doesNotMatch(f.feedback(), /\+3 LIFE/); assert.equal(f.context.lifeChange, null);
});
test('commander damage details appear only while inspecting Commander mode in Commander format', () => {
  for (const [options, hidden] of [
    [{ active: 'P2', mode: 'life' }, true], [{ active: 'P2', mode: 'poison' }, true],
    [{ active: 'P2', mode: 'commander' }, false], [{ active: 'P1', mode: 'commander' }, true],
    [{ active: 'P2', mode: 'life', format: 'casual' }, true], [{ active: 'P2', mode: 'commander', local: true }, true],
  ]) {
    const f = fixture(options); f.render();
    assert.equal(f.dom.commanderDamageDetails.hidden, hidden, JSON.stringify(options));
  }
});
test('a simulated seat retains its simulation label and its editable local controls', () => {
  const f = fixture({ active: 'P2', local: true }); f.render();
  assert.equal(f.dom.counterContext.textContent, 'Other Player · SIMULATED');
  assert.doesNotMatch(f.feedback(), /VIEW ONLY/); assert.ok(f.deltas.every(button => !button.disabled));
});
test('returning from inspection to a quiet owned counter clears stale feedback text and styling', () => {
  const f = fixture({ preview: { playerId: 'P1', delta: -3, from: 40, to: 37 } }); f.render();
  assert.match(f.feedback(), /3 LIFE/); assert.equal(f.dom.lifeChangeIndicator.classList.contains('negative'), true);
  f.context.state.activePlayerId = 'P2'; f.render();
  assert.match(f.feedback(), /VIEW ONLY/); assert.equal(f.dom.lifeChangeIndicator.classList.contains('view-only'), true);
  f.context.state.activePlayerId = 'P1'; f.render();
  assert.equal(f.context.lifeChange, null); assert.equal(f.dom.lifeChangeIndicator.hidden, true);
  assert.equal(f.dom.lifeChangeIndicator.textContent, ''); assert.equal(f.feedback(), '');
  assert.equal(f.dom.lifeChangeIndicator.classList.contains('view-only'), false);
  assert.equal(f.dom.lifeChangeIndicator.classList.contains('negative'), false);
  assert.equal(f.dom.counterContext.textContent, 'Phone Test'); assert.ok(f.deltas.every(button => !button.disabled));
});
test('an owned warning shares its life preview then returns once to the standalone warning after expiry', () => {
  const f = fixture({ warning: 'LOW LIFE' }); f.context.state.players[0].life = 4;
  f.context.showLifeChange('P1', -1, 5, 4);
  assert.equal(f.dom.statusMessage.hidden, true); assert.equal(f.dom.lifeChangeIndicator.hidden, false);
  assert.match(f.feedback(), /LOW LIFE/); assert.match(f.feedback(), /1 LIFE/);
  assert.equal((f.feedback().match(/LOW LIFE/g) || []).length, 1); assert.doesNotMatch(f.feedback(), /VIEW ONLY/);
  f.expire();
  assert.equal(f.context.lifeChange, null); assert.equal(f.dom.lifeChangeIndicator.hidden, true);
  assert.equal(f.dom.statusMessage.hidden, false); assert.equal(f.feedback(), 'LOW LIFE');
  assert.equal((f.feedback().match(/LOW LIFE/g) || []).length, 1); assert.doesNotMatch(f.feedback(), /VIEW ONLY/);
});
