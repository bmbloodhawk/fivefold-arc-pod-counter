import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createInteractionAdvice } from './card-interaction-advice.js';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Load actual app implementation: ${start}`);
  return app.slice(from, to);
}
const source = section('async function lookupCard(name)', 'function renderCommanderNameFields(')
  + section('function closeGameOverlays()', 'function returnToSetup()')
  + section("dom.cardCameraButton.addEventListener('click'", "dom.playtestNotesButton.addEventListener('click'");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const card = name => ({ name, typeLine: 'Artifact', oracleText: `Oracle text for ${name}.`,
  retrievedAt: '2026-11-18T00:00:00Z', rulings: [] });
const combo = () => ({ retrievedAt: '2026-11-18T00:00:00Z', sourceUrl: 'https://example.test/combos',
  combos: [{ result: ['Fixture interaction'], description: 'Fixture combo description.', prerequisites: [], sourceUrl: 'https://example.test/combo/1' }] });

function fixture() {
  function element(value = '') {
    const listeners = new Map();
    return { value, hidden: false, textContent: '', innerHTML: '', open: false,
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
      dispatch(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); },
      showModal() { this.open = true; },
      close() { this.open = false; this.dispatch('close'); },
      replaceChildren() { this.innerHTML = ''; }, focus() {}, setAttribute() {},
    };
  }
  const requests = [], waiters = [];
  const context = createContext({
    dom: { gameMenu: element(), moreButton: element(), cardCameraButton: element(), cardAdvisorForm: element(),
      cardCameraDialog: element(), firstCardTitle: element(), secondCardTitle: element(),
      interactionSituation: element(), cardLookupStatus: element(), cardLookupResult: element() },
    apiBaseFromPage: () => '', escapeHtml: value => String(value), createInteractionAdvice,
    fetch(url) {
      const response = deferred();
      requests.push({ url, response,
        complete(body, ok = true) { response.resolve({ ok, json: async () => body }); },
        fail(message) { response.reject(new Error(message)); },
      });
      for (const waiter of waiters.splice(0)) waiter();
      return response.promise;
    },
  });
  runInContext(source, context);
  void context.openCardCamera();
  const ui = () => ({ first: context.dom.firstCardTitle.value, second: context.dom.secondCardTitle.value,
    situation: context.dom.interactionSituation.value, status: context.dom.cardLookupStatus.textContent,
    result: context.dom.cardLookupResult.innerHTML, hidden: context.dom.cardLookupResult.hidden });
  const start = (first, second = '', situation = '') => {
    context.dom.firstCardTitle.value = first; context.dom.secondCardTitle.value = second;
    context.dom.interactionSituation.value = situation;
    return context.lookupCardTitles();
  };
  const waitForRequests = async count => {
    while (requests.length < count) await new Promise(resolve => waiters.push(resolve));
  };
  return { context, requests, ui, start, waitForRequests,
    edit(field, value) { context.dom[field].value = value; context.dom[field].dispatch('input'); },
  };
}

test('a current single-card lookup still shows the canonical title and Oracle text', async () => {
  const f = fixture(), lookup = f.start('bolt');
  assert.match(f.requests[0].url, /name=bolt$/);
  f.requests[0].complete(card('Lightning Bolt'));
  await lookup;
  assert.equal(f.ui().first, 'Lightning Bolt');
  assert.equal(f.ui().hidden, false);
  assert.match(f.ui().result, /Oracle text for Lightning Bolt/);
  assert.match(f.ui().status, /Current Oracle text/);
});

test('a current pair lookup still shows both cards and established interactions', async () => {
  const f = fixture(), lookup = f.start('first', 'second');
  f.requests[0].complete(card('First canonical')); f.requests[1].complete(card('Second canonical'));
  await f.waitForRequests(3);
  assert.match(f.requests[2].url, /first=First%20canonical&second=Second%20canonical$/);
  f.requests[2].complete(combo());
  await lookup;
  assert.equal(f.ui().first, 'First canonical'); assert.equal(f.ui().second, 'Second canonical');
  assert.match(f.ui().result, /Oracle text for First canonical/);
  assert.match(f.ui().result, /Oracle text for Second canonical/);
  assert.match(f.ui().result, /Fixture combo description/);
});

test('a current interaction-service failure preserves the pair Oracle text and labels the unavailable check', async () => {
  const f = fixture(), lookup = f.start('first', 'second');
  f.requests[0].complete(card('First')); f.requests[1].complete(card('Second'));
  await f.waitForRequests(3); f.requests[2].fail('Fixture service unavailable');
  await lookup;
  assert.equal(f.ui().hidden, false);
  assert.match(f.ui().result, /Oracle text for First/);
  assert.match(f.ui().result, /temporarily unavailable/);
});

test('an older card response cannot replace a newer successful lookup', async () => {
  const f = fixture(), oldLookup = f.start('Old card'), newLookup = f.start('New card');
  f.requests[1].complete(card('New canonical')); await newLookup;
  const current = f.ui();
  f.requests[0].complete(card('Old canonical')); await oldLookup;
  assert.deepEqual(f.ui(), current);
});

test('resubmitting identical titles still retires the earlier request', async () => {
  const f = fixture(), oldLookup = f.start('Same title'), newLookup = f.start('Same title');
  f.requests[1].complete(card('Same title')); await newLookup;
  const current = f.ui();
  const oldCard = card('Same title'); oldCard.oracleText = 'OLDER_RESPONSE_SENTINEL';
  f.requests[0].complete(oldCard); await oldLookup;
  assert.deepEqual(f.ui(), current);
});

test('a stale card failure cannot overwrite the newer status or result', async () => {
  const f = fixture(), oldLookup = f.start('Old card'), newLookup = f.start('New card');
  f.requests[1].complete(card('New canonical')); await newLookup;
  const current = f.ui();
  f.requests[0].fail('Old request failed'); await oldLookup;
  assert.deepEqual(f.ui(), current);
});

test('a card failure for an edited draft cannot attach its error to the newer input', async () => {
  const f = fixture(), lookup = f.start('Original title');
  f.edit('firstCardTitle', 'Edited title');
  const edited = f.ui();
  f.requests[0].fail('Original title failed'); await lookup;
  assert.deepEqual(f.ui(), edited);
});

test('a rejected new title clears the previous card result', async () => {
  const f = fixture(), first = f.start('First');
  f.requests[0].complete(card('First canonical')); await first;
  const invalid = f.start('Unknown title');
  f.requests[1].complete({ error: { message: 'Card not found.' } }, false); await invalid;
  assert.equal(f.ui().hidden, true);
  assert.equal(f.ui().result, '');
  assert.equal(f.ui().first, 'Unknown title');
  assert.equal(f.ui().status, 'Card not found.');
});

test('closing a pending lookup leaves the closed result empty and inputs unchanged', async () => {
  const f = fixture(), lookup = f.start('Old card');
  f.context.dom.cardCameraDialog.close();
  const closed = f.ui();
  f.requests[0].complete(card('Old canonical')); await lookup;
  assert.deepEqual(f.ui(), closed);
});

test('close and reopen with unchanged titles invalidates the old card response', async () => {
  const f = fixture(), lookup = f.start('Same title');
  f.context.dom.cardCameraDialog.close(); await f.context.openCardCamera();
  const reopened = f.ui();
  f.requests[0].complete(card('Old canonical')); await lookup;
  assert.deepEqual(f.ui(), reopened);
});

for (const [field, value] of [['firstCardTitle', 'Edited first'], ['secondCardTitle', 'Edited second'], ['interactionSituation', 'New situation']]) {
  test(`editing ${field} while cards load preserves the newer draft`, async () => {
    const f = fixture(), lookup = f.start('First', 'Second', 'Old situation');
    f.edit(field, value); const edited = f.ui();
    f.requests[0].complete(card('First canonical')); f.requests[1].complete(card('Second canonical'));
    // Resolve a wrongly started combo too, so a regression fails by assertion rather than hanging.
    const startedCombo = await Promise.race([lookup.then(() => false), f.waitForRequests(3).then(() => true)]);
    if (startedCombo) f.requests[2].complete(combo());
    await lookup;
    assert.deepEqual(f.ui(), edited);
    assert.equal(f.requests.length, 2, 'An obsolete card response must not start an interaction request.');
  });
}

test('an obsolete pair response stops before starting its interaction lookup', async () => {
  const f = fixture(), oldLookup = f.start('Old first', 'Old second'), currentLookup = f.start('New single');
  f.requests[2].complete(card('New single canonical')); await currentLookup;
  const current = f.ui();
  f.requests[0].complete(card('Old first canonical')); f.requests[1].complete(card('Old second canonical'));
  const startedCombo = await Promise.race([oldLookup.then(() => false), f.waitForRequests(4).then(() => true)]);
  if (startedCombo) f.requests[3].complete(combo());
  await oldLookup;
  assert.deepEqual(f.ui(), current);
  assert.equal(f.requests.length, 3);
});

for (const failOldCombo of [false, true]) {
  test(`a late interaction ${failOldCombo ? 'failure' : 'result'} cannot replace a newer lookup`, async () => {
    const f = fixture(), oldLookup = f.start('Old first', 'Old second');
    f.requests[0].complete(card('Old first canonical')); f.requests[1].complete(card('Old second canonical'));
    await f.waitForRequests(3);
    const currentLookup = f.start('New single');
    f.requests[3].complete(card('New single canonical')); await currentLookup;
    const current = f.ui();
    if (failOldCombo) f.requests[2].fail('Old combo unavailable'); else f.requests[2].complete(combo());
    await oldLookup;
    assert.deepEqual(f.ui(), current);
  });
}

test('editing the situation during an interaction lookup preserves the current draft', async () => {
  const f = fixture(), lookup = f.start('First', 'Second', 'Original situation');
  f.requests[0].complete(card('First canonical')); f.requests[1].complete(card('Second canonical'));
  await f.waitForRequests(3);
  f.edit('interactionSituation', 'Edited situation'); const edited = f.ui();
  f.requests[2].complete(combo()); await lookup;
  assert.deepEqual(f.ui(), edited);
});

test('closing and reopening while interaction lookup waits invalidates its result', async () => {
  const f = fixture(), lookup = f.start('First', 'Second');
  f.requests[0].complete(card('First canonical')); f.requests[1].complete(card('Second canonical'));
  await f.waitForRequests(3);
  f.context.dom.cardCameraDialog.close(); await f.context.openCardCamera();
  const reopened = f.ui();
  f.requests[2].complete(combo()); await lookup;
  assert.deepEqual(f.ui(), reopened);
});
