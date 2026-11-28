import assert from 'node:assert/strict';
import test from 'node:test';
import { explorationCommissionHtml, startExplorationCommission, mountExplorationCommission } from './exploration-commission.js';

test('unstarted mission shows three objectives and the timezone before beginning', () => {
  const html = explorationCommissionHtml(null, 'America/Los_Angeles');
  assert.match(html, /Exploration Commission/);
  for (const [label, total] of [['Command Rotation', 2], ['Survey Record', 25], ['Return Voyages', 3]]) {
    assert.match(html, new RegExp(label));
    assert.match(html, new RegExp('value="0" max="' + total + '"'));
  }
  assert.match(html, /Begin mission/);
  assert.match(html, /America\/Los_Angeles/);
  assert.match(html, /at least three play dates/i);
});

test('started and earned progress uses retained timezone and safely clamps counters', () => {
  const html = explorationCommissionHtml({startedAt: 1, timeZone: 'America/New_York', commanderVariety: 7,
    recordedTurns: 90, playDates: 4, earnedAt: 9}, 'Asia/Tokyo');
  assert.match(html, /Mission complete/);
  assert.match(html, /America\/New_York/);
  assert.doesNotMatch(html, /Asia\/Tokyo|Begin mission/);
  for (const max of [2,25,3]) assert.match(html, new RegExp('value="' + max + '" max="' + max + '"'));
  assert.equal((html.match(/<progress /g) || []).length, 3);
});

test('mission output escapes server and device timezone text', () => {
  const html = explorationCommissionHtml({startedAt:1,timeZone:'<img src=x onerror=alert(1)>',recordedTurns:-4});
  assert.doesNotMatch(html, /<img|value="-4"/);
  assert.match(html, /&lt;img/);
});

test('begin request submits the named timezone only and uses server mission response', async () => {
  let request;
  const mission = {startedAt:123,timeZone:'America/Los_Angeles'};
  const actual = await startExplorationCommission({token:'fixture-token',timeZone:'America/Los_Angeles',
    fetchImpl:async (url, options) => {
      request = {url,options};
      return {ok:true,json:async()=>({mission})};
    }});
  assert.deepEqual(actual, mission);
  assert.equal(request.url, '/api/account/missions/exploration-commission/start');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(request.options.body), {timeZone:'America/Los_Angeles'});
});

test('begin errors stay actionable and do not invent a start time or completion', async () => {
  await assert.rejects(startExplorationCommission({token:null,timeZone:'UTC'}), /Sign in/);
  await assert.rejects(startExplorationCommission({token:'fixture-token',timeZone:'',fetchImpl:async()=>{throw new Error('unexpected');}}), /timezone/i);
  await assert.rejects(startExplorationCommission({token:'fixture-token',timeZone:'UTC',
    fetchImpl:async()=>({ok:false,json:async()=>({error:'Choose a named IANA timezone.'})})}), /Choose a named IANA timezone/);
});

function mountedFixture(options) {
  let click;
  const button = {disabled:false,addEventListener:(_name,handler)=>{click=handler;}};
  const status = {textContent:''};
  const container = {innerHTML:'',querySelector:selector=>selector === '[data-begin-exploration]' ? button : status};
  mountExplorationCommission(container,null,{readTimeZone:()=> 'America/Los_Angeles',...options});
  return {container,button,status,click:()=>click()};
}

test('repeated begin clicks make one request and a failed request remains retryable', async () => {
  let calls = 0, release;
  const f = mountedFixture({getToken:()=>new Promise(resolve=>{release=resolve;}),
    fetchImpl:async()=>{calls++;return {ok:false,json:async()=>({error:'Please retry.'})};}});
  const pending = f.click();
  await f.click();
  assert.equal(f.button.disabled,true);
  release('fixture-token'); await pending;
  assert.equal(calls,1);
  assert.equal(f.button.disabled,false);
  assert.equal(f.status.textContent,'Please retry.');
});

test('closing or switching account ignores a late start response', async () => {
  let current = true, release;
  const f = mountedFixture({getToken:async()=> 'fixture-token',isCurrent:()=>current,
    fetchImpl:()=>new Promise(resolve=>{release=resolve;})});
  const pending = f.click(); await Promise.resolve();
  current = false;
  release({ok:true,json:async()=>({mission:{startedAt:123,timeZone:'America/Los_Angeles'}})});
  await pending;
  assert.match(f.container.innerHTML,/Begin mission/);
  assert.doesNotMatch(f.status.textContent,/Mission begun/);
});
