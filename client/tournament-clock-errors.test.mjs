import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import * as model from './competition-model.mjs';
import * as spectator from './tournament-spectator.mjs';
import { createTournamentRefresh } from './tournament-refresh.mjs';

const source = (await readFile(new URL('./competition-ui.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

// Exercise the actual hub, its bound buttons, navigation guard and clock together.
function clockHarness({ phase = null, wrongTable = false } = {}) {
  let now = Date.now(), nextTimer = 0, failure = 'early', pending = null, readFailure = false;
  const intervals = new Map(), timeouts = new Map(), documentEvents = new Map(), requests = [];
  class ClockDate extends Date { static now() { return now; } }
  class Element {
    constructor() { this.open = false; this.hidden = false; this.scrollTop = 0; this.textContent = ''; this.nodes = new Map(); this.listeners = new Map(); this.dataset = {}; this.attributes = new Map(); this.isConnected = true; }
    set innerHTML(html) {
      for (const node of this.nodes.values()) node.isConnected = false;
      this.html = html; this.nodes = new Map();
      for (const match of html.matchAll(/<(button|output|p|summary)\b([^>]*)>/g)) {
        const node = new Element(); node.tagName = match[1].toUpperCase();
        node.id = /\bid="([^"]+)"/.exec(match[2])?.[1];
        node.textContent = html.slice(match.index + match[0].length).split(`<\/${match[1]}>`)[0];
        this.nodes.set(node.id || `node${this.nodes.size}`, node);
      }
    }
    get innerHTML() { return this.html || ''; }
    querySelector(selector) { return this.nodes.get(selector.slice(1)) || null; }
    querySelectorAll() { return []; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    click() { if (!this.disabled) this.listeners.get('click')?.({ currentTarget: this }); }
    focus() { document.activeElement = this; }
    contains(node) { return [...this.nodes.values()].includes(node); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    insertAdjacentHTML(position, html) {
      const prior = this.nodes; this.innerHTML = html;
      this.nodes = new Map([...prior, ...this.nodes]);
      for (const node of prior.values()) node.isConnected = true;
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.get('close')?.(); }
  }
  const elements = new Map(['competitionDialog', 'competitionContent', 'competitionTitle', 'competitionStatus', 'competitionBack', 'competitionClose', 'competitionContextButton', 'competitionSetupStatus', 'competitionIntermissionButton', 'competitionLobbyButton', 'myPodsButton', 'tournamentsButton'].map(id => [`#${id}`, new Element()]));
  const document = { hidden: false, activeElement: null, querySelector: selector => elements.get(selector), addEventListener: (type, listener) => documentEvents.set(type, listener) };
  const assignment = { id: 'table_one', participantIds: ['host'], hostId: 'host', roomCode: 'ABC123', clock: phase && { phase, remaining: 5 } };
  const event = { id: 'event_one', name: 'Friday event', me: 'host', role: 'admin', status: 'playing', members: [{ id: 'host', name: 'Mira', participating: true, status: 'active' }],
    settings: { rounds: 1, minutes: 1, preferredSize: 4, priority: 'new_opponents' }, rules: 'Five final turns',
    rounds: [{ number: 1, status: 'playing', endsAt: now + 60_000, assignments: [assignment] }] };
  const timer = { setTimeout(fn, delay) { const id = ++nextTimer; timeouts.set(id, { fn, delay }); return id; }, clearTimeout: id => timeouts.delete(id) };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const response = (ok, data) => ({ ok, status: ok ? 200 : 409, json: async () => data });
  const context = createContext({ ...model, ...spectator, document, Date: ClockDate, crypto: webcrypto,
    window: { addEventListener() {} }, localStorage: storage, sessionStorage: storage, AbortController,
    createTournamentRefresh: options => createTournamentRefresh({ ...options, timer }),
    setInterval(fn) { const id = ++nextTimer; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), clearTimeout: timer.clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'POST') {
        if (pending) await pending;
        if (failure === 'network') throw new TypeError('Network request failed');
        if (failure === 'early') return response(false, { message: 'Round time has not ended.' });
        assignment.clock = { phase: 'current_turn', remaining: 5 };
      } else if (readFailure) throw new TypeError('Clock refresh failed');
      if (url.endsWith('/mine')) return response(true, { pods: [], tournaments: [] });
      return response(true, { ...event, serverNow: now });
    },
  });
  // Private entry seam only; all clock rendering/actions use the unchanged factory.
  const factory = source.replace(/^import .*;\n/gm, '').replace('export function createCompetitionHub', 'function createCompetitionHub')
    .replace('init, isOpen: () => dialog.open, openSpectator,', 'init, isOpen: () => dialog.open, openSpectator, testClock: clockScreen,');
  assert.ok(factory.includes('testClock: clockScreen'), 'Clock entry seam is present');
  const hub = runInContext(`${factory}\ncreateCompetitionHub;`, context)({ getAccountToken: async () => 'fixture_token', getSession: () => ({ code: wrongTable ? 'OTHER' : 'ABC123', connectionId: 'connection', snapshot: { version: 1 } }), onClose() {} });
  const content = elements.get('#competitionContent'), status = elements.get('#competitionStatus'), dialog = elements.get('#competitionDialog');
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { hub, content, status, dialog, requests, intervals, timeouts, elements, document, settle,
    open: () => hub.testClock('event_one', 'table_one'),
    async click(id) { (content.querySelector(id) || elements.get(id)).click(); await settle(); },
    advance(ms) { now += ms; for (const tick of intervals.values()) tick(); },
    fail(value) { failure = value; }, defer(value) { pending = value; }, failRead(value = true) { readFailure = value; },
    hidden(value) { document.hidden = value; documentEvents.get('visibilitychange')(); },
    async poll() { const [id, timeout] = [...timeouts][0]; timeouts.delete(id); await timeout.fn(); await settle(); },
  };
}

for (const failure of ['early', 'network']) test(`${failure} clock action error keeps the same countdown running with its error visible`, async () => {
  const f = clockHarness(); await f.open(); f.fail(failure);
  const output = f.content.querySelector('#eventRoundCountdown');
  const target = f.content.querySelector('#callRoundTime'); target.focus(); f.content.scrollTop = 83;
  await f.click('#callRoundTime');
  assert.match(f.status.textContent, failure === 'early' ? /Round time has not ended/ : /Network request failed/);
  f.advance(3000);
  assert.equal(output.textContent, '0:57 remaining');
  assert.equal(f.content.querySelector('#eventRoundCountdown'), output, 'No redraw steals focus or replaces the error view');
  assert.equal(f.document.activeElement, target); assert.equal(f.content.scrollTop, 83);
  assert.equal(target.disabled, false); assert.equal(f.content.attributes.has('aria-busy'), false);
  assert.equal(f.timeouts.size, 1, 'Official event refresh is restarted');
  assert.match(f.status.textContent, failure === 'early' ? /Round time has not ended/ : /Network request failed/);
  await f.poll();
  assert.equal(f.requests.at(-1).url, '/api/competitions/tournament/event_one');
});

test('failed Refresh clock and wrong-table draw confirmation also retain the running clock', async () => {
  const refresh = clockHarness(); await refresh.open(); refresh.failRead();
  await refresh.click('#refreshRoundClock'); refresh.advance(2000);
  assert.match(refresh.status.textContent, /Clock refresh failed/);
  assert.equal(refresh.content.querySelector('#eventRoundCountdown').textContent, '0:58 remaining');
  const draw = clockHarness({ phase: 'done', wrongTable: true }); await draw.open();
  await draw.click('#recordTimedDraw'); draw.advance(2000);
  assert.match(draw.status.textContent, /Open the assigned Table/);
  assert.equal(draw.content.querySelector('#eventRoundCountdown').textContent, '0:58 remaining');
});

test('failed final-turn action retains its control and resumes the official clock', async () => {
  const f = clockHarness({ phase: 'current_turn' }); await f.open(); f.fail('network');
  const control = f.content.querySelector('#recordFinalTurn'); await f.click('#recordFinalTurn'); f.advance(2000);
  assert.match(f.status.textContent, /Network request failed/);
  assert.equal(f.content.querySelector('#recordFinalTurn'), control);
  assert.equal(f.content.querySelector('#eventRoundCountdown').textContent, '0:58 remaining');
  assert.equal(JSON.parse(f.requests.at(-1).options.body).action, 'finish_turn');
});

test('a successful mutation followed by failed clock read keeps ticking and later polls its authoritative phase', async () => {
  const f = clockHarness(); await f.open(); f.fail(null); f.failRead();
  await f.click('#callRoundTime'); f.advance(2000);
  assert.match(f.status.textContent, /Clock refresh failed/);
  assert.equal(f.content.querySelector('#eventRoundCountdown').textContent, '0:58 remaining');
  f.failRead(false); await f.poll();
  assert.match(f.content.querySelector('#recordFinalTurn').textContent, /Current turn finished/);
  assert.equal(f.intervals.size, 1); assert.equal(f.timeouts.size, 1);
});

for (const leave of ['close', 'back', 'different view']) test(`late clock failure after ${leave} leaves the new navigation alone`, async () => {
  const f = clockHarness(), pending = Promise.withResolvers(); await f.open(); f.defer(pending.promise);
  await f.click('#callRoundTime');
  if (leave === 'close') await f.click('#competitionClose');
  else if (leave === 'back') await f.click('#competitionBack');
  else await f.click('#tournamentsButton');
  const heading = f.elements.get('#competitionTitle').textContent, status = f.status.textContent;
  const intervalCount = f.intervals.size, timeoutCount = f.timeouts.size;
  pending.resolve(); await f.settle(); f.advance(3000);
  assert.equal(f.elements.get('#competitionTitle').textContent, heading);
  assert.equal(f.status.textContent, status);
  assert.equal(f.intervals.size, intervalCount); assert.equal(f.timeouts.size, timeoutCount);
  assert.equal(f.dialog.open, leave !== 'close');
  if (leave !== 'close') assert.equal(f.content.querySelector('#eventRoundCountdown'), null);
});

test('failed clock action while hidden stays paused and resumes from the official deadline when visible', async () => {
  const f = clockHarness(), pending = Promise.withResolvers(); await f.open(); f.defer(pending.promise);
  await f.click('#callRoundTime'); f.hidden(true); pending.resolve(); await f.settle();
  assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
  f.advance(4000); f.hidden(false);
  assert.equal(f.content.querySelector('#eventRoundCountdown').textContent, '0:56 remaining');
  assert.equal(f.intervals.size, 1); assert.equal(f.timeouts.size, 1);
  assert.match(f.status.textContent, /Round time has not ended/);
});

test('successful clock action still refreshes the authoritative phase and starts one clock and one poll', async () => {
  const f = clockHarness(); await f.open(); f.fail(null); await f.click('#callRoundTime');
  assert.match(f.content.querySelector('#recordFinalTurn').textContent, /Current turn finished/);
  assert.equal(f.status.textContent, '');
  f.advance(2000); assert.equal(f.content.querySelector('#eventRoundCountdown').textContent, '0:58 remaining');
  assert.equal(f.intervals.size, 1); assert.equal(f.timeouts.size, 1);
  const action = f.requests.find(request => request.options.method === 'POST');
  assert.equal(JSON.parse(action.options.body).action, 'time_called');
  assert.equal(action.options.headers.authorization, 'Bearer fixture_token');
});
