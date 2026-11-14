import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';
import { createRealtimeServer } from '../src/app.js';
import { APPEARANCE_ACHIEVEMENTS } from '../src/appearance-milestones.js';

const PATH = '/api/account/appearance-catch-up';
const VIEWED = PATH + '/viewed';
const CREATED_AT = Date.UTC(2026, 10, 14, 12);
const skins = [
  { id: 'field-notes', name: 'Field Notes', visual: { treatment: 'grid' } },
  { id: 'rosewood', name: 'Rosewood', visual: { treatment: 'wood' } },
  { id: 'neutral', name: 'Carl MTG', achievement: { id: 'appearance-neutral' } },
  { id: 'skin-1790476356864', name: 'Fractured', achievement: { id: 'appearance-fractured' } },
  { id: 'future-secret', name: 'Unreleased Skin', achievement: { id: 'appearance-future-secret' } },
];
const historyPath = (kind, accountId) => `account-history/${kind}/${accountId}.json`;

async function fixture(t, { appEnv = 'production', awardIds, noticeIds } = {}) {
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({ store, now: () => CREATED_AT + 1000 });
  const accountId = await history.ensureAccount('notice-owner');
  const otherAccountId = await history.ensureAccount('other-player');
  const achievementIds = noticeIds ?? [
    'appearance-field-notes', 'appearance-rosewood', 'appearance-tideglass',
    'appearance-neutral', 'appearance-fractured', 'appearance-future-secret',
  ];
  const notice = { id: 'notice-fixture-recovery', createdAt: CREATED_AT, achievementIds };
  await store.write(historyPath('verified-progress', accountId), {
    awards: Object.fromEntries((awardIds ?? achievementIds).map(id => [id, {
      gameId: 'game_historical-10', earnedAt: CREATED_AT, ruleVersion: 1,
      recoveryRunId: 'legacy-commander-v1',
    }])),
    games: {},
    appearanceRecovery: { version: 1, runId: 'legacy-commander-v1', games: {} },
    appearanceCatchUp: notice,
  });
  const { server } = createRealtimeServer({
    appEnv, accountHistory: history, appearanceSkins: skins,
    accountVerifier: { async verify(token) {
      if (!['notice-owner', 'other-player'].includes(token)) throw Object.assign(new Error('Sign in'), { status: 401 });
      return { providerSubject: token };
    } },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = async (pathname = PATH, { token = 'notice-owner', body, method } = {}) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + pathname, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(token === null ? {} : { authorization: 'Bearer ' + token }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, status: response.status, data: await response.json() };
  };
  return { request, store, history, accountId, otherAccountId, notice };
}

for (const appEnv of ['production', 'staging']) {
  test(appEnv + ' returns one private notice with only mapped and currently earned skins', async t => {
    const f = await fixture(t, { appEnv });
    const result = await f.request();
    assert.equal(result.status, 200);
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(result.data, { notice: {
      id: f.notice.id, createdAt: CREATED_AT,
      skins: skins.slice(0, 2).map(({ id, name }) => ({ id, name, achievement: APPEARANCE_ACHIEVEMENTS[id] })),
    } });
    assert.ok(!JSON.stringify(result.data).includes('visual'));
    assert.ok(!JSON.stringify(result.data).includes('recoveryRunId'));
    assert.ok(!JSON.stringify(result.data).includes(f.accountId));
    const repeated = await f.request();
    assert.deepEqual(repeated.data, result.data);
  });
}

test('a catch-up notice cannot disclose another profile and both routes require account authentication', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(PATH, { token: null })).status, 401);
  assert.equal((await f.request(VIEWED, { token: null, body: { id: f.notice.id } })).status, 401);
  assert.equal((await f.request(PATH, { token: 'invalid' })).status, 401);
  const other = await f.request(PATH + '?accountId=' + encodeURIComponent(f.accountId), { token: 'other-player' });
  assert.equal(other.status, 200);
  assert.deepEqual(other.data, { notice: null });
  const wrongOwner = await f.request(VIEWED, { token: 'other-player', body: { id: f.notice.id } });
  assert.ok([400, 409].includes(wrongOwner.status));
  assert.equal((await f.request()).data.notice.id, f.notice.id);
  assert.deepEqual(await f.history.earnedSkinAwards(f.otherAccountId, Object.values(APPEARANCE_ACHIEVEMENTS).map(item => item.id)), {});
});

test('acknowledging a notice is persistent and idempotent without changing skin grants or other new achievement markers', async t => {
  const f = await fixture(t);
  const before = structuredClone(await f.store.read(historyPath('verified-progress', f.accountId)));
  const accountBefore = structuredClone(await f.store.read(historyPath('accounts', f.accountId)));
  const first = await f.request(VIEWED, { body: { id: f.notice.id } });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, { acknowledged: true });
  assert.deepEqual((await f.request()).data, { notice: null });
  const retry = await f.request(VIEWED, { body: { id: f.notice.id } });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data, { acknowledged: true });
  const after = await f.store.read(historyPath('verified-progress', f.accountId));
  assert.deepEqual(after.awards, before.awards);
  assert.deepEqual(after.games, before.games);
  assert.deepEqual(await f.store.read(historyPath('accounts', f.accountId)), accountBefore);
  const anotherReader = new AccountHistory({ store: f.store });
  assert.equal(await anotherReader.appearanceCatchUp(f.accountId), null);
});

test('invalid or mismatched acknowledgements cannot consume a notice or award a requested skin', async t => {
  const f = await fixture(t);
  const before = structuredClone([...f.store.values]);
  for (const body of [
    {}, null, [], { id: null }, { id: 42 }, { id: '' }, { id: 'wrong-notice' },
    { id: f.notice.id, achievementIds: ['appearance-crown-alloy'] },
    { id: f.notice.id, accountId: f.otherAccountId },
    { id: f.notice.id, skinId: 'neutral' },
  ]) {
    const result = await f.request(VIEWED, { body });
    assert.ok([400, 409].includes(result.status), JSON.stringify({ body, status: result.status }));
  }
  assert.deepEqual([...f.store.values], before);
  assert.equal((await f.request()).data.notice.id, f.notice.id);
  assert.equal((await f.history.earnedSkinAwards(f.accountId, ['appearance-crown-alloy']))['appearance-crown-alloy'], undefined);
});

test('a pending notice grants no access by itself and disappears when no earned catalog skins can be listed', async t => {
  const f = await fixture(t, { awardIds: [] });
  const before = structuredClone([...f.store.values]);
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { notice: null });
  assert.deepEqual([...f.store.values], before);
  assert.deepEqual(await f.history.earnedSkinAwards(f.accountId, ['appearance-field-notes', 'appearance-rosewood']), {});
});
