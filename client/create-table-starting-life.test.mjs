import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('$$(' + "'input[name=\"gameFormat\"]'");
const end = app.indexOf('\ndom.joinQrCameraInput.', start);
assert.ok(start >= 0 && end > start, 'load the real format-selection listeners');

function formatChoices() {
  const selected = { gameFormat: 'commander', startingLife: '40', playerCount: '4' };
  const elements = new Map();
  const formats = ['commander', 'casual', 'custom'].map(value => {
    const listeners = {};
    return { value, listeners, addEventListener(type, callback) { listeners[type] = callback; } };
  });
  for (const [name, values] of [['startingLife', ['20', '30', '40']], ['playerCount', ['2']]]) {
    for (const value of values) {
      elements.set(`input[name="${name}"][value="${value}"]`, {
        set checked(checked) { if (checked) selected[name] = value; },
      });
    }
  }
  runInNewContext(app.slice(start, end), {
    $$: () => formats, $: selector => elements.get(selector),
    selectedGameFormat: () => selected.gameFormat, updateFormatSetup() {},
  });
  return {
    selected,
    select(format, event = 'change') {
      selected.gameFormat = format;
      formats.find(input => input.value === format).listeners[event]?.({ type: event });
    },
  };
}

test('selecting Commander or Casual resets every previous life preset to its format default', () => {
  for (const format of ['commander', 'casual']) {
    for (const life of ['20', '30', '40']) {
      const choices = formatChoices();
      choices.selected.gameFormat = 'custom';
      choices.selected.startingLife = life;
      choices.select(format);
      assert.equal(choices.selected.startingLife, format === 'commander' ? '40' : '20');
    }
  }
});

test('tapping an already-selected format restores its default after a life override', () => {
  for (const [format, life, expected] of [['commander', '20', '40'], ['casual', '40', '20']]) {
    const choices = formatChoices();
    choices.selected.gameFormat = format;
    choices.selected.startingLife = life;
    choices.select(format, 'click');
    assert.equal(choices.selected.startingLife, expected);
  }
});

test('Custom preserves the chosen life preset and Casual keeps its existing two-player default', () => {
  const choices = formatChoices();
  choices.selected.startingLife = '30';
  choices.select('custom');
  assert.equal(choices.selected.startingLife, '30');
  assert.equal(choices.selected.playerCount, '4');
  choices.select('casual');
  assert.equal(choices.selected.playerCount, '2');
  choices.select('commander');
  assert.equal(choices.selected.playerCount, '2');
});

test('tapping Casual again resets life without replacing the chosen player count', () => {
  const choices = formatChoices();
  choices.select('casual');
  choices.selected.playerCount = '4';
  choices.selected.startingLife = '40';
  choices.select('casual', 'click');
  assert.equal(choices.selected.startingLife, '20');
  assert.equal(choices.selected.playerCount, '4');
});
