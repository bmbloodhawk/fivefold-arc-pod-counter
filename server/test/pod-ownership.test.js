import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions, scopePath } from '../src/competitions.js';
import { MemoryAccountHistoryStore, AccountHistory } from '../src/account-history.js';
import { createRealtimeServer } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

function fixture(options = {}) {
  const store = new MemoryAccountHistoryStore(); let sequence = 0, time = 1000, beforeWrite;
  const adapter = { read:path=>store.read(path), update:async(path,change)=>{
    if (path.startsWith('competitions/pods/') && beforeWrite) { const action=beforeWrite; beforeWrite=null; await action(path); }
    return store.update(path,change);
  } };
  const domain = new Competitions({store:adapter, now:()=>time, createId:()=>`owner${++sequence}`, podOwnershipEnabled:true, ...options});
  return {store,domain,advance:ms=>{time+=ms;},intercept:action=>{beforeWrite=action;}};
}
async function group(f) {
  const pod=await f.domain.createPod('creator',{name:'Owner rules',displayName:'Creator'});
  const invite=await f.domain.invite('creator','pod',pod.id);
  const early=await f.domain.joinPod('early',invite.token,{displayName:'Early member'});
  const late=await f.domain.joinPod('late',invite.token,{displayName:'Later member'});
  return {pod,early,late,invite};
}
const appoint=(f,pod,account,targetId,enabled=true)=>f.domain.podMemberAction(account,pod.id,{action:'admin',targetId,enabled});

test('the creator is owner; only that owner can appoint or remove admins',async()=>{
  const f=fixture(),{pod,early,late}=await group(f);
  assert.equal(pod.ownerId,pod.me); assert.equal(pod.canManageAdmins,true); assert.equal(pod.canDelete,true);
  await appoint(f,pod,'creator',early.me);
  await assert.rejects(()=>appoint(f,pod,'early',late.me),{status:403,code:'POD_OWNER_REQUIRED'});
  await assert.rejects(()=>appoint(f,pod,'early',early.me,false),{status:403});
  await appoint(f,pod,'creator',early.me,false);
  assert.equal((await f.domain.getPod('early',pod.id)).role,'member');
});

test('coadmins cannot remove or demote the owner or remove another admin',async()=>{
  const f=fixture(),{pod,early,late}=await group(f);
  await appoint(f,pod,'creator',early.me); await appoint(f,pod,'creator',late.me);
  for(const targetId of [pod.me,late.me]) await assert.rejects(()=>f.domain.podMemberAction('early',pod.id,{action:'remove',targetId}),{status:403});
  await assert.rejects(()=>appoint(f,pod,'creator',pod.me,false),{status:409,code:'POD_OWNER_TRANSFER_REQUIRED'});
  assert.equal((await f.domain.getPod('creator',pod.id)).ownerId,pod.me);
});

test('ownership goes to the admin appointed first, independently of join order and tied clocks',async()=>{
  const f=fixture(),{pod,early,late}=await group(f);
  await appoint(f,pod,'creator',late.me); await appoint(f,pod,'creator',early.me);
  const before=await f.domain.getPod('creator',pod.id);
  assert.equal(before.nextOwnerId,late.me);
  assert.deepEqual(await f.domain.podMemberAction('creator',pod.id,{action:'leave'}),{left:true});
  const after=await f.domain.getPod('late',pod.id);
  assert.equal(after.ownerId,late.me); assert.equal(after.canManageAdmins,true);
  await assert.rejects(()=>appoint(f,pod,'early',early.me,false),{status:403});
});

test('reappointing an existing admin preserves tenure; demotion then promotion starts a new tenure',async()=>{
  const f=fixture(),{pod,early,late}=await group(f);
  await appoint(f,pod,'creator',early.me); await appoint(f,pod,'creator',late.me);
  let before=await f.domain.readScope('pod',pod.id);
  await appoint(f,pod,'creator',early.me);
  let after=await f.domain.readScope('pod',pod.id);
  assert.equal(after.version,before.version); assert.equal(after.members[early.me].adminOrder,before.members[early.me].adminOrder);
  await appoint(f,pod,'creator',early.me,false); await appoint(f,pod,'creator',early.me);
  assert.equal((await f.domain.getPod('creator',pod.id)).nextOwnerId,late.me);
});

test('the last owner cannot leave without an eligible successor; ordinary members can leave',async()=>{
  const f=fixture(),{pod,early}=await group(f);
  await assert.rejects(()=>f.domain.podMemberAction('creator',pod.id,{action:'leave'}),{status:409,code:'POD_SUCCESSOR_REQUIRED'});
  await f.domain.podMemberAction('early',pod.id,{action:'leave'});
  assert.equal((await f.domain.getPod('creator',pod.id)).ownerId,pod.me);
  const solo=await f.domain.createPod('solo',{name:'Solo',displayName:'Solo'});
  await assert.rejects(()=>f.domain.podMemberAction('solo',solo.id,{action:'leave'}),{status:409});
  assert.deepEqual(await f.domain.deletePod('solo',solo.id,{confirmationName:'Solo'}),{deleted:true});
});

test('ordinary members cannot self-appoint through the old vacancy takeover route',async()=>{
  const f=fixture(),{pod,early}=await group(f);
  await f.domain.eraseAccount('creator');
  await assert.rejects(()=>f.domain.podMemberAction('early',pod.id,{action:'takeover'}),{status:403});
  assert.equal((await f.domain.getPod('early',pod.id)).role,'member');
  assert.equal((await f.domain.getPod('early',pod.id)).ownerId,null);
});

test('erased admins cannot inherit; an erased owner leaves authority only with an existing eligible admin',async()=>{
  const f=fixture(),{pod,early,late}=await group(f);
  await appoint(f,pod,'creator',early.me); await appoint(f,pod,'creator',late.me);
  await f.domain.eraseAccount('early');
  assert.equal((await f.domain.getPod('creator',pod.id)).nextOwnerId,late.me);
  await f.domain.eraseAccount('creator');
  assert.equal((await f.domain.getPod('late',pod.id)).ownerId,late.me);
  await appoint(f,pod,'late',late.me);
  assert.equal((await f.domain.readScope('pod',pod.id)).ownerId,late.me);
});

test('only the owner can permanently delete a Pod, even when another member is an admin',async()=>{
  const f=fixture(),{pod,early}=await group(f);
  await appoint(f,pod,'creator',early.me);
  assert.equal((await f.domain.getPod('early',pod.id)).canDelete,false);
  await assert.rejects(()=>f.domain.deletePod('early',pod.id,{confirmationName:pod.name}),{status:403,code:'POD_OWNER_REQUIRED'});
  assert.deepEqual(await f.domain.deletePod('creator',pod.id,{confirmationName:pod.name}),{deleted:true});
});

test('ownership and successor checks run against the current conditional scope state',async()=>{
  const f=fixture(),{pod,early,late}=await group(f);
  await appoint(f,pod,'creator',early.me); await appoint(f,pod,'creator',late.me);
  f.intercept(path=>f.store.update(path,scope=>{scope.ownerId=early.me;return scope;}));
  await assert.rejects(()=>appoint(f,pod,'creator',late.me,false),{status:403});
  assert.equal((await f.domain.getPod('late',pod.id)).role,'admin');
  f.intercept(path=>f.store.update(path,scope=>{scope.members[late.me].role='member';return scope;}));
  await f.domain.podMemberAction('early',pod.id,{action:'leave'});
  assert.equal((await f.domain.getPod('creator',pod.id)).ownerId,pod.me);
});

test('a legacy singleton has one known creator; admin tenure is recorded before inviting more members',async()=>{
  const f=fixture(),pod=await f.domain.createPod('creator',{name:'Legacy',displayName:'Creator'});
  await f.store.update(scopePath('pod',pod.id),scope=>{delete scope.ownerId;delete scope.members[pod.me].adminOrder;delete scope.members[pod.me].adminSince;return scope;});
  assert.equal((await f.domain.getPod('creator',pod.id)).ownerId,pod.me);
  const invite=await f.domain.invite('creator','pod',pod.id); f.advance(1);
  const early=await f.domain.joinPod('early',invite.token,{displayName:'Early'}); f.advance(1);
  const late=await f.domain.joinPod('late',invite.token,{displayName:'Late'});
  await appoint(f,pod,'creator',late.me); await appoint(f,pod,'creator',early.me);
  const dto=await f.domain.getPod('creator',pod.id);
  assert.equal(dto.ownerId,pod.me); assert.equal(dto.nextOwnerId,late.me);
  await f.domain.podMemberAction('creator',pod.id,{action:'leave'});
  assert.equal((await f.domain.getPod('late',pod.id)).ownerId,late.me);
});

test('an earlier legacy join timestamp cannot grant ownership to a later member',async()=>{
  const f=fixture(),{pod,early}=await group(f); await appoint(f,pod,'creator',early.me);
  await f.store.update(scopePath('pod',pod.id),scope=>{delete scope.ownerId;scope.members[early.me].joinedAt=1;return scope;});
  const dto=await f.domain.getPod('early',pod.id);
  assert.equal(dto.ownerId,null); assert.equal(dto.canDelete,false);
  await assert.rejects(()=>f.domain.deletePod('early',pod.id,{confirmationName:pod.name}),{status:409,code:'POD_OWNERSHIP_REVIEW_REQUIRED'});
});

test('missing or inconsistent owner records and missing identities require review instead of granting authority',async()=>{
  for(const damage of ['missing owner','left owner','missing identity']) {
    const f=fixture(),{pod,early}=await group(f); await appoint(f,pod,'creator',early.me);
    const identity=await f.domain.identity('creator');
    if(damage==='missing identity') await f.store.update('competitions/directory.json',directory=>{delete directory.identities[identity];return directory;});
    else await f.store.update(scopePath('pod',pod.id),scope=>{if(damage==='missing owner')scope.ownerId='member_unknown';else scope.members[pod.me].status='left';return scope;});
    const dto=await f.domain.getPod('early',pod.id); assert.equal(dto.ownerId,null); assert.equal(dto.canManageAdmins,false);
    await assert.rejects(()=>appoint(f,pod,'early',early.me,false),{status:409});
  }
});

test('ambiguous legacy creator data keeps gameplay access but cannot grant owner privileges',async()=>{
  const f=fixture(),{pod,early}=await group(f);
  await appoint(f,pod,'creator',early.me);
  await f.store.update(scopePath('pod',pod.id),scope=>{delete scope.ownerId;for(const member of Object.values(scope.members)){delete member.adminOrder;delete member.adminSince;}return scope;});
  const dto=await f.domain.getPod('early',pod.id);
  assert.equal(dto.ownerId,null); assert.equal(dto.ownershipNeedsReview,true); assert.equal(dto.canManageAdmins,false);
  await assert.rejects(()=>appoint(f,pod,'early',early.me,false),{status:409,code:'POD_OWNERSHIP_REVIEW_REQUIRED'});
});

test('the ownership policy activates only for the legacy staging server, leaving production/default behavior intact',async t=>{
  for(const appEnv of ['staging','production']) {
    const store=new MemoryAccountHistoryStore();
    const instance=createRealtimeServer({appEnv,competitionStore:store,ledger:new MemoryPlaytestLedger(),accountHistory:new AccountHistory({store:new MemoryAccountHistoryStore()}),accountVerifier:{verify:async token=>({providerSubject:token})}});
    t.after(()=>new Promise(resolve=>instance.server.close(resolve)));
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
    const response=await fetch(`http://127.0.0.1:${instance.server.address().port}/api/competitions/pods`,{method:'POST',headers:{authorization:'Bearer creator','content-type':'application/json'},body:JSON.stringify({name:'HTTP owner policy',displayName:'Creator'})});
    assert.equal(response.status,201);
    const pod=await response.json();
    assert.equal(Object.hasOwn(pod,'ownerId'),appEnv==='staging');
    if(appEnv==='staging') assert.equal(pod.ownerId,pod.me);
  }
  const identityStore={lookup:async()=>null,scopeProfile:async()=>null,setAlias:async()=>{}};
  assert.equal(fixture({identityStore}).domain.podOwnershipEnabled,false);
});

test('the separately configured staging privacy eraser permits only a surviving admin to inherit',async t=>{
  const store=new MemoryAccountHistoryStore();
  const eraser=new Competitions({store,podOwnershipEnabled:true});
  const history=new AccountHistory({store:new MemoryAccountHistoryStore()});
  const instance=createRealtimeServer({appEnv:'staging',competitionStore:store,competitionEraser:eraser,
    accountHistory:history,ledger:new MemoryPlaytestLedger(),accountVerifier:{verify:async token=>({providerSubject:token})}});
  await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{instance.server.closeAllConnections();return new Promise(resolve=>instance.server.close(resolve));});
  const creator=await history.ensureAccount('creator'),admin=await history.ensureAccount('admin');
  const pod=await instance.competitions.createPod(creator,{name:'Privacy successor',displayName:'Creator'});
  const invite=await instance.competitions.invite(creator,'pod',pod.id);
  const other=await instance.competitions.joinPod(admin,invite.token,{displayName:'Admin'});
  await instance.competitions.podMemberAction(creator,pod.id,{action:'admin',targetId:other.me,enabled:true});
  const response=await fetch(`http://127.0.0.1:${instance.server.address().port}/api/account`,{method:'DELETE',headers:{authorization:'Bearer creator'}});
  assert.equal(response.status,204);
  assert.equal((await instance.competitions.getPod(admin,pod.id)).ownerId,other.me);
});

test('default and production-style erasure do not write staging ownership metadata',async()=>{
  const f=fixture({podOwnershipEnabled:false});
  await f.domain.createPod('creator',{name:'Default erasure',displayName:'Creator'});
  await f.domain.eraseAccount('creator');
  assert.equal(Object.hasOwn(await f.domain.directory(),'erasedIdentities'),false);
});
