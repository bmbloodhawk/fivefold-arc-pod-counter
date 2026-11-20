import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, Script } from 'node:vm';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const index = await readFile(new URL('./index.html', import.meta.url), 'utf8');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match, `Actual app function ${name} exists.`);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Find the complete function. */ }
  }
  assert.fail(`Complete app function ${name} was not found.`);
}
const source = ['counterModeLabel', 'renderModeNav', 'clearPublishedSkin', 'applySelectedAppearance']
  .map(sourceFunction).join('\n');

function fixture({ style = 'dial', state = { mode: 'life', tableSkinId: '', localSimulation: false }, choice = '' } = {}) {
  const buttons = new Map(), baseModeNavMarkup = new Map();
  for (const match of index.matchAll(/<button\b[^>]*data-mode="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const [, mode, markup] = match;
    baseModeNavMarkup.set(mode, markup);
    let html = markup, label = { textContent: markup.match(/<small[^>]*>(.*?)<\/small>/)?.[1] || '' };
    const attributes = new Map([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    buttons.set(mode, { dataset: { mode }, classList: { toggle() {} },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      querySelector(selector) { return selector === 'small' ? label : null; },
      get innerHTML() { return html.replace(/(<small[^>]*>).*?(<\/small>)/, `$1${label.textContent}$2`); },
      set innerHTML(value) { html = value; label = { textContent: value.match(/<small[^>]*>(.*?)<\/small>/)?.[1] || '' }; },
    });
  }
  const noOp = () => {}, seal = { innerHTML: '<svg>old skin</svg>' };
  const context = createContext({ state, interfaceStyle: style, baseModeNavMarkup, baseSealMarkup: '<svg>base seal</svg>',
    document: { documentElement: { hasAttribute: () => false, classList: { remove: noOp }, removeAttribute: noOp,
      style: { removeProperty: noOp } }, body: { style: {} }, querySelectorAll: () => [] },
    dom: { game: { removeAttribute: noOp } }, dialLayout: { update: noOp },
    $: selector => selector === '.counter-sigil' ? seal : buttons.get(selector.match(/data-mode="([^"]+)"/)?.[1]),
    $$: () => [...buttons.values()], activeGameSkinId: '', pendingGameSkinId: '', appearanceRequestGeneration: 0,
    publishedSkins: [], unlockedSkinChoices: () => [], accountPreferences: null, stagingReviewSkins: [],
    deviceAppearanceChoice: () => choice,
  });
  runInContext(source, context);
  return { context, buttons, seal, label: mode => buttons.get(mode).querySelector('small').textContent };
}

test('normal shared-state appearance clearing preserves Dial Rad after the preceding navigation render', async () => {
  const f = fixture();
  for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
    f.context.state.mode = mode;
    // These actual functions run in this order in the two shared-state listeners.
    f.context.renderModeNav();
    assert.equal(f.label('radiation'), 'Rad');
    await f.context.applySelectedAppearance();
    await Promise.resolve();
    assert.equal(f.label('radiation'), 'Rad', `No stale full label after ${mode} state update.`);
  }
});

test('explicit Standard appearance retains Rad when removing a previously active skin', async () => {
  const f = fixture({ choice: 'standard' });
  f.context.activeGameSkinId = 'qa-previous-skin';
  f.context.renderModeNav();
  await f.context.applySelectedAppearance();
  assert.equal(f.label('radiation'), 'Rad');
  assert.equal(f.context.activeGameSkinId, '');
});

test('Button restoration preserves full Radiation, Cmdr, icon markup and accessible names', () => {
  const f = fixture({ style: 'button' });
  f.context.clearPublishedSkin();
  assert.equal(f.label('radiation'), 'Radiation');
  assert.equal(f.label('commander'), 'Cmdr');
  assert.match(f.buttons.get('radiation').innerHTML, /<svg/);
  assert.equal(f.buttons.get('radiation').getAttribute('aria-label'), 'Radiation');
  assert.equal(f.buttons.get('commander').getAttribute('aria-label'), 'Commander damage');
  assert.equal(f.seal.innerHTML, '<svg>base seal</svg>');
});

test('skin clearing before a game exists is safe and uses the selected interface labels', () => {
  for (const style of ['dial', 'button']) {
    const f = fixture({ style, state: null });
    assert.doesNotThrow(() => f.context.clearPublishedSkin());
    assert.equal(f.label('radiation'), style === 'dial' ? 'Rad' : 'Radiation');
  }
});
