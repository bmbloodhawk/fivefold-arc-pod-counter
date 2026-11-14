import assert from 'node:assert/strict';
import test from 'node:test';
import { podInviteFromQr } from './pod-invite-qr.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const origin='https://fivefold-arc-pod-counter-staging.onrender.com';
const token='pod.pod_Abc-123_456.inviteSecret_123-456';
test('Pod QR accepts a bounded Pod capability or this environment’s generated invite link',()=>{
  assert.equal(podInviteFromQr(token,origin),token);
  assert.equal(podInviteFromQr(` ${origin}/index.html#invite=${encodeURIComponent(token)} `,origin),token);
  assert.equal(podInviteFromQr(`${origin}/#invite=${token}`,origin),token);
});
test('Pod QR rejects Table, tournament, guest, malformed and oversized QR payloads',()=>{
  for(const value of ['ABC123',origin+'/?join=ABC123','tournament.event_one.secret',origin+'/#event=event_one&guest=guest_token',origin+'/#invite='+token+'&guest=guest_token',origin+'/#invite='+token+'&invite='+token,origin+'/#invite='+token+'&x=1',origin+'/#invite='+encodeURIComponent(encodeURIComponent(token.replace('pod_','pod%5F'))), 'pod.pod_one.'+'x'.repeat(241),null,{},'unrelated']) assert.equal(podInviteFromQr(value,origin),null,String(value));
});
test('scanned links cannot send invites to another origin or navigate to a foreign scheme or page',()=>{
  for(const value of ['https://evil.test/#invite='+token,'https://fivefold-arc-pod-counter.onrender.com/#invite='+token,'http://fivefold-arc-pod-counter-staging.onrender.com/#invite='+token,'https://user:password@fivefold-arc-pod-counter-staging.onrender.com/#invite='+token,'javascript:alert(1)#invite='+token,origin+'/privacy.html#invite='+token,origin+'/?join=ABC123#invite='+token,origin+'/#invite=pod.pod_bad.%3Cscript%3E',origin+'/#invite=pod.pod_bad.se\ncret'])assert.equal(podInviteFromQr(value,origin),null);
});

test('Back stops scanning before waiting for the Pod list, so a late camera result cannot open a preview',async()=>{
  const source=await readFile(new URL('./competition-ui.js',import.meta.url),'utf8');
  const start=source.indexOf('  const run = async '),end=source.indexOf('  const bind = ',start);
  assert.ok(start>=0&&end>start);
  let cameraReading=true,previews=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const context=vm.createContext({navigationEpoch:0,dialog:{open:true},content:{setAttribute(){},removeAttribute(){}},message(){},stopInviteScanner(){cameraReading=false;}});
  const run=vm.runInContext(source.slice(start,end)+'run;',context);
  const back=run(()=>pending);
  if(cameraReading)previews++; // A decode delivered while home() is still pending.
  release();await back;
  assert.equal(previews,0,'Leaving the scanner must win over late QR detection');
});
