import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  assert.ok(match);
  for (let end = app.indexOf('}', match.index); end >= 0; end = app.indexOf('}', end + 1)) {
    const source = app.slice(match.index, end + 1);
    try { new Script(`(${source})`); return source; } catch { /* Find the complete function. */ }
  }
  assert.fail(`Missing function ${name}`);
}

function fields(count = 1) {
  const requests = [], choices = [];
  let resolve, reject;
  const makeInput = name => ({ value: name, dataset: {}, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } });
  const inputs = Array.from({ length: count }, (_, i) => makeInput(`Original ${i}`));
  const status = { textContent: '' };
  const field = { querySelector(selector) { return selector === 'input' ? inputs[0] : selector === '.commander-lookup-status' ? status : null; } };
  inputs.forEach(input => { input.closest = () => field; });
  const button = { dataset: { lookupCommander: '0' }, listeners: {}, closest: () => field, addEventListener(type, listener) { this.listeners[type] = listener; } };
  const container = {
    innerHTML: '',
    querySelector(selector) { return inputs[Number(/commanderName(\d+)/.exec(selector)?.[1])]; },
    querySelectorAll(selector) { return selector.startsWith('input') ? inputs : selector.startsWith('[data-lookup') ? [button] : []; },
  };
  const context = {
    dom: { createCommanderNames: null },
    lookupCommanderIdentity(name) { requests.push(name); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    commanderColorsFromFields: () => inputs.map(input => String(input.dataset.commanderColors || '').split(',').filter(Boolean)),
    normaliseIdentity: value => value, escapeHtml: value => String(value),
    showCommanderMatchChoices: (...args) => choices.push(args),
  };
  const api = runInNewContext(['applyCommanderIdentity', 'confirmUnresolvedCommanderDetails', 'renderCommanderNameFields'].map(sourceFunction).join('\n') + '\n({ confirmUnresolvedCommanderDetails, renderCommanderNameFields })', context);
  return { ...api, inputs, container, status, button, requests, choices, makeInput,
    resolve: value => resolve(value), reject: value => reject(value),
    manualFind() { api.renderCommanderNameFields(container, count); return button.listeners.click(); },
  };
}

test('Save validation preserves text and colors edited while its lookup is pending', async () => {
  const h = fields(); const pending = h.confirmUnresolvedCommanderDetails(h.container, 1);
  h.inputs[0].value = 'Edited commander'; h.inputs[0].dataset.commanderColors = 'G';
  h.resolve({ name: 'Original canonical', colors: ['R'] });
  const result = await pending;
  assert.equal(h.inputs[0].value, 'Edited commander');
  assert.equal(h.inputs[0].dataset.commanderColors, 'G');
  assert.equal(result.unresolved.length, 1);
});

test('a stale validation failure does not attach errors or choices to the edited name', async () => {
  const h = fields(); const pending = h.confirmUnresolvedCommanderDetails(h.container, 1);
  h.inputs[0].value = 'Edited commander'; h.inputs[0].dataset.commanderColors = 'G'; h.status.textContent = 'Manual draft';
  h.reject(Object.assign(new Error('Original name failed'), { matches: [{ name: 'Original match', colors: ['R'] }] }));
  await pending;
  assert.equal(h.inputs[0].value, 'Edited commander'); assert.equal(h.inputs[0].dataset.commanderColors, 'G');
  assert.equal(h.status.textContent, 'Manual draft'); assert.equal(h.choices.length, 0);
});

test('Cancel and reopen abort the old multi-commander validation before it reads new fields', async () => {
  const h = fields(2); let current = true;
  const pending = h.confirmUnresolvedCommanderDetails(h.container, 2, () => current);
  current = false;
  h.inputs[0] = h.makeInput('New draft A'); h.inputs[1] = h.makeInput('New draft B');
  h.resolve({ name: 'Original canonical', colors: ['R'] }); await pending;
  assert.deepEqual(h.requests, ['Original 0']);
  assert.deepEqual(h.inputs.map(input => input.value), ['New draft A', 'New draft B']);
  assert.equal(h.inputs[0].dataset.commanderColors, undefined);
});

test('an invalid draft context does not start any commander lookup', async () => {
  const h = fields(); const pending = h.confirmUnresolvedCommanderDetails(h.container, 1, () => false);
  if (h.requests.length) h.resolve({ name: 'Ignored', colors: [] });
  await pending;
  assert.deepEqual(h.requests, []);
});

test('current validation still applies canonical names and confirmed colors', async () => {
  const h = fields(); const pending = h.confirmUnresolvedCommanderDetails(h.container, 1);
  h.resolve({ name: 'Canonical commander', colors: ['U'] }); const result = await pending;
  assert.equal(h.inputs[0].value, 'Canonical commander'); assert.equal(h.inputs[0].dataset.commanderColors, 'U');
  assert.equal(result.unresolved.length, 0);
});

test('Find commander details ignores a result for text edited while loading', async () => {
  const h = fields(); const pending = h.manualFind();
  h.inputs[0].value = 'Edited commander'; h.inputs[0].dataset.commanderColors = 'G'; h.status.textContent = 'Edited draft';
  h.resolve({ name: 'Original canonical', colors: ['R'] }); await pending;
  assert.equal(h.inputs[0].value, 'Edited commander'); assert.equal(h.inputs[0].dataset.commanderColors, 'G');
  assert.equal(h.status.textContent, 'Edited draft'); assert.equal(h.button.disabled, false);
});

test('Find commander details ignores a result after its field was replaced', async () => {
  const h = fields(), old = h.inputs[0]; const pending = h.manualFind();
  h.inputs[0] = h.makeInput('New draft');
  h.resolve({ name: 'Original canonical', colors: ['R'] }); await pending;
  assert.equal(old.value, 'Original 0'); assert.equal(h.inputs[0].value, 'New draft');
  assert.equal(h.inputs[0].dataset.commanderColors, undefined);
});

test('a stale manual lookup error preserves edited colors and status', async () => {
  const h = fields(); const pending = h.manualFind();
  h.inputs[0].value = 'Edited commander'; h.inputs[0].dataset.commanderColors = 'G'; h.status.textContent = 'Edited draft';
  h.reject(new Error('Original name failed')); await pending;
  assert.equal(h.inputs[0].dataset.commanderColors, 'G'); assert.equal(h.status.textContent, 'Edited draft');
  assert.equal(h.inputs[0].dataset.commanderLookupFailed, undefined);
});

test('current manual Find still applies its confirmed identity', async () => {
  const h = fields(); const pending = h.manualFind();
  h.resolve({ name: 'Canonical commander', colors: ['U'] }); await pending;
  assert.equal(h.inputs[0].value, 'Canonical commander'); assert.equal(h.inputs[0].dataset.commanderColors, 'U');
});
