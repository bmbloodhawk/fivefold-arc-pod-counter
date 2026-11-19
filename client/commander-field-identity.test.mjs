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
const source = ['escapeHtml', 'normaliseIdentity', 'renderCommanderNameFields', 'commanderColorsFromFields',
  'confirmUnresolvedCommanderDetails', 'savedDeckCommanderColors', 'selectSetupDeck'].map(sourceFunction).join('\n');
const copy = value => JSON.parse(JSON.stringify(value));
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Small DOM fixture: parse the real renderer's fields, leaving identity decisions to actual app code.
function container() {
  let html = '', fields = [];
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      fields = [...value.matchAll(/<div class="commander-identity-field">([\s\S]*?)<\/div>/g)].map(match => {
        const inputHtml = /<input\b[^>]*>/.exec(match[1])?.[0] || '';
        const attrs = Object.fromEntries([...inputHtml.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]));
        const status = { textContent: decode(/<small class="commander-lookup-status"[^>]*>([\s\S]*?)<\/small>/.exec(match[1])?.[1] || '') };
        const input = { name: attrs.name, value: attrs.value, dataset: {}, addEventListener() {}, focus() {}, closest: () => field };
        if (attrs['data-commander-colors'] !== undefined) input.dataset.commanderColors = attrs['data-commander-colors'];
        const button = { dataset: { lookupCommander: /data-lookup-commander="(\d+)"/.exec(match[1])?.[1] }, addEventListener() {}, closest: () => field };
        const field = { input, status, button,
          querySelector(selector) { return selector === 'input' ? input : selector === '.commander-lookup-status' ? status : null; } };
        return field;
      });
    },
    querySelectorAll(selector) { return selector === 'input[name^="commanderName"]' ? fields.map(field => field.input)
      : selector === '[data-lookup-commander]' ? fields.map(field => field.button) : []; },
    querySelector(selector) { const name = /input\[name="([^"]+)"\]/.exec(selector)?.[1]; return fields.find(field => field.input.name === name)?.input || null; },
  };
}

function fixture() {
  const create = container(), join = container(), lookups = [], radios = new Map();
  const dom = { createCommanderNames: create, joinCommanderNames: join, createDeck: { value: '' }, joinDeck: { value: '' } };
  const context = createContext({ dom, selectedDeckId: '', setupDecks: [
    { deckId: 'tymna', commanderNames: ['Tymna the Weaver'], commanderColors: [['W', 'B']], colors: ['W', 'B'] },
    { deckId: 'krenko', commanderNames: ['Krenko, Mob Boss'], commanderColors: [['R']], colors: ['R'] },
  ], IDENTITY_ORDER: ['W', 'U', 'B', 'R', 'G'], sessionStorage: { setItem() {} },
  $(selector) { if (!radios.has(selector)) radios.set(selector, { checked: false }); return radios.get(selector); },
  async lookupCommanderIdentity(name) { lookups.push(name); return { name: 'Krenko, Mob Boss', colors: ['R'] }; },
  });
  runInContext(source, context);
  const input = (slot = 0, target = create) => target.querySelector(`input[name="commanderName${slot}"]`);
  return { context, dom, create, join, lookups, input,
    render(count, names, identities) { context.renderCommanderNameFields(create, count, names, identities); },
    colors(target = create, count = 1) { return copy(context.commanderColorsFromFields(target, count)); },
    select(which, deckId) { const select = which === 'join' ? dom.joinDeck : dom.createDeck; select.value = deckId; context.selectSetupDeck({ currentTarget: select }); },
  };
}

test('an explicit replacement identity overrides colors from the previously rendered commander', () => {
  const f = fixture(); f.render(1, ['Tymna the Weaver'], [['W', 'B']]);
  f.render(1, ['Krenko, Mob Boss'], [['R']]);
  assert.equal(f.input().value, 'Krenko, Mob Boss'); assert.deepEqual(f.colors(), [['R']]);
});
test('an explicitly empty identity clears a previous confirmed identity even when the name stays the same', () => {
  const f = fixture(); f.render(1, ['Tymna the Weaver'], [['W', 'B']]);
  f.render(1, ['Tymna the Weaver'], [[]]);
  assert.deepEqual(f.colors(), [[]]); assert.equal(f.input().dataset.commanderColors, undefined);
});
test('an explicit different commander without an identity drops old colors and remains eligible for lookup', async () => {
  const f = fixture(); f.render(1, ['Tymna the Weaver'], [['W', 'B']]);
  f.render(1, ['Krenko, Mob Boss']);
  assert.equal(f.input().dataset.commanderColors, undefined); assert.deepEqual(f.colors(), [[]]);
  const result = await f.context.confirmUnresolvedCommanderDetails(f.create, 1);
  assert.deepEqual(f.lookups, ['Krenko, Mob Boss']); assert.deepEqual(copy(result.unresolved), []);
  assert.deepEqual(f.colors(), [['R']]);
});
test('a commander-count rerender with no supplied names or identities preserves the existing field', () => {
  const f = fixture(); f.render(1, ['Tymna the Weaver'], [['W', 'B']]);
  f.render(2);
  assert.equal(f.input().value, 'Tymna the Weaver'); assert.equal(f.input(1).value, '');
  assert.deepEqual(f.colors(f.create, 2), [['W', 'B'], []]);
});
test('supplying the same exact commander name without a new identity preserves its confirmed colors', () => {
  const f = fixture(); f.render(1, ['Tymna the Weaver'], [['W', 'B']]);
  f.render(1, ['Tymna the Weaver']);
  assert.deepEqual(f.colors(), [['W', 'B']]);
});
for (const flow of ['create', 'join']) test(`switching saved decks in ${flow} transfers the selected deck's identity into the real commander fields`, () => {
  const f = fixture(), target = flow === 'join' ? f.join : f.create;
  f.select(flow, 'tymna'); assert.deepEqual(f.colors(target), [['W', 'B']]);
  f.select(flow, 'krenko');
  assert.equal(f.input(0, target).value, 'Krenko, Mob Boss'); assert.deepEqual(f.colors(target), [['R']]);
  assert.equal(f.context.selectedDeckId, 'krenko'); assert.equal(f.lookups.length, 0);
});
