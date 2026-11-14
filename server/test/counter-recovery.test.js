import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../src/app.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { startCompetitionRestFixture } from '../../qa/competition-rest-fixture.mjs';

const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Address the logical recovery record for either a standalone PUT or a batch.
function recoveryWrite(url, options, path) {
  if (!path) return null;
  if (options.method === 'PUT' && url.endsWith(path)) return JSON.parse(options.body);
  if (options.method === 'PATCH') return JSON.parse(options.body)[path.replace(/^\//, '').replace(/\.json$/, '')] || null;
  return null;
}
async function fixture(t, intercept = async () => null, options = {}) {
  const database = await startCompetitionRestFixture({ delayMs: 5 }), releases = [];
  const ledger = new FirebasePlaytestLedger({ databaseUrl: database.url, clientEmail: 'fixture', privateKey: 'fixture',
    logger: { error() {} }, fetchImpl: async (url, options = {}) => {
      const response = await intercept(url, options); return response || fetch(url, options);
    } });
  ledger.accessToken = async () => 'local-fixture-only';
  const app = createRealtimeServer({ appEnv: 'test', ledger, autoRecoverRooms: true, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const release of releases) release();
    await ledger.flush();
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve)); await database.close();
  });
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (code, action, connectionId, body, method = 'POST') => {
    const response = await fetch(origin + '/api/rooms/' + code + (action ? '/' + action : ''), {
      method, signal: AbortSignal.timeout(10000), headers: { ...(connectionId ? {'x-connection-id': connectionId} : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return {status:response.status, data:await response.json()};
  };
  async function room() {
    const host = app.service.createConnection().connectionId, guest = app.service.createConnection().connectionId;
    const created = app.service.createRoom(host,{playerCount:2,startingLife:40});
    const code = created.snapshot.code;
    app.service.claimSeat(code,guest,{seatId:1,name:'Guest'});
    app.service.startGame(code,host,{baseVersion:app.service.room(code).version});
    await ledger.flush(); return {code,host,guest};
  }
  return {...app,ledger,database,call,room,releases,origin};
}

for (const method of ['POST','PATCH']) {
  test(method + ' counter confirmation waits for its frozen recovery save; another Table stays responsive', {timeout:10000}, async t => {
    const blocked=gate(), entered=gate(); let heldPath;
    const f=await fixture(t,async(url,options)=>{
      if (recoveryWrite(url, options, heldPath)) {entered.release();await blocked.promise;}
    });
    f.releases.push(blocked.release); const a=await f.room(), b=await f.room();
    heldPath='/recovery/'+a.code+'.json'; let replied=false;
    const input=method==='POST' ? {counter:'life',delta:1,operationId:'durable_counter_change_0001'}
      : {baseVersion:f.service.room(a.code).version,counters:{life:41}};
    const pending=f.call(a.code,method==='POST'?'adjust':'me',a.host,input,method).then(result=>{replied=true;return result;});
    await entered.promise; await pause(40);
    assert.equal(replied,false,'No success response before the recovery write succeeds.');
    assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,40);
    const independent=await Promise.race([
      f.call(b.code,'adjust',b.host,{counter:'life',delta:1,operationId:'independent_counter_0001'}),
      pause(500).then(()=>{throw new Error('An independent Table waited on another Table save.');}),
    ]);
    assert.equal(independent.status,200);
    assert.equal(f.database.read('recovery/'+b.code+'.json').room.seats[0].counters.life,41);
    blocked.release(); assert.equal((await pending).status,200);
    assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,41);
  });
}

test('concurrent duplicate retries share the recovery acknowledgement and apply once', {timeout:10000}, async t=>{
  const blocked=gate(), entered=gate(); let heldPath;
  const f=await fixture(t,async(url,options)=>{
    if(recoveryWrite(url,options,heldPath)){entered.release();await blocked.promise;}
  });
  f.releases.push(blocked.release); const a=await f.room();heldPath='/recovery/'+a.code+'.json';
  const body={counter:'life',delta:1,operationId:'duplicate_recovery_change_0001'};
  let replies=0; const send=()=>f.call(a.code,'adjust',a.host,body).then(result=>{replies++;return result;});
  const first=send();await entered.promise;const duplicate=send();await pause(40);
  assert.equal(replies,0,'A duplicate must not bypass the original pending save.');
  blocked.release();const results=await Promise.all([first,duplicate]);
  assert.ok(results.every(result=>result.status===200));assert.equal(results[1].data.deduplicated,true);
  assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,41);
  const events=Object.values(f.database.read('playtests/'+f.service.room(a.code).gameId+'/events.json'));
  assert.equal(events.filter(event=>event?.type==='counter_adjusted').length,1);
});

test('failed saves return a retryable error; a room refresh retries the same frozen state without another delta', {timeout:10000}, async t=>{
  let fail=false,target;
  const f=await fixture(t,async(url,options)=>fail&&recoveryWrite(url,options,target)
    ? Response.json({error:'disposable storage outage'},{status:503}):null);
  const a=await f.room();target='/recovery/'+a.code+'.json';fail=true;
  const body={counter:'life',delta:1,operationId:'failed_recovery_change_0001'};
  const rejected=await f.call(a.code,'adjust',a.host,body);
  assert.equal(rejected.status,503);assert.equal(rejected.data.error.code,'RECOVERY_SAVE_FAILED');
  assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,40);
  const unavailable=await f.call(a.code,'',a.host,undefined,'GET');
  assert.equal(unavailable.status,503,'A refresh must not silently confirm unpersisted state.');
  fail=false;
  const refreshed=await f.call(a.code,'',a.host,undefined,'GET');
  assert.equal(refreshed.status,200);assert.equal(refreshed.data.snapshot.seats[0].counters.life,41);
  assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,41);
  const duplicate=await f.call(a.code,'adjust',a.host,body);
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.deduplicated,true);
  assert.equal(duplicate.data.snapshot.seats[0].counters.life,41);
});

test('a completed-game adjustment waits for the final recovery record, including frozen result evidence', {timeout:10000}, async t=>{
  const blocked=gate(),entered=gate();let target;
  const f=await fixture(t,async(url,options)=>{
    if(recoveryWrite(url,options,target)?.room.completedGames?.length){
      entered.release();await blocked.promise;
    }
  });
  f.releases.push(blocked.release);const a=await f.room();target='/recovery/'+a.code+'.json';let replied=false;
  const pending=f.call(a.code,'adjust',a.guest,{counter:'life',delta:-40,operationId:'lethal_recovery_change_0001'})
    .then(result=>{replied=true;return result;});
  await entered.promise;await pause(40);
  assert.equal(replied,false,'Completion must wait for the final snapshot, not the earlier result event.');
  blocked.release();const result=await pending;assert.equal(result.status,200);
  const saved=f.database.read('recovery/'+a.code+'.json').room;
  assert.equal(saved.completedGames[0].gameId,result.data.snapshot.completedGameId);
  assert.equal(saved.seats[1].counters.life,0);
});

test('a newer successful recovery must not be overwritten by retrying an earlier failed save', {timeout:10000},async t=>{
  let fail=false,target;
  const f=await fixture(t,async(url,options)=>fail&&recoveryWrite(url,options,target)
    ? Response.json({error:'disposable failure'},{status:503}):null);
  const a=await f.room();target='/recovery/'+a.code+'.json';fail=true;
  const first={counter:'life',delta:1,operationId:'older_failed_recovery_0001'};
  assert.equal((await f.call(a.code,'adjust',a.host,first)).status,503);
  fail=false;
  assert.equal((await f.call(a.code,'adjust',a.host,{counter:'life',delta:1,operationId:'newer_saved_recovery_0002'})).status,200);
  assert.equal((await f.call(a.code,'adjust',a.host,first)).data.deduplicated,true);
  await f.ledger.flush();
  assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,42);
});

test('successful confirmation adds no storage reads or extra ordinary recovery writes', {timeout:10000}, async t=>{
  const f=await fixture(t),a=await f.room(),before=f.database.calls.length;
  const result=await f.call(a.code,'adjust',a.host,{counter:'life',delta:1,operationId:'existing_write_receipt_0001'});
  assert.equal(result.status,200);await f.ledger.flush();
  const calls=f.database.calls.slice(before);
  assert.equal(calls.filter(call=>call.method==='GET').length,0);
  assert.deepEqual(calls.map(call=>call.method),['PATCH'],'The event and recovery persist together without any extra I/O.');
});

test('a failed recovery retry uses admission-time bytes even if its original object changes', {timeout:10000},async t=>{
  let fail=true;
  const f=await fixture(t,async(url,options)=>fail&&recoveryWrite(url,options,'/recovery/FIX123.json')
    ? Response.json({error:'disposable failure'},{status:503}):null);
  const record={roomCode:'FIX123',room:{version:2,seats:[{counters:{life:41}}]}};
  await assert.rejects(f.ledger.recovery(record),/503/);
  record.room.version=999;record.room.seats[0].counters.life=999;fail=false;
  await f.ledger.waitForRecovery('FIX123');
  const saved=f.database.read('recovery/FIX123.json');
  assert.equal(saved.room.version,2);assert.equal(saved.room.seats[0].counters.life,41);
});

test('a stalled recovery has a bounded HTTP wait and can finish after a timeout', {timeout:10000},async t=>{
  const blocked=gate(),entered=gate();let target;
  const f=await fixture(t,async(url,options)=>{
    if(recoveryWrite(url,options,target)){entered.release();await blocked.promise;}
  });
  f.releases.push(blocked.release);const a=await f.room();target='/recovery/'+a.code+'.json';
  const pending=f.call(a.code,'adjust',a.host,{counter:'life',delta:1,operationId:'slow_recovery_change_0001'});
  await entered.promise;const failed=await pending;
  assert.equal(failed.status,503);assert.equal(failed.data.error.code,'RECOVERY_SAVE_FAILED');
  assert.equal(f.database.read('recovery/'+a.code+'.json').room.seats[0].counters.life,40);
  blocked.release();await f.ledger.flush();
  const refreshed=await f.call(a.code,'',a.host,undefined,'GET');
  assert.equal(refreshed.status,200);assert.equal(refreshed.data.snapshot.seats[0].counters.life,41);
});

test('SSE life feedback remains immediate while the HTTP save confirmation is pending', {timeout:10000},async t=>{
  const blocked=gate(),entered=gate();let target;
  const f=await fixture(t,async(url,options)=>{
    if(recoveryWrite(url,options,target)){entered.release();await blocked.promise;}
  });
  f.releases.push(blocked.release);const a=await f.room();
  const controller=new AbortController();
  const response=await fetch(f.origin+'/api/rooms/'+a.code+'/events?connectionId='+a.host,{signal:controller.signal});
  assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let buffered='';
  t.after(async()=>{controller.abort();try{await reader.cancel();}catch{}});
  async function life(value){
    for(;;){
      let boundary;
      while((boundary=buffered.indexOf('\n\n'))>=0){
        const block=buffered.slice(0,boundary);buffered=buffered.slice(boundary+2);
        if(block.startsWith('event: snapshot\n')&&JSON.parse(block.split('\n').find(line=>line.startsWith('data:')).slice(5)).seats[0].counters.life===value)return;
      }
      const chunk=await reader.read();assert.equal(chunk.done,false);buffered+=decoder.decode(chunk.value,{stream:true});
    }
  }
  await life(40);target='/recovery/'+a.code+'.json';let replied=false;
  const pending=f.call(a.code,'adjust',a.host,{counter:'life',delta:1,operationId:'immediate_live_feedback_0001'}).then(result=>{replied=true;return result;});
  await entered.promise;
  await Promise.race([life(41),pause(500).then(()=>{throw new Error('Live feedback waited for storage.');})]);
  assert.equal(replied,false);blocked.release();assert.equal((await pending).status,200);
});

test('competition completion HTTP snapshots also wait for their recovery save', {timeout:10000},async t=>{
  const blocked=gate(),entered=gate();let target;
  const f=await fixture(t,async(url,options)=>{
    if(recoveryWrite(url,options,target)){entered.release();await blocked.promise;}
  },{competitionStore:new MemoryAccountHistoryStore()});
  f.releases.push(blocked.release);const a=await f.room();target='/recovery/'+a.code+'.json';
  // Isolate the shared response boundary; domain permissions/clock rules have their
  // existing full integration coverage. This stand-in produces a real completion.
  f.competitionTables.timedDraw=(_auth,{code,connectionId,baseVersion})=>f.service.declareWinner(code,connectionId,{baseVersion,winnerSeatId:0});
  let replied=false;
  const pending=fetch(f.origin+'/api/competitions/tables/timed-draw',{method:'POST',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json','x-connection-id':a.host},
    body:JSON.stringify({code:a.code,baseVersion:f.service.room(a.code).version})})
    .then(async response=>{replied=true;return {status:response.status,data:await response.json()};});
  await entered.promise;await pause(40);assert.equal(replied,false,'Competition completion must share the recovery acknowledgement.');
  blocked.release();const result=await pending;assert.equal(result.status,200);
  assert.equal(f.database.read('recovery/'+a.code+'.json').room.completedGames[0].gameId,result.data.snapshot.completedGameId);
});

async function startWorker(databaseUrl) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../qa/competition-local-server.mjs',import.meta.url))],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,
      COMPETITION_QA_PORT:'0',COMPETITION_QA_DATABASE_URL:databaseUrl},
  });
  let output='',errors='';
  child.stderr.on('data',chunk=>{errors+=chunk;});
  const origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Local recovery worker startup timed out: '+errors));},10000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=/COMPETITION_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Local worker exited '+code+': '+errors));});
  });
  return {origin,child,async kill(){if(child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;}}};
}

test('twenty acknowledged changes survive actual SIGKILL, fresh-process recovery and a lost-response retry', {timeout:30000},async t=>{
  const database=await startCompetitionRestFixture({delayMs:50}),workers=[];
  t.after(async()=>{for(const worker of workers)await worker.kill();await database.close();});
  let app=await startWorker(database.url);workers.push(app);
  const request=async(path,connection,body)=>{
    const response=await fetch(app.origin+path,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(10000),
      headers:{...(connection?{'x-connection-id':connection}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  const host=(await request('/api/connections',null,{})).data.connectionId;
  const guest=(await request('/api/connections',null,{})).data.connectionId;
  const created=(await request('/api/rooms',host,{playerCount:2,startingLife:40})).data,code=created.snapshot.code;
  await request('/api/rooms/'+code+'/claim',guest,{seatId:1});
  const room=(await request('/api/rooms/'+code)).data.snapshot;
  const started=(await request('/api/rooms/'+code+'/start-game',host,{baseVersion:room.version})).data.snapshot;
  for(let tick=0;tick<100&&database.read('recovery/'+code+'.json')?.room?.version!==started.version;tick++)await pause(20);
  assert.equal(database.read('recovery/'+code+'.json').room.version,started.version);
  const changes=Array.from({length:20},(_,index)=>({counter:'life',delta:1,operationId:'hard_crash_delta_'+String(index).padStart(4,'0')}));
  const accepted=await Promise.all(changes.map(body=>request('/api/rooms/'+code+'/adjust',host,body)));
  assert.ok(accepted.every(result=>result.status===200));
  await app.kill();await pause(150);app=await startWorker(database.url);workers.push(app);
  const restored=(await request('/api/rooms/'+code)).data.snapshot;
  assert.equal(restored.seats[0].counters.life,60,'Every successful HTTP change must survive without flushing the writer.');
  assert.equal((await request('/api/rooms/'+code+'/adjust',host,changes[19])).status,401,'Old connection authority must not survive restart.');
  const replacement=(await request('/api/connections',null,{})).data.connectionId;
  assert.equal((await request('/api/rooms/'+code+'/claim',replacement,{seatId:0,reclaimToken:created.reclaimToken})).status,200);
  const retry=await request('/api/rooms/'+code+'/adjust',replacement,changes[19]);
  assert.equal(retry.status,200);assert.equal(retry.data.deduplicated,true);assert.equal(retry.data.snapshot.seats[0].counters.life,60);
});
