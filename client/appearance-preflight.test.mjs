import assert from 'node:assert/strict';
import test from 'node:test';
import { previewGeometryChecks, hiddenByClosedDetails, settlePreviewDocument } from './appearance-preflight.js';
const size={width:320,height:700};
const target={label:'End turn',x:4,y:500,width:312,height:44};
const native={width:320,height:700,scrollWidth:320,scrollHeight:820,targets:[target]};

test('closed disclosure descendants are excluded even when WebKit reports rectangles',()=>{
  const details={tagName:'DETAILS',open:false,parentElement:null};
  const summary={tagName:'SUMMARY',parentElement:details,contains:node=>node===summary||node===summaryChild};
  const summaryChild={tagName:'SPAN',parentElement:summary};
  const button={tagName:'BUTTON',parentElement:details,getClientRects:()=>[{width:200,height:49}]};
  details.children=[summary,button];
  assert.equal(hiddenByClosedDetails(button),true);
  assert.equal(hiddenByClosedDetails(summary),false);
  assert.equal(hiddenByClosedDetails(summaryChild),false);
  details.open=true;assert.equal(hiddenByClosedDetails(button),false);
});

test('measurement waits for fonts and finite view entrance motion while leaving decorative loops alone',async()=>{
  const events=[];let finishFont,finishView;
  const fontReady=new Promise(resolve=>{finishFont=resolve;});
  const viewReady=new Promise(resolve=>{finishView=resolve;});
  const doc={fonts:{ready:fontReady},getAnimations(){events.push('animations');return[
    {effect:{target:{classList:{contains:()=>true}},getTiming:()=>({iterations:1})},finished:viewReady},
    {effect:{target:{classList:{contains:()=>false}},getTiming:()=>({iterations:Infinity})},finished:new Promise(()=>{})},
  ];},defaultView:{requestAnimationFrame(callback){events.push('frame');callback();}}};
  const settled=settlePreviewDocument(doc);assert.deepEqual(events,[]);
  finishFont();await Promise.resolve();assert.deepEqual(events,['animations']);
  finishView();await settled;assert.deepEqual(events,['animations','frame','frame']);
});

test('required controls cannot disappear and turn a screen green',()=>{
  const checks=previewGeometryChecks({...native,requirements:[{label:'Commander source',found:0,minimum:1}]},size);
  assert.ok(checks.some(check=>!check.pass&&check.label.includes('Commander source')));
});
test('target clipping, undersizing and overlap of independent actions fail',()=>{
  assert.ok(previewGeometryChecks({...native,targets:[{...target,clipped:true}]},size).some(check=>!check.pass));
  assert.ok(previewGeometryChecks({...native,targets:[{...target,height:37}]},size).some(check=>!check.pass));
  assert.ok(previewGeometryChecks({...native,overlaps:[{first:'End turn',second:'Custom life',width:200,height:12}]},size).some(check=>!check.pass));
});
test('unclipped vertically scrollable controls and native decorative layering pass',()=>{
  assert.ok(previewGeometryChecks({...native,targets:[{...target,y:740}],overlaps:[],labels:[],values:[]},size).every(check=>check.pass));
});
test('a control inside a vertically scrollable menu remains reachable below the current viewport',()=>{
  assert.ok(previewGeometryChecks({...native,scrollHeight:700,targets:[{...target,y:1100,scrollable:true}]},size).every(check=>check.pass));
  assert.ok(previewGeometryChecks({...native,targets:[{...target,width:42,height:42,minimum:42}]},size).every(check=>check.pass));
  assert.ok(previewGeometryChecks({...native,targets:[{...target,width:38,height:38,minimum:42}]},size).some(check=>!check.pass));
});
test('clipped action labels and counter ink fail with the affected name',()=>{
  const checks=previewGeometryChecks({...native,labels:[{label:'Energy navigation label',clipped:true}],values:[{label:'Counter value 1040',clipped:true,overlap:'Counter name'}]},size);
  assert.ok(checks.some(check=>!check.pass&&check.label.includes('Energy navigation label')));
  assert.ok(checks.some(check=>!check.pass&&check.label.includes('1040')));
});
