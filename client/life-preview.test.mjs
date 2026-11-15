import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

function previewHarness() {
  const player = { id: 'P1', life: 40 };
  const timers = new Map();
  const sends = [];
  const indicator = { hidden: true, textContent: '', classList: { toggle() {} } };
  let nextTimer = 0;
  let functions;
  const context = {
    state: { mode: 'life', ownerPlayerId: 'P1', localSimulation: false, lifecycle: { status: 'playing' } },
    dom: { lifeChangeIndicator: indicator }, lifeChange: null, lifeChangeTimer: null, optimisticLifeDelta: 0,
    transport: { status: 'connected' }, lifeBatcher: { add: delta => sends.push(delta) },
    activePlayer: () => player, currentValue: () => player.life + context.optimisticLifeDelta,
    countersLocked: () => false, render: () => functions?.renderLifeChange(player),
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: timer => timers.delete(timer),
  };
  functions = runInNewContext([
    section('function renderLifeChange(', 'function countersLocked('),
    section('function showLifeChange(', 'function coinTossLabel('),
    section('async function adjust(', 'function remapLocalDamage('),
    '({ showLifeChange, renderLifeChange, adjust })',
  ].join('\n'), context);
  return { player, context, indicator, sends, functions, expire() {
    assert.equal(timers.size, 1);
    const timer = [...timers.values()][0];
    assert.equal(timer.delay, 4000);
    timers.clear(); timer.callback();
  } };
}

test('an acknowledged -13 followed by +3 remains one -10 preview', async () => {
  const h = previewHarness();
  await h.functions.adjust(-13);
  h.player.life = 27; h.context.optimisticLifeDelta = 0; // confirmed HTTP batch
  await h.functions.adjust(3);
  assert.equal(h.context.lifeChange.from, 40);
  assert.equal(h.context.lifeChange.to, 30);
  assert.equal(h.context.lifeChange.delta, -10);
  assert.equal(h.indicator.textContent, '−10 LIFE · 40 → 30');
});

test('a correction before the earlier response arrives still keeps the preview net', async () => {
  const h = previewHarness();
  await h.functions.adjust(-13);
  h.context.optimisticLifeDelta = 0; // the first batch is in flight; no snapshot yet
  await h.functions.adjust(3);
  assert.equal(h.context.lifeChange.to, 30);
  assert.equal(h.context.lifeChange.delta, -10);
});

test('canceling a new unsent packet does not erase the visible committed adjustment', async () => {
  const h = previewHarness();
  await h.functions.adjust(-13);
  h.player.life = 27; h.context.optimisticLifeDelta = 0;
  await h.functions.adjust(1);
  await h.functions.adjust(-1);
  assert.equal(h.context.optimisticLifeDelta, 0);
  assert.equal(h.context.lifeChange.delta, -13);
  assert.equal(h.indicator.hidden, false);
});

test('returning to the starting total shows neutral zero and keeps the same window', async () => {
  const h = previewHarness();
  await h.functions.adjust(-1);
  await h.functions.adjust(1);
  assert.equal(h.indicator.hidden, false);
  assert.equal(h.indicator.textContent, '0 LIFE · 40 → 40');
  await h.functions.adjust(-1);
  assert.equal(h.context.lifeChange.delta, -1);
  assert.equal(h.context.lifeChange.from, 40);
});

test('gain corrections use the same window and expiry starts a fresh adjustment', () => {
  const h = previewHarness();
  h.functions.showLifeChange('P1', 13, 40, 53);
  h.functions.showLifeChange('P1', -3, 53, 50);
  assert.equal(h.indicator.textContent, '+10 LIFE · 40 → 50');
  h.expire();
  assert.equal(h.indicator.hidden, true);
  h.functions.showLifeChange('P1', -1, 50, 49);
  assert.equal(h.indicator.textContent, '−1 LIFE · 50 → 49');
});

test('another player starts with their own preview baseline', () => {
  const h = previewHarness();
  h.functions.showLifeChange('P1', -13, 40, 27);
  h.player.id = 'P2'; h.player.life = 20;
  h.functions.showLifeChange('P2', 3, 20, 23);
  assert.equal(h.context.lifeChange.from, 20);
  assert.equal(h.context.lifeChange.delta, 3);
});

test('leaving the displayed seat ends its preview window', () => {
  const h = previewHarness();
  h.functions.showLifeChange('P1', -13, 40, 27);
  h.functions.renderLifeChange({ id: 'P2' });
  assert.equal(h.context.lifeChange, null);
  h.functions.showLifeChange('P1', 1, 27, 28);
  assert.equal(h.context.lifeChange.delta, 1);
  assert.equal(h.context.lifeChange.from, 27);
});
