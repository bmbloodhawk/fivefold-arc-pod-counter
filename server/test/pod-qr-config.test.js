import assert from 'node:assert/strict';
import test from 'node:test';
import { competitionRoute } from '../src/competition-http.js';
test('Pod invite scanning has staging and production parity while local and disabled servers stay restricted',async()=>{
 for(const appEnv of ['staging','production','local',undefined]) for(const enabled of [true,false]){
  const response=await competitionRoute({req:{method:'GET'},url:new URL('https://example.test/api/competitions/config'),domain:enabled?{}:null,appEnv,account:()=>{throw Error('Config must remain public');}});
  assert.equal(response.status,200);assert.equal(response.data.podInviteScannerEnabled,enabled&&['staging','production'].includes(appEnv));
 }
});
