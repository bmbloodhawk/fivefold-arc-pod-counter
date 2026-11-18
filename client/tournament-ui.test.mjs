import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { finishedTableTransition, tournamentAttendance } from './competition-model.mjs';

const source = (await readFile(new URL('./competition-ui.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function extract(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Missing UI function ${from}`);
  return source.slice(start, end);
}
const escape = value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const button = (id, text) => `<button id="${id}">${text}</button>`;
const field = (name, label, options) => `<label>${label}<input name="${name}" ${options}></label>`;

test('spectator fetch sends only the viewer capability and never account, entrant or connection credentials', async () => {
  const requests = [];
  const context = createContext({
    route: (kind, id, suffix) => `${kind}/${id}/${suffix}`,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ name: 'Private event' }) }; },
    token() { throw new Error('Spectator mode must not request an account token'); },
    guests: { event_one: { guestToken: 'entrant_secret' } },
    session() { throw new Error('Spectator mode must not inspect a Table seat'); },
    localStorage: { setItem() { throw new Error('No viewer capability storage'); } },
  });
  const request = runInContext(extract('  async function spectatorRequest(', '  async function openSpectator(') + 'spectatorRequest;', context);
  await request({ eventId: 'event_one', viewerToken: 'viewer_secret' });
  assert.equal(requests[0].url, '/api/competitions/tournament/event_one/spectator');
  assert.deepEqual(Object.keys(requests[0].options.headers), ['x-event-viewer-token']);
  assert.equal(requests[0].options.headers['x-event-viewer-token'], 'viewer_secret');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
});

test('Tournament invite has an explicit guest choice, keeps Back in Tournaments, and preserves the typed sign-in name', async () => {
  const bindings = new Map(); let html = '', back, signedIn = false, resume, backKind;
  const nameInput = { value: 'Name typed before sign-in' };
  const context = createContext({
    stopInviteScanner() {}, navigationEpoch: 0, currentInvite: null,
    request: async () => ({ name: 'Friday', inviter: 'Host', kind: 'tournament', id: 'event_one' }),
    token: async () => signedIn ? 'account_token' : null,
    crypto: webcrypto, TextEncoder, joinIds: {}, joinIdsKey: 'unused', sessionStorage: {}, writeLocal() {},
    content: { querySelector(selector) { return selector === '#hubJoinForm' ? { querySelector: selector => selector === '[name=displayName]' ? nameInput : null } : nameInput; } },
    adapter: { getPreferredName: () => 'Default name' }, guests: {}, escape, button, field,
    draw(title, nextHtml, previous) { html = nextHtml; back = previous; }, bind: (id, action) => bindings.set(id, action), submit() {},
    signInThen(next) { resume = next; }, inviteForm(kind) { backKind = kind; },
  });
  const preview = runInContext(extract('  async function invitePreview(', '  async function scopeScreen(') + 'invitePreview;', context);
  await preview('tournament.event_one.secret', '', 'tournament');
  assert.match(html, /Continue as guest/); assert.match(html, /Sign in and join with my account/);
  back(); assert.equal(backKind, 'tournament');
  bindings.get('#eventInviteSignIn')(); signedIn = true; await resume();
  assert.match(html, /Name typed before sign-in/); assert.match(html, /My signed-in account/);
});

test('the next assignment keeps the finished seat until the player confirms leaving it', async () => {
  let current = { code: 'OLD', snapshot: { lifecycle: { status: 'intermission' } } }, confirm;
  const actions = [];
  const context = createContext({
    session: () => current, finishedTableTransition, button,
    draw(title, html) { assert.match(html, /Leave finished Table and continue/); },
    bind(selector, action) { assert.equal(selector, '#leaveFinishedContinue'); confirm = action; },
    adapter: { async leaveFinishedTable() { actions.push('leave'); current = { code: null }; }, joinTable(code) { actions.push(`join:${code}`); } },
    eventScreen() {}, rememberRoom(code, id) { actions.push(`remember:${id}:${code}`); }, close(next) { next(); },
  });
  const join = runInContext(extract('  function leaveFinishedToContinue(', '  async function launchTable(') + 'joinAssignedTable;', context);
  join({ id: 'event_one' }, 'NEXT'); assert.deepEqual(actions, []);
  await confirm(); assert.deepEqual(actions, ['leave', 'remember:event_one:NEXT', 'join:NEXT']);
});

test('a live current seat blocks the next assignment without invoking leave or join', () => {
  let html;
  const context = createContext({
    session: () => ({ code: 'LIVE', snapshot: { lifecycle: { status: 'playing' }, turn: { gameStarted: true } } }),
    finishedTableTransition, button, draw(title, value) { html = value; }, bind() {},
    adapter: { leaveFinishedTable() { assert.fail('Cannot release a live seat'); }, joinTable() { assert.fail('Cannot join from a live seat'); } },
  });
  const join = runInContext(extract('  function leaveFinishedToContinue(', '  async function launchTable(') + 'joinAssignedTable;', context);
  join({ id: 'event_one' }, 'NEXT'); assert.match(html, /seat stays connected/);
});

test('an already expired board clock does not leave a ticking background timer after it closes its view', () => {
  let intervals = 0;
  const context = createContext({ viewClock: null, viewClockTick: null, document: { hidden: false }, dialog: { open: true },
    clearInterval() {}, setInterval() { intervals++; },
  });
  const start = runInContext(extract('  const startViewClock = ', '  const roomScopes = ') + 'startViewClock;', context);
  start(() => { context.viewClockTick = null; });
  assert.equal(intervals, 0);
});

function attendanceScreen(event, hostMenu = false) {
  let html;
  const context = createContext({
    request: async () => event, route: () => 'event', tournamentAttendance,
    draw(title, value) { html = value; }, button, escape, statusLabel: status => status,
    bind() {}, submit() {}, bindAssignments() {}, watchEvent() {}, crypto: webcrypto,
    content: { querySelector() { return { insertAdjacentHTML() {} }; }, querySelectorAll() { return []; } },
  });
  const code = hostMenu ? extract('  function eventMenu(', '  async function spectatorLinks(')
    : extract('  async function eventScreen(', '  function assignmentHtml(');
  const render = runInContext(code + (hostMenu ? 'eventMenu;' : 'eventScreen;'), context);
  return { render: () => render(hostMenu ? event : event.id), html: () => html };
}
function attendanceEvent(status = 'registration', roundStatus = null) {
  return { id: 'event_one', name: 'Friday', status, me: 'host', role: 'admin', creatorId: 'host',
    members: [
      { id: 'host', name: 'Host', participating: true, status: 'active', kind: 'member', role: 'admin' },
      { id: 'pending', name: 'Late entrant', participating: true, status: 'pending', kind: 'member' },
      { id: 'left', name: 'Returning entrant', participating: true, status: 'left', kind: 'member' },
    ], rounds: roundStatus ? [{ id: 'round_one', number: 1, status: roundStatus, assignments: [] }] : [],
    settings: { rounds: 3, preferredSize: 4 }, rules: 'Rules', standings: [] };
}

test('actual Tournament screen hides leave-play after completion while preserving live withdrawal', async () => {
  for (const [status, roundStatus] of [['registration', null], ['playing', 'playing'], ['completed', 'complete']]) {
    const screen = attendanceScreen(attendanceEvent(status, roundStatus)); await screen.render();
    assert.equal(screen.html().includes('id="eventLeave"'), status !== 'completed', status);
    assert.match(screen.html(), /Standings/);
  }
});

test('actual host menu permits pending approval and restored attendance only before or between rounds', () => {
  for (const [status, roundStatus] of [['registration', null], ['between_rounds', 'draft'], ['between_rounds', 'complete'], ['playing', 'playing'], ['completed', 'complete']]) {
    const screen = attendanceScreen(attendanceEvent(status, roundStatus), true); screen.render();
    const mayChange = status !== 'completed' && roundStatus !== 'playing';
    assert.equal(screen.html().includes('data-approve="pending"'), mayChange, `approve: ${status}/${roundStatus}`);
    assert.equal(screen.html().includes('data-restore="left"'), mayChange, `restore: ${status}/${roundStatus}`);
    assert.equal(screen.html().includes('data-withdraw="host"'), status !== 'completed', `withdraw: ${status}/${roundStatus}`);
    assert.match(screen.html(), /Late entrant/); assert.match(screen.html(), /Returning entrant/);
  }
});

function releasedTableFlow({ failLeave = false } = {}) {
  let current = { code: 'OLD111', seatId: 0, connectionId: 'old_connection', snapshot: { hostSeatId: 0, lifecycle: { status: 'lobby' }, turn: { gameStarted: false } } };
  const actions = [], bindings = new Map(); let title, html;
  const context = createContext({
    session: () => current, finishedTableTransition, roomScopes: new Map(), escape, button,
    request: async () => ({ linked: true, released: true, kind: 'tournament', id: 'event_one', assignmentId: null }),
    draw(nextTitle, nextHtml) { title = nextTitle; html = nextHtml; }, bind: (id, action) => bindings.set(id, action),
    adapter: {
      onCompetitionContext(value) { actions.push(`released:${value.released}`); },
      async leaveReplacedTable(code) { actions.push(`leave:${code}`); if (failLeave) throw new Error('The Table changed.'); current = { code: null }; },
      createTable(link) { actions.push(`create:${link.assignmentId}`); },
    },
    setPending(link) { actions.push(`pending:${link.assignmentId}`); }, close(next) { next(); }, scopeScreen() {},
  });
  const launch = runInContext(extract('  async function launchTable(', '  async function syncSetup(') + 'launchTable;', context);
  return { actions, bindings, launch: () => launch({ kind: 'tournament', id: 'event_one', name: 'Friday', assignmentId: 'assignment_one' }), title: () => title, html: () => html };
}

test('released unstarted host Table offers explicit departure before creating its replacement', async () => {
  const flow = releasedTableFlow(); await flow.launch();
  assert.equal(flow.title(), 'Create the replacement Table?');
  assert.match(flow.html(), /cannot start/); assert.match(flow.html(), /Leave replaced Table and continue/);
  assert.deepEqual(flow.actions, ['released:true']);
  await flow.bindings.get('#leaveReleasedContinue')();
  assert.deepEqual(flow.actions, ['released:true', 'leave:OLD111', 'pending:assignment_one', 'create:assignment_one']);
});

test('failed departure from a replaced Table never creates a replacement', async () => {
  const flow = releasedTableFlow({ failLeave: true }); await flow.launch();
  assert.equal(flow.title(), 'Create the replacement Table?');
  await assert.rejects(flow.bindings.get('#leaveReleasedContinue')(), /changed/);
  assert.deepEqual(flow.actions, ['released:true', 'leave:OLD111']);
});

function setupContext({ released = false } = {}) {
  const requests = [], published = [], parent = {};
  const element = () => ({ hidden: true, textContent: '', parentElement: parent });
  const context = createContext({
    enabled: true, syncing: null, observation: null, contextAttempt: null, authEpoch: 0, retrySetup: null,
    session: () => ({ code: 'OLD111', seatId: 0, connectionId: 'connection_one', snapshot: { lifecycle: { status: 'lobby' } } }),
    setupObservationKey: () => 'setup', contextObservationKey: () => 'context', clearTimeout() {},
    pending: null, roomScopes: new Map(), context: null,
    async request(path) {
      requests.push(path);
      if (path === 'tables/claim' && released) throw Object.assign(new Error('This Table was replaced.'), { code: 'EVENT_TABLE_RELEASED' });
      return { id: 'event_one', name: 'Friday', kind: 'tournament', linked: true, canAccess: true, released,
        seatLinked: path === 'tables/claim' };
    },
    adapter: { onCompetitionContext: value => published.push(value) }, rememberRoom() {},
    contextButton: element(), intermissionButton: element(), lobbyButton: element(), setupStatus: element(),
    document: { querySelector: () => parent },
  });
  const sync = runInContext(extract('  async function syncSetup(', '  async function tableScreen(') + 'syncSetup;', context);
  return { requests, published, context, sync };
}

test('actual setup reload of a replaced Table skips seat claim and publishes its tournament route and warning', async () => {
  const f = setupContext({ released: true }); await f.sync(true);
  assert.deepEqual(f.requests, ['tables/context?code=OLD111']);
  assert.equal(f.published.length, 1); assert.equal(f.published[0].released, true);
  assert.equal(f.context.lobbyButton.hidden, false); assert.equal(f.context.lobbyButton.textContent, 'Open tournament');
  assert.equal(f.context.setupStatus.hidden, false); assert.match(f.context.setupStatus.textContent, /Table was replaced/);
  assert.doesNotMatch(f.context.setupStatus.textContent, /needs attention/);
});

test('actual setup still links an unclaimed seat in an active tournament Table', async () => {
  const f = setupContext(); await f.sync(true);
  assert.deepEqual(f.requests, ['tables/context?code=OLD111', 'tables/claim']);
  assert.equal(f.published.length, 1); assert.equal(f.published[0].seatLinked, true);
});

test('actual replaced Table screen keeps tournament navigation and hides guest seat-link controls', async () => {
  let html;
  const context = createContext({
    session: () => ({ code: 'OLD111', seatId: 0, snapshot: { hostSeatId: 0, turn: { gameStarted: false } } }),
    roomScopes: new Map(), context: null,
    request: async () => ({ id: 'event_one', name: 'Friday', kind: 'tournament', linked: true, released: true, canAccess: true,
      roster: [{ seatId: 0, name: 'Guest', kind: 'guest' }], assignedGuests: [{ id: 'entrant_guest', name: 'Guest' }] }),
    adapter: { onCompetitionContext() {} }, draw(title, value) { html = value; }, escape, button, bind() {}, submit() {},
  });
  const screen = runInContext(extract('  async function tableScreen(', "  backButton.addEventListener(") + 'tableScreen;', context);
  await screen();
  assert.match(html, /id="openTableScope"/); assert.match(html, /cannot start a game/);
  assert.doesNotMatch(html, /id="attestEventGuest"/);
});
