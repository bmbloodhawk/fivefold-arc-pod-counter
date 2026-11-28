import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountHistory, MemoryAccountHistoryStore } from '../src/account-history.js';

const START = Date.UTC(2026, 10, 27, 12);
const subject = 'exploration-enrollment-race-fixture';
const paths = accountId => ({
  account: `account-history/accounts/${encodeURIComponent(accountId)}.json`,
  progress: `account-history/verified-progress/${encodeURIComponent(accountId)}.json`,
  enrollment: `account-history/exploration-enrollments/${encodeURIComponent(accountId)}.json`,
});

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture() {
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({ store, now: () => START });
  const accountId = await history.ensureAccount(subject);
  return { store, history, accountId, path: paths(accountId) };
}

test('an in-flight stale account preference write cannot erase enrollment or seed existing achievement evidence', { timeout: 2000 }, async t => {
  const f = await fixture();
  const entered = gate(), blocked = gate();
  t.after(() => blocked.release());
  const write = f.store.write.bind(f.store);
  let hold = true;
  f.store.write = async (path, value) => {
    if (hold && path === f.path.account) {
      hold = false;
      entered.release();
      await blocked.promise;
    }
    return write(path, value);
  };
  const stalePreferences = f.history.savePreferences(f.accountId, { preferredName: 'Explorer' });
  await entered.promise;
  const begun = await f.history.startExplorationCommission(f.accountId, 'America/Los_Angeles');
  assert.equal(await f.store.read(f.path.progress), null);
  assert.equal((await f.store.read(f.path.account)).explorationCommission, undefined);
  blocked.release(); await stalePreferences;
  assert.deepEqual((await f.history.summary(f.accountId)).explorationCommission, begun);
  assert.equal((await f.history.preferences(f.accountId)).preferredName, 'Explorer');
  assert.equal(await f.store.read(f.path.progress), null);
});

test('account deletion closes enrollment without retaining its timezone or allowing the deleted profile to re-enroll', async () => {
  const f = await fixture();
  await f.history.startExplorationCommission(f.accountId, 'America/Los_Angeles');
  assert.equal(await f.history.deleteAccount(subject), true);
  assert.deepEqual(await f.store.read(f.path.enrollment), { closed: true });
  assert.deepEqual(await f.store.read(f.path.progress), { closed: true });
  assert.equal(await f.store.read(f.path.account), null);
  await assert.rejects(() => f.history.startExplorationCommission(f.accountId, 'Pacific/Auckland'), { status: 409, code: 'PROFILE_UNAVAILABLE' });
  assert.deepEqual((await f.history.summary(f.accountId)).explorationCommission, {
    startedAt: null, timeZone: null, earnedAt: null, commanderVariety: 0, recordedTurns: 0, playDates: 0,
  });
  const replacement = await f.history.ensureAccount(subject);
  assert.notEqual(replacement, f.accountId);
  const fresh = await f.history.startExplorationCommission(replacement, 'Pacific/Auckland');
  assert.equal(fresh.timeZone, 'Pacific/Auckland');
});

test('an in-flight begin that read the old profile cannot recreate enrollment after account deletion', { timeout: 2000 }, async t => {
  const f = await fixture();
  const entered = gate(), blocked = gate();
  t.after(() => blocked.release());
  const update = f.store.update.bind(f.store);
  let hold = true;
  f.store.update = async (path, change) => {
    if (hold && path === f.path.enrollment) {
      hold = false;
      entered.release();
      await blocked.promise;
    }
    return update(path, change);
  };
  const begin = f.history.startExplorationCommission(f.accountId, 'America/Los_Angeles');
  await entered.promise;
  await f.history.deleteAccount(subject);
  blocked.release();
  await assert.rejects(begin, { status: 409, code: 'PROFILE_UNAVAILABLE' });
  assert.deepEqual(await f.store.read(f.path.enrollment), { closed: true });
  assert.deepEqual(await f.store.read(f.path.progress), { closed: true });
  assert.equal(await f.store.read(f.path.account), null);
});
