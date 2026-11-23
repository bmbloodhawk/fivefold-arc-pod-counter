import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const page = await readFile(new URL('./feedback.html', import.meta.url), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
assert.ok(script, 'Execute the complete inbox script, including its registered handlers.');
const fallback = 'Could not confirm the update. Please try again.';
const original = { noteId: 'note-a', gameId: 'game-a', text: 'Original player feedback',
  createdAt: 10, authorName: 'Player', authorSeatId: 0, roomCode: 'ABC123' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const decode = value => value.replace(/&quot;/gu, '"').replace(/&gt;/gu, '>').replace(/&lt;/gu, '<').replace(/&amp;/gu, '&');

// A small DOM boundary for the complete inline script. Browser QA verifies real
// layout; these nodes exercise the actual submit, filter, lock and action handlers.
function element() {
  const listeners = new Map();
  let content = '';
  return {
    value: '', hidden: false, disabled: false, dataset: {}, isConnected: true,
    classList: { toggle() {} }, focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    async dispatch(type) {
      if (this.disabled) return;
      await Promise.all((listeners.get(type) || []).map(listener => listener({ target: this, currentTarget: this, preventDefault() {} })));
    },
    get textContent() { return content; }, set textContent(value) { content = String(value); },
    get innerHTML() { return content; }, set innerHTML(value) { content = String(value); },
  };
}

function fixture(save) {
  const nodes = new Map([...page.slice(0, page.indexOf('<script>')).matchAll(/\bid="([^"]+)"/gu)]
    .map(([, id]) => [`#${id}`, element()]));
  const node = id => nodes.get(`#${id}`);
  node('inbox').hidden = true;
  let cards = [], filterButtons = [];
  const detachCards = () => { cards.forEach(card => { card.isConnected = false; }); cards = []; };
  Object.defineProperty(node('notes'), 'innerHTML', {
    set(markup) {
      detachCards();
      for (const [, article] of markup.matchAll(/<article\b([^]*?)<\/article>/gu)) {
        const card = element();
        card.dataset.note = decode(article.match(/\bdata-note="([^"]*)"/u)[1]);
        card.dataset.status = decode(article.match(/\bdata-status="([^"]*)"/u)[1]);
        card.draft = element(); card.draft.value = decode(article.match(/<textarea\b[^>]*>([^]*?)<\/textarea>/u)[1]);
        const statusMarkup = article.match(/<[^>]*\bdata-review-status\b[^>]*>([^]*?)<\/[^>]+>/u);
        card.message = statusMarkup ? element() : null;
        if (card.message) card.message.textContent = decode(statusMarkup[1]);
        card.buttons = [...article.matchAll(/<button\b[^>]*\bdata-action="([^"]+)"[^>]*>/gu)].map(([, action]) => {
          const button = element(); button.dataset.action = action; button.closest = selector => selector === '.note' ? card : null;
          return button;
        });
        card.querySelector = selector => selector === 'textarea' ? card.draft : selector === '[data-review-status]' ? card.message : null;
        card.querySelectorAll = selector => selector === '[data-action]' ? card.buttons : [];
        cards.push(card);
      }
    },
  });
  Object.defineProperty(node('notes'), 'textContent', { set() { detachCards(); } });
  node('notes').querySelectorAll = selector => selector === '[data-action]' ? cards.flatMap(card => card.buttons) : [];
  Object.defineProperty(node('filters'), 'innerHTML', {
    set(markup) {
      filterButtons = [...markup.matchAll(/\bdata-filter="([^"]+)"/gu)].map(([, value]) => {
        const button = element(); button.dataset.filter = value; return button;
      });
    },
  });
  node('filters').querySelectorAll = selector => selector === '[data-filter]' ? filterButtons : [];
  const requests = [];
  runInNewContext(script, {
    document: { querySelector: selector => nodes.get(selector) },
    sessionStorage: { removeItem() {}, setItem() {} }, location: { assign() {} },
    fetch: async (url, options = {}) => {
      if (url === '/api/feedback') return Response.json({ notes: [original, { ...original, noteId: 'note-b', text: 'Other feedback' }] });
      if (url === '/api/feedback/insights') return Response.json({ insights: {} });
      assert.equal(url, '/api/feedback/note-a');
      requests.push({ method: options.method, headers: { ...options.headers }, body: JSON.parse(options.body) });
      return save(requests.at(-1));
    },
  });
  return {
    node, requests, get cards() { return cards; },
    async unlock() { node('ownerKey').value = 'fixture-owner'; await node('unlockForm').dispatch('submit'); assert.equal(node('inbox').hidden, false); },
    lock() { return node('lockButton').dispatch('click'); },
    filter(value) { return filterButtons.find(button => button.dataset.filter === value).dispatch('click'); },
    click(card = cards[0], action = 'addressed') { return card.buttons.find(button => button.dataset.action === action).dispatch('click'); },
  };
}

function assertMessage(card, expected) {
  assert.ok(card.message, 'The review result is beside the affected card, outside the hidden unlock form.');
  assert.equal(card.message.textContent, expected);
}
const saved = (ownerNote = 'My unsaved follow-up') => Response.json({ review: {
  noteId: original.noteId, gameId: original.gameId, status: 'addressed', ownerNote, updatedAt: 20,
} });

for (const [name, fail, message] of [
  ['HTTP error', () => Response.json({ error: { message: 'Storage unavailable' } }, { status: 500 }), 'Storage unavailable'],
  ['network error', () => { throw new TypeError('Synthetic network failure'); }, fallback],
  ['non-JSON error response', () => new Response('<h1>Unavailable</h1>', { status: 503 }), fallback],
  ['non-JSON success response', () => new Response('<h1>Unexpected</h1>'), fallback],
  ['missing review', () => Response.json({}), fallback],
]) {
  test(`a ${name} shows a nearby error and preserves the pending follow-up`, async () => {
    const f = fixture(fail); await f.unlock();
    const card = f.cards[0]; card.draft.value = 'My unsaved follow-up';
    await assert.doesNotReject(f.click(card));
    assertMessage(card, message);
    assert.equal(card.dataset.status, 'open');
    assert.equal(card.draft.value, 'My unsaved follow-up');
    assert.equal(card.isConnected, true);
    assert.ok(card.buttons.every(button => !button.disabled));
    assert.equal(f.node('unlockForm').hidden, true);
    assert.deepEqual(f.requests[0].body, { gameId: original.gameId, status: 'addressed', ownerNote: 'My unsaved follow-up' });
  });
}

test('retry replaces its stale error with Saving and disables only that card until confirmation', async () => {
  const pending = deferred(), entered = deferred(); let attempt = 0;
  const f = fixture(() => ++attempt === 1 ? Response.json({ error: { message: 'Try again' } }, { status: 500 })
    : (entered.resolve(), pending.promise));
  await f.unlock(); const card = f.cards[0]; card.draft.value = 'My unsaved follow-up';
  await f.click(card); assertMessage(card, 'Try again');
  const retry = f.click(card);
  try {
    await entered.promise;
    assertMessage(card, 'Saving…');
    assert.ok(card.buttons.every(button => button.disabled));
    assert.ok(f.cards[1].buttons.every(button => !button.disabled));
    assert.equal(card.dataset.status, 'open');
  } finally { pending.resolve(saved()); await retry; }
  assert.equal(f.cards.some(item => item.dataset.note === original.noteId), false, 'Confirmed addressed note leaves the Open filter.');
  await f.filter('all');
  const updated = f.cards.find(item => item.dataset.note === original.noteId);
  assert.equal(updated.dataset.status, 'addressed');
  assert.equal(updated.draft.value, 'My unsaved follow-up');
  assertMessage(updated, '');
});

test('a save still reconciles its note when filtering replaces the pending card', async () => {
  const pending = deferred(), entered = deferred();
  const f = fixture(() => { entered.resolve(); return pending.promise; });
  await f.unlock(); const card = f.cards[0]; card.draft.value = 'My unsaved follow-up';
  const saving = f.click(card); await entered.promise;
  await f.filter('all'); assert.equal(card.isConnected, false);
  pending.resolve(saved()); await saving;
  const updated = f.cards.find(item => item.dataset.note === original.noteId);
  assert.equal(updated.dataset.status, 'addressed');
  assert.equal(updated.draft.value, 'My unsaved follow-up');
  assertMessage(updated, '');
});

for (const outcome of ['success', 'failure']) {
  test(`a retired save ${outcome} cannot alter a locked and reopened inbox`, async () => {
    const pending = deferred(), entered = deferred();
    const f = fixture(() => { entered.resolve(); return pending.promise; });
    await f.unlock(); const previous = f.cards[0]; previous.draft.value = 'Old session draft';
    const saving = f.click(previous); await entered.promise;
    await f.lock(); await f.unlock();
    const current = f.cards[0]; current.draft.value = 'New session draft';
    pending.resolve(outcome === 'success' ? saved('Old session draft')
      : Response.json({ error: { message: 'Old session failure' } }, { status: 500 }));
    await saving;
    assert.equal(f.cards[0], current);
    assert.equal(current.dataset.status, 'open');
    assert.equal(current.draft.value, 'New session draft');
    assertMessage(current, '');
    assert.ok(current.buttons.every(button => !button.disabled));
  });
}
