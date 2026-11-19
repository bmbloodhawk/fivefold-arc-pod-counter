import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const choicesStart = app.indexOf('function clearDeckCommanderMatches(');
const choicesSource = choicesStart < 0 ? '' : app.slice(choicesStart, app.indexOf('let deckColorLookupAttempt', choicesStart));
const source = choicesSource + app.slice(app.indexOf('async function confirmDeckCommanderColors('), app.indexOf('function savedDeckCommanderColors('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const lookups = [], count = { value: '2' };
  const context = createContext({ awardProfileEpoch: 0, deckColorLookupAttempt: 0, deckSaveAttempt: 0, deckEditorOpen: true,
    myDecksDialog: { open: true }, deckCommanderMatches: [0, 1].map(() => ({ hidden: true, replaceChildren() {} })),
    deckCommanderName: { value: 'First' }, deckCommanderNameTwo: { value: 'Partner' },
    deckCommanderStatus: { textContent: '' }, findDeckColorsButton: { disabled: false },
    deckCommanderColors: [], colors: [], $: () => count, normaliseIdentity: values => [...new Set(values)],
    lookupCommanderIdentity() { const d = deferred(); lookups.push(d); return d.promise; },
    setDeckColors(colors) { context.colors = colors; },
  });
  runInContext(source, context);
  return { context, count, lookups, resolve(from = 0) { lookups.slice(from).forEach((d, index) => d.resolve({ name: `Canonical ${index}`, colors: ['R'] })); } };
}
test('switching paired to single commander during lookup cannot restore a hidden partner', async () => {
  const f = fixture(), pending = f.context.confirmDeckCommanderColors();
  f.count.value = '1'; f.context.deckCommanderNameTwo.value = ''; f.context.deckCommanderStatus.textContent = 'Count changed';
  f.resolve(); assert.equal(await pending, false);
  assert.equal(f.context.deckCommanderNameTwo.value, ''); assert.equal(f.context.deckCommanderName.value, 'First');
  assert.equal(f.context.deckCommanderStatus.textContent, 'Count changed'); assert.equal(f.context.findDeckColorsButton.disabled, false);
});
test('editing a name while colors load preserves the newer name and chosen colors', async () => {
  const f = fixture(), pending = f.context.confirmDeckCommanderColors();
  f.context.deckCommanderName.value = 'New first'; f.context.colors = ['G']; f.resolve(); await pending;
  assert.equal(f.context.deckCommanderName.value, 'New first'); assert.deepEqual([...f.context.colors], ['G']);
});
test('older colors cannot overwrite a newer lookup or unlock its button', async () => {
  const f = fixture(), old = f.context.confirmDeckCommanderColors();
  f.context.deckCommanderName.value = 'New first'; const next = f.context.confirmDeckCommanderColors();
  f.lookups[0].resolve({ name: 'Old first', colors: ['R'] }); f.lookups[1].resolve({ name: 'Old second', colors: ['R'] }); await old;
  assert.equal(f.context.findDeckColorsButton.disabled, true); assert.equal(f.context.deckCommanderName.value, 'New first');
  f.lookups[2].resolve({ name: 'New canonical', colors: ['G'] }); f.lookups[3].resolve({ name: 'New partner', colors: ['U'] });
  assert.equal(await next, true); assert.equal(f.context.deckCommanderName.value, 'New canonical');
  assert.deepEqual([...f.context.colors], ['G', 'U']); assert.equal(f.context.findDeckColorsButton.disabled, false);
});
test('a failed old lookup does not overwrite the edited draft status', async () => {
  const f = fixture(), pending = f.context.confirmDeckCommanderColors();
  f.context.deckCommanderName.value = 'Changed'; f.context.deckCommanderStatus.textContent = 'Current draft';
  f.lookups[0].reject(new Error('Old failure')); f.lookups[1].resolve({ name: 'Partner', colors: [] }); await pending;
  assert.equal(f.context.deckCommanderStatus.textContent, 'Current draft');
});
test('current paired lookup still combines identities and normalizes both names', async () => {
  const f = fixture(), pending = f.context.confirmDeckCommanderColors(); f.resolve();
  assert.equal(await pending, true); assert.equal(f.context.deckCommanderNameTwo.value, 'Canonical 1');
  assert.deepEqual([...f.context.colors], ['R']); assert.equal(f.context.findDeckColorsButton.disabled, false);
});
