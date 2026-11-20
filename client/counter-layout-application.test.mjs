import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const functionSource = (name, next) => app.slice(app.indexOf(`function ${name}(`), app.indexOf(next, app.indexOf(`function ${name}(`)));

function environment() {
  const properties = new Map();
  const root = { dataset: {}, classList: { add() {}, remove() {} }, hasAttribute: () => false,
    removeAttribute() {}, style: { setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name) } };
  const updates = [];
  return { properties, updates, globals: { document: { documentElement: root, body: { style: {} }, querySelectorAll: () => [] },
    dom: { game: { dataset: {}, removeAttribute() {} } }, $: () => null, baseModeNavMarkup: new Map(),
    interfaceStyle: 'button', dialLayout: { update: () => updates.push(new Map(properties)) } } };
}

test('a late default layout schedules geometry after its transform properties are applied', () => {
  const env = environment();
  env.globals.gameDefaultLayout = { modeLayouts: { button: { componentLayout: { counterReadout: { x: 32, scale: 140 } } } } };
  runInNewContext(functionSource('applyGameDefaultLayout', 'async function loadGameDefaultLayout') + '\napplyGameDefaultLayout();', env.globals);
  assert.equal(env.updates.length, 1);
  assert.equal(env.updates[0].get('--game-layout-counter-readout-x'), '32px');
  assert.equal(env.updates[0].get('--game-layout-counter-readout-scale'), '1.4');
});

test('published skin application and removal both refresh counter geometry', () => {
  const env = environment();
  env.globals.skin = { id: 'local-review', modeLayouts: { button: { componentLayout: { counterReadout: { x: 32, scale: 140 } } } } };
  runInNewContext(functionSource('applyPublishedSkin', 'function applyPublishedSkinArt') + '\napplyPublishedSkin(skin);', env.globals);
  assert.equal(env.updates.length, 1);
  assert.equal(env.updates[0].get('--skin-counter-readout-x'), '32px');
  assert.equal(env.updates[0].get('--skin-counter-readout-scale'), '1.4');
  runInNewContext(functionSource('clearPublishedSkin', 'function applyPublishedSkin') + '\nclearPublishedSkin();', env.globals);
  assert.equal(env.updates.length, 2);
});
