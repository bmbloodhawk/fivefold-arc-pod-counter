import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function extract(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Load actual implementation: ${from}`);
  return app.slice(start, end);
}
const source = extract('async function exportDeckSummary(', 'async function deleteAccountData(')
  + '\n' + extract('async function signOut() {', 'function renderHomeAccount(');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const EXPORTED_AT = Date.UTC(2026, 10, 23, 12);
const deck = {
  deckId: 'deck-A', name: 'Fixture A deck', commanderName: 'Krenko, Mob Boss', commanderNames: ['Krenko, Mob Boss'],
  colors: ['R'], notes: 'SYNTHETIC_PRIVATE_ACCOUNT_A_NOTE',
};
const games = [
  { gameId: 'win-A', deckId: 'deck-A', won: true, place: 1 },
  { gameId: 'loss-A', deckId: 'deck-A', won: false, place: null },
  { gameId: 'other-deck', deckId: 'other', won: true, place: 2 },
];
const accountExport = { account: { accountId: 'synthetic-A' }, decks: [deck], games };
const kinds = [
  { name: 'deck', stages: ['token', 'fetch', 'deck-json', 'history-json'], status: 'myDecksStatus' },
  { name: 'account', stages: ['token', 'fetch', 'account-json'], status: 'myGamesStatus' },
];

function fixture({ stage, noToken = false, httpFailure = false } = {}) {
  const gate = deferred(), entered = deferred();
  const requests = [], jsonCalls = [], blobs = [], downloads = [], revoked = [];
  let context, account = noToken ? null : 'A', retired = false;
  const pause = async name => { if (stage === name) { entered.resolve(); await gate.promise; } };
  const element = () => ({ hidden: false, disabled: false, textContent: '', open: false });
  context = createContext({
    awardProfileEpoch: 0, signOutInFlight: false, homeAccountSignedIn: !noToken,
    signOutButton: element(), homeSignOutButton: element(), homeAccountMessage: element(),
    myGamesStatus: element(), myDecksStatus: element(), myGamesDialog: element(), myDecksDialog: element(),
    async currentAccountToken() { const owner = account; await pause('token'); return owner ? 'synthetic-token-' + owner : null; },
    resetAwardProfile() { context.awardProfileEpoch++; },
    async signOutAccount() { account = null; }, clearPrivateDeckState() {}, clearAccountAppearance() {},
    renderHomeAccount(signedIn) { context.homeAccountSignedIn = signedIn; }, competitionHub: { authChanged() {} },
    async fetch(path, options) {
      const stageByPath = { '/api/account/decks?archived=all': 'deck-json', '/api/account/history': 'history-json', '/api/account/export': 'account-json' };
      assert.ok(Object.hasOwn(stageByPath, path), 'Network access stays in the synthetic fixture.');
      requests.push({ path, authorization: options.headers.authorization, afterRetirement: retired });
      await pause('fetch');
      return { ok: !httpFailure, async json() {
        jsonCalls.push({ path, afterRetirement: retired });
        await pause(stageByPath[path]);
        return structuredClone(path === '/api/account/export' ? { export: accountExport }
          : path === '/api/account/history' ? { history: { games } } : { decks: [deck] });
      } };
    },
    Blob, Date: { now: () => EXPORTED_AT },
    URL: {
      createObjectURL(blob) { const url = 'blob:fixture-' + (blobs.length + 1); blobs.push({ url, blob }); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    document: { createElement(tag) {
      assert.equal(tag, 'a');
      return { href: '', download: '', click() { downloads.push({ href: this.href, filename: this.download }); } };
    } },
  });
  runInContext(source, context);
  const start = kind => kind === 'deck' ? context.exportDeckSummary('deck-A') : context.exportAccountData();
  const retire = async action => {
    await context.signOut(); // The real app sign-out function retires pending account work.
    assert.equal(context.homeAccountSignedIn, false);
    assert.equal(account, null);
    retired = true;
    if (action === 'switch') {
      context.resetAwardProfile(); account = 'B'; context.renderHomeAccount(true);
    }
    context.myGamesStatus.textContent = 'Current account status';
    context.myDecksStatus.textContent = 'Current account status';
  };
  return { context, gate, entered, requests, jsonCalls, blobs, downloads, revoked, start, retire };
}

for (const kind of kinds) {
  test(`current ${kind.name} export downloads the correct JSON and filename and revokes its object URL`, async () => {
    const f = fixture();
    await f.start(kind.name);
    assert.equal(f.blobs.length, 1); assert.equal(f.downloads.length, 1);
    assert.equal(f.blobs[0].blob.type, 'application/json');
    const expected = kind.name === 'account' ? accountExport : {
      exportedAt: EXPORTED_AT,
      deck: { commanderNames: deck.commanderNames, name: deck.name, colors: deck.colors, notes: deck.notes },
      results: { gamesPlayed: 2, wins: 1, winRate: 0.5, placements: [1] },
    };
    assert.deepEqual(JSON.parse(await f.blobs[0].blob.text()), expected);
    assert.deepEqual(f.downloads, [{ href: f.blobs[0].url,
      filename: kind.name === 'account' ? 'fivefold-arc-my-data.json' : 'Fixture-A-deck-summary.json' }]);
    assert.deepEqual(f.revoked, [f.blobs[0].url]);
    assert.deepEqual(f.requests.map(request => request.path), kind.name === 'account'
      ? ['/api/account/export'] : ['/api/account/decks?archived=all', '/api/account/history']);
    assert.ok(f.requests.every(request => request.authorization === 'Bearer synthetic-token-A'));
  });

  test(`a ${kind.name} export without an account token makes no request or download`, async () => {
    const f = fixture({ noToken: true });
    await f.start(kind.name);
    assert.deepEqual(f.requests, []); assert.deepEqual(f.blobs, []); assert.deepEqual(f.downloads, []);
  });

  for (const stage of kind.stages) {
    test(`a current ${kind.name} ${stage} failure still rejects without a download`, async () => {
      const f = fixture({ stage }), failure = new Error('Synthetic current-account failure');
      const exporting = f.start(kind.name);
      await f.entered.promise;
      f.gate.reject(failure);
      await assert.rejects(exporting, error => error === failure);
      assert.deepEqual(f.blobs, []); assert.deepEqual(f.downloads, []);
    });
  }

  test(`a current ${kind.name} HTTP failure retains its useful error`, async () => {
    const f = fixture({ httpFailure: true });
    await assert.rejects(f.start(kind.name), kind.name === 'account' ? /Your data export is not available yet/ : /That deck summary is not available yet/);
    assert.deepEqual(f.jsonCalls, []); assert.deepEqual(f.blobs, []); assert.deepEqual(f.downloads, []);
  });

  for (const action of ['sign-out', 'switch']) for (const stage of kind.stages) {
    test(`${action} retires a ${kind.name} export pending at ${stage}`, async () => {
      const f = fixture({ stage }), exporting = f.start(kind.name);
      await f.entered.promise;
      await f.retire(action);
      f.gate.resolve();
      await assert.doesNotReject(exporting);
      assert.equal(f.requests.filter(request => request.afterRetirement).length, 0, 'A retired token cannot start a request.');
      assert.equal(f.jsonCalls.filter(call => call.afterRetirement).length, 0, 'A retired response cannot start another private read.');
      assert.deepEqual(f.blobs, []); assert.deepEqual(f.downloads, []); assert.deepEqual(f.revoked, []);
      assert.equal(f.context[kind.status].textContent, 'Current account status');
    });
  }

  for (const action of ['sign-out', 'switch']) for (const stage of [...kind.stages, 'http']) {
    test(`a stale ${kind.name} ${stage} failure after ${action} cannot escape into the new account UI`, async () => {
      const f = fixture({ stage: stage === 'http' ? 'fetch' : stage, httpFailure: stage === 'http' });
      // Mirror the existing UI caller: an export rejection would replace the
      // current account's status with the retired request's error.
      const exporting = f.start(kind.name).catch(error => {
        f.context[kind.status].textContent = error.message;
        throw error;
      });
      await f.entered.promise;
      await f.retire(action);
      if (stage === 'http') f.gate.resolve(); else f.gate.reject(new Error('Retired account error'));
      await assert.doesNotReject(exporting);
      assert.equal(f.context[kind.status].textContent, 'Current account status');
      assert.deepEqual(f.blobs, []); assert.deepEqual(f.downloads, []);
    });
  }
}
