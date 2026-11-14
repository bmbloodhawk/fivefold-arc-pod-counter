import assert from 'node:assert/strict';
import test from 'node:test';
import { competitionRoute } from '../src/competition-http.js';
test('Pod invite scanning is advertised only by enabled staging, without requiring sign-in',async()=>{
 for(const appEnv of ['staging','production',undefined]) for(const enabled of [true,false]){
  const response=await competitionRoute({req:{method:'GET'},url:new URL('https://example.test/api/competitions/config'),domain:enabled?{}:null,appEnv,account:()=>{throw Error('Config must remain public');}});
  assert.equal(response.status,200);assert.equal(response.data.podInviteScannerEnabled,enabled&&appEnv==='staging');
 }
});
