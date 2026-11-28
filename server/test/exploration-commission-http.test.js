import assert from 'node:assert/strict';
import test from 'node:test';
import { openExplorationPreset, runExplorationPreset, PRESET_START } from '../../qa/exploration-commission-local.mjs';

test('local reward preset connects real win/loss/draw completions to Studio ownership permanently', async () => {
  const preset = await runExplorationPreset();
  assert.equal(preset.ownedAfterHistoryRemoval, true);
  assert.deepEqual(preset.states.map(state => state.mission.playDates), [1, 2, 3]);
  assert.deepEqual(preset.states.map(state => state.mission.recordedTurns), [9, 18, 25]);
  assert.deepEqual(preset.states.map(state => state.awards.includes('exploration-commission')), [false, false, true]);
});

test('mission API authenticates, validates named timezone, and preserves the first zone under concurrent starts', async t => {
  const f = await openExplorationPreset(); t.after(() => f.close());
  const path = 'missions/exploration-commission/start';
  assert.equal((await f.request(path, {body: {timeZone: 'UTC'}, token: null})).status, 401);
  for (const body of [{}, {timeZone: 'PST'}, {timeZone: '+01:00'}, {timeZone: 'Mars/Olympus'}, {timeZone: null}, {timeZone: 'UTC', startedAt: 1}]) {
    assert.equal((await f.request(path, {body})).status, 400, JSON.stringify(body));
  }
  const results = await Promise.all(['America/Los_Angeles', 'Pacific/Auckland'].map(timeZone => f.request(path, {body: {timeZone}})));
  assert.equal(results[0].status, 200); assert.equal(results[1].status, 200);
  assert.deepEqual(results[0].data.mission, results[1].data.mission);
});

test('the verified save boundary rejects client supplied evidence and excludes practice, abandoned, and pre-track games', async t => {
  const f = await openExplorationPreset(); t.after(() => f.close());
  const before = f.game(); before.finish();
  f.setNow(PRESET_START + 1000);
  await f.request('missions/exploration-commission/start', {body: {timeZone: 'UTC'}});
  assert.equal((await f.request('games', {body: before.reference, connectionId: before.host})).status, 201);
  const abandoned = f.game();
  assert.equal((await f.request('games', {body: abandoned.reference, connectionId: abandoned.host})).status, 409);
  const practice = f.game({sessionKind: 'development'}); practice.finish();
  assert.equal((await f.request('games', {body: practice.reference, connectionId: practice.host})).status, 409);
  const casual = f.game({gameFormat: 'casual'}); casual.finish();
  assert.equal((await f.request('games', {body: casual.reference, connectionId: casual.host})).status, 201);
  const g = f.game(); g.turns(4); g.finish();
  for (const extra of [{completedAt: PRESET_START}, {startingCommanderEvidence: {}}, {achievementFacts: {turnCount: 25}}, {commanderName: 'Captain Picard'}]) {
    assert.equal((await f.request('games', {body: {...g.reference, ...extra}, connectionId: g.host})).status, 400);
  }
  const stranger = f.service.createConnection().connectionId;
  assert.equal((await f.request('games', {body: g.reference, connectionId: stranger})).status, 403);
  const saved = await f.request('games', {body: g.reference, connectionId: g.host});
  assert.equal(saved.status, 201);
  const duplicate = await f.request('games', {body: g.reference, connectionId: g.host});
  assert.deepEqual(duplicate.data.unlockedAchievements, []);
  const mission = (await f.request('history')).data.history.explorationCommission;
  assert.equal(mission.recordedTurns, 4); assert.equal(mission.playDates, 1); assert.equal(mission.commanderVariety, 1);
});
