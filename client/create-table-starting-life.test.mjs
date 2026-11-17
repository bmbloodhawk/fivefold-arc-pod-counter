import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const page = await readFile(new URL('./index.html', import.meta.url), 'utf8');
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
    selectedGameFormat: () => selected.gameFormat, updateFormatSetup() {}, showCreateStep() {},
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

function createTableLife({ format = 'custom', preset = '30', override = '', badInput = false, local = false, count = '4', createRoom } = {}) {
  const fields = new Map(Object.entries({ gameFormat: format, startingLife: preset, customStartingLife: override,
    playerCount: count, seatCapacity: count, commanderCount: '1', name: '', roundLimitMinutes: '', tableSkinId: '' }));
  const elements = new Map();
  let focused;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, textContent: '', attributes: {}, listeners: {}, validity: { badInput },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      click() { return this.listeners.click?.(); }, scrollIntoView() {},
      setAttribute(name, value) { this.attributes[name] = value; }, focus() { focused = selector; },
    });
    return elements.get(selector);
  };
  const steps = [...page.matchAll(/data-create-step="(\d+)"[^>]*>([\s\S]*?)(?=<section class="create-step|<\/form>)/g)].map(([, step, content]) => ({
    dataset: { createStep: step }, hidden: step !== '1', content,
    progress: { textContent: content.match(/STEP \d OF \d/)?.[0] },
    querySelector(selector) { return selector === '.eyebrow' ? this.progress : { focus() {} }; },
  }));
  const backButtons = steps.filter(step => step.content.includes('data-create-back')).map(() => ({ listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } }));
  const commanderInputs = [{ value: 'Draft commander', dataset: { commanderColors: '["R"]' } }];
  const created = [], demos = [], shown = [], errors = [];
  const setupStart = app.indexOf('let createStep = 1;');
  const setupEnd = app.indexOf("$('#joinStepTwoNext').addEventListener", setupStart);
  const submitStart = app.indexOf("$('#createForm').addEventListener('submit'");
  const submitEnd = app.indexOf("$('#joinForm').addEventListener", submitStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart && submitStart >= 0 && submitEnd > submitStart);
  const flow = runInNewContext(app.slice(setupStart, setupEnd) + '\n' + app.slice(submitStart, submitEnd) + '\n({ showCreateStep })', {
    $: element, $$: selector => selector === '[data-create-step]' ? steps : selector === '[data-create-back]' ? backButtons : [],
    FormData: class extends Map { constructor() { super(fields); } }, window: { scrollTo() {} },
    selectedGameFormat: () => fields.get('gameFormat'),
    dom: { createCommanderNames: { querySelectorAll: () => commanderInputs }, playerCountChoices: { querySelector: () => ({ focus() {} }) }, roundLimitMinutes: element('#roundLimitMinutes'), localSimulation: { checked: local } },
    commanderNamesFromForm: () => [''], commanderColorsFromFields: () => [[]],
    selectedCommanderCount: () => 1, confirmUnresolvedCommanderDetails: async () => ({ unresolved: [] }),
    accountTokenForSkin: async () => null,
    transport: { async createRoom(config) { created.push(config); return createRoom ? createRoom(config) : { snapshot: { code: 'LOCAL' } }; } },
    beginLocalGame(config) { demos.push(config); },
    showSharedGame(snapshot) { shown.push(snapshot); }, competitionHub: { async tableCreated() {} }, showError(error) { errors.push(error); },
  });
  return {
    created, demos, shown, errors, fields, element, steps, commanderInputs, showStep: flow.showCreateStep,
    get step() { return Number(steps.find(step => !step.hidden).dataset.createStep); },
    get progress() { return steps.find(step => !step.hidden).progress.textContent; },
    get focused() { return focused; },
    click: id => element(id).listeners.click(),
    back: () => backButtons[0].listeners.click(),
    next: () => element('#createStepOneNext').listeners.click(),
    submit: () => element('#createForm').listeners.submit({ preventDefault() {}, currentTarget: element('#createForm') }),
  };
}

test('Custom creates tables with the selected 20/30/40 when its optional override is blank', async () => {
  for (const preset of ['20', '30', '40']) {
    for (const override of ['', '  ']) {
      const table = createTableLife({ preset, override });
      table.next();
      assert.equal(table.step, 2);
      table.showStep(4);
      await table.submit();
      assert.equal(table.created[0]?.startingLife, Number(preset));
    }
  }
});

test('shared creation uses eight internal seats regardless of a saved or linked player count', async () => {
  for (const count of ['2', '4', '8']) {
    const table = createTableLife({ format: 'commander', count });
    table.showStep(4);
    await table.submit();
    assert.equal(table.created[0]?.playerCount, 8);
    assert.equal(table.created[0]?.seatCapacity, 8);
  }
});

test('shared creation has four steps with name immediately after rules and no capacity picker', () => {
  const table = createTableLife({ format: 'commander' });
  assert.deepEqual(table.steps.map(step => Number(step.dataset.createStep)), [1, 2, 3, 4]);
  table.next();
  assert.equal(table.step, 2);
  assert.match(table.steps.find(step => !step.hidden).content, /id="createName"/);
  assert.doesNotMatch(page, /id="seatCapacity"|Players for game one|Seats available in this table/);
  assert.equal(table.progress, 'STEP 2 OF 4');
});

test('Commander next, skip and back follow the four real creation steps', async () => {
  const table = createTableLife({ format: 'commander' });
  table.next(); table.click('#createStepTwoNext');
  assert.equal(table.step, 3);
  await table.click('#createStepThreeNext');
  assert.equal(table.step, 4);
  assert.equal(table.progress, 'STEP 4 OF 4');
  table.back(); assert.equal(table.step, 3);
  table.click('#createStepThreeSkip');
  assert.equal(table.step, 4);
  assert.equal(table.commanderInputs[0].value, '');
  assert.equal(table.commanderInputs[0].dataset.commanderColors, undefined);
  table.back(); table.back(); assert.equal(table.step, 2);
  table.back(); assert.equal(table.step, 1);
});

test('Casual and Custom skip commanders in both directions and report three visible steps', () => {
  for (const format of ['casual', 'custom']) {
    const table = createTableLife({ format });
    table.next();
    assert.equal(table.progress, 'STEP 2 OF 3');
    table.click('#createStepTwoNext');
    assert.equal(table.step, 4);
    assert.equal(table.progress, 'STEP 3 OF 3');
    table.back(); assert.equal(table.step, 2);
    table.back(); assert.equal(table.step, 1);
    assert.equal(table.progress, 'STEP 1 OF 3');
  }
});

test('only local simulation uses its developer-only simulated player count', async () => {
  for (const count of ['2', '4', '8']) {
    const table = createTableLife({ format: 'commander', local: true, count });
    table.showStep(4);
    await table.submit();
    assert.equal(table.created.length, 0);
    assert.equal(table.demos[0]?.playerCount, Number(count));
  }
  const developerFields = page.match(/id="localSimulationField"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(developerFields, /hidden/);
  assert.match(developerFields, /Simulated players[\s\S]*id="playerCountChoices"/);
});

test('an entered Custom life total overrides the preset, including the supported boundaries', async () => {
  for (const override of ['1', '25', '999']) {
    const table = createTableLife({ preset: '30', override });
    table.next();
    assert.equal(table.step, 2);
    table.showStep(4);
    await table.submit();
    assert.equal(table.created[0]?.startingLife, Number(override));
  }
});

test('invalid Custom values stay on the rules step with a focused, visible error', async () => {
  for (const [override, badInput] of [['0', false], ['-1', false], ['1000', false], ['2.5', false], ['', true]]) {
    const table = createTableLife({ override, badInput });
    table.next();
    assert.equal(table.step, 1);
    assert.equal(table.focused, '#customStartingLife');
    assert.equal(table.element('#customStartingLifeError').hidden, false);
    assert.match(table.element('#customStartingLifeError').textContent, /whole number.*1.*999/);
    assert.equal(table.element('#customStartingLife').attributes['aria-invalid'], 'true');
    assert.match(table.element('#customStartingLife').attributes['aria-describedby'], /customStartingLifeError/);
    await table.submit();
    assert.equal(table.created.length, 0);
  }
});

test('final submission also validates life and returns invalid Custom input to step one', async () => {
  const table = createTableLife({ override: '0' });
  table.showStep(4);
  await table.submit();
  assert.equal(table.step, 1);
  assert.equal(table.created.length, 0);
});

test('editing an invalid Custom value clears its old error before the next validation', () => {
  const table = createTableLife({ override: '0' });
  table.next();
  table.fields.set('customStartingLife', '25');
  table.element('#customStartingLife').listeners.input();
  assert.equal(table.element('#customStartingLifeError').hidden, true);
  assert.equal(table.element('#customStartingLifeError').textContent, '');
  assert.equal(table.element('#customStartingLife').attributes['aria-invalid'], 'false');
  assert.equal(table.element('#customStartingLife').attributes['aria-describedby'], 'customStartingLifeHelp');
  table.next();
  assert.equal(table.step, 2);
});

test('Commander and Casual submit their presets even when a Custom draft is invalid', async () => {
  for (const [format, preset] of [['commander', '40'], ['casual', '20']]) {
    const table = createTableLife({ format, preset, override: '0', badInput: true });
    table.next();
    assert.equal(table.step, 2);
    table.showStep(4);
    await table.submit();
    assert.equal(table.created[0]?.startingLife, Number(preset));
  }
});

test('early form submits advance the current Commander or Casual step without creating a table', async () => {
  for (const format of ['commander', 'casual', 'custom']) {
    const table = createTableLife({ format });
    await table.submit();
    assert.equal(table.step, 2);
    await table.submit();
    assert.equal(table.step, format === 'commander' ? 3 : 4);
    if (format === 'commander') { await table.submit(); assert.equal(table.step, 4); }
    assert.equal(table.created.length, 0);
    await table.submit();
    assert.equal(table.created.length, 1);
  }
});

test('creation shows progress and blocks repeated submits until completion', async () => {
  let finish;
  const table = createTableLife({ createRoom: () => new Promise(resolve => { finish = resolve; }) });
  table.showStep(4);
  const first = table.submit();
  await Promise.resolve();
  const button = table.element('#createForm button[type="submit"]');
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Creating table…');
  await table.submit();
  assert.equal(table.created.length, 1);
  finish({ snapshot: { code: 'LOCAL' } }); await first;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Create table');
  assert.equal(table.shown.length, 1);
});

test('failed creation preserves values and permits a retry; cancelled responses do not open a table', async () => {
  let attempts = 0;
  const table = createTableLife({ createRoom: async () => {
    if (++attempts === 1) throw new Error('Try again');
    return { ignored: true };
  } });
  table.showStep(4);
  await table.submit();
  assert.equal(table.errors[0].message, 'Try again');
  assert.equal(table.element('#createForm button[type="submit"]').disabled, false);
  assert.equal(table.fields.get('startingLife'), '30');
  await table.submit();
  assert.equal(attempts, 2);
  assert.equal(table.shown.length, 0);
});
