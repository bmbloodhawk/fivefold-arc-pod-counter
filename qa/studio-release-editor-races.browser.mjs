// Hold individual responses to exercise edits made while the release UI is waiting.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const require=createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('../package.json',import.meta.url));
const engine=process.env.STUDIO_BROWSER || 'chromium';
const browser=await require('playwright-core')[engine].launch({
  headless:true,...(engine==='chromium' && process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
});
const editor=await readFile(new URL('../client/studio-release-editor.js',import.meta.url),'utf8');
const releases=Object.fromEntries(['First','Second'].map((name,i)=>{
  const id='skin-'+name.toLowerCase();
  return [id,{digest:String(i+1).repeat(64),body:{skin:{id,name},assets:[]}}];
}));
const harness=`<button id="mount"></button><script type="module">
  import {mountStudioReleaseEditor} from '/editor.js';
  window.draftId='skin-first';
  window.edit=(id,dirty)=>{
    window.draftId=id;
    document.dispatchEvent(new CustomEvent('studio:draft-state',{detail:{selectedId:id,dirty}}));
  };
  mountStudioReleaseEditor({mount:document.querySelector('#mount'),headers:{},getSelectedId:()=>window.draftId,
    prepareDraft:async()=>({id:window.draftId,revision:1}),renderFixture:async()=>[{pass:true}]});
</script>`;
const page=await browser.newPage({serviceWorkers:'block'});
const stopped=[], errors=[], sharedNetworks=[], withdrawals=[], confirmations=[];
const history=new Map([['skin-first',{staging:[{name:'First',digest:releases['skin-first'].digest}],public:[]}]]);
let confirmWithdrawal=false, writeUnavailable;
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>{
  if(dialog.message().startsWith('Withdraw')){
    confirmations.push(dialog.message());
    return confirmWithdrawal ? dialog.accept() : dialog.dismiss();
  }
  return dialog.accept();
});
let gate;
function delay(action){
  let arrived,resume;
  const ready=new Promise(resolve=>{arrived=resolve;});
  const pending=new Promise(resolve=>{resume=resolve;});
  gate={action,arrived,pending};
  return {ready,resume};
}
await page.route('http://studio.localhost/**',async route=>{
  const url=new URL(route.request().url()), path=url.pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:harness});
  if(path==='/editor.js')return route.fulfill({contentType:'text/javascript',body:editor});
  if(path==='/index.html')return route.fulfill({contentType:'text/html',body:'<title>Game fixture</title>'});
  const action=path.split('/').at(-1),input=route.request().postDataJSON();
  if(gate?.action===action){
    const waiting=gate;gate=null;waiting.arrived();await waiting.pending;
  }
  let json;
  if(action==='status')json={environment:writeUnavailable?'staging':'local',writeUnavailable,
    lanes:history.get(url.searchParams.get('skin')) || {staging:[],public:[]},networks:[
    {name:'Adapter A',address:'10.1.1.20'},{name:'Wi-Fi',address:'192.168.1.20'}]};
  else if(action==='withdraw'){
    withdrawals.push(input);
    history.get(input.id)[input.lane].unshift({name:releases[input.id].body.skin.name,digest:null});
    json={withdrawn:true};
  }
  else if(path.includes('/version/'))json=Object.values(releases).find(item=>item.digest===action);
  else if(action==='prepare')json=releases[input.id];
  else if(action==='inspect')json={};
  else if(action==='render-check')json={skin:input.release.body.skin,accounts:['locked','earned']};
  else if(action==='playtest'){
    const {digest}=input.release;
    sharedNetworks.push(input.networkAddress);
    json={ticket:'ticket-'+digest,url:'http://studio.localhost/table/'+digest,digest,
      qr:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='};
  }else if(action==='stop-playtest'){stopped.push(input.ticket);json={ended:true};}
  else throw new Error('Unexpected route '+path);
  await route.fulfill({json});
});
const ui=page.locator('#studioReleaseEditor');
const button=action=>ui.locator('[data-action="'+action+'"]');
const edit=(id,dirty)=>page.evaluate(([id,dirty])=>window.edit(id,dirty),[id,dirty]);
const done=()=>page.waitForFunction(()=>!document.querySelector('[data-action="prepare"]').disabled);
try{
  await page.goto('http://studio.localhost/');
  // First-release withdrawal and restoration are accessible to a fresh Studio with only a selected draft.
  await button('history').click();await done();
  assert.equal(await ui.locator('[data-tools]').isVisible(),false);
  assert.equal(await button('withdraw-staging').isVisible(),true);
  await button('withdraw-staging').click();await done();
  assert.deepEqual(withdrawals,[]);
  confirmWithdrawal=true;
  await button('withdraw-staging').click();await done();
  assert.deepEqual(withdrawals,[{id:'skin-first',lane:'staging',expected:releases['skin-first'].digest}]);
  assert.match(confirmations.at(-1),/Withdraw First \(111111111111\) from the staging rehearsal/);
  assert.match(await ui.locator('[data-history-status]').innerText(),/staging · withdrawn/);
  assert.deepEqual(await ui.locator('[data-history] option').evaluateAll(options=>options.map(o=>o.value)),
    ['staging/'+releases['skin-first'].digest]);
  await button('restore').click();await done();
  assert.match(await ui.locator('[data-version]').innerText(),/First/);
  await button('prepare').click();await done();
  await ui.locator('[data-network]').selectOption('192.168.1.20');
  await button('phone').click();await done();
  assert.deepEqual(sharedNetworks,['192.168.1.20']);
  assert.equal(await ui.locator('[data-qr]').isVisible(),true);

  // Switching packages must close the old phone session and remove its link and QR.
  await edit('skin-second',false);
  await button('prepare').click();await done();
  assert.match(await ui.locator('[data-version]').innerText(),/Second/);
  assert.deepEqual(stopped,['ticket-'+releases['skin-first'].digest]);
  assert.equal(await ui.locator('[data-session]').isVisible(),false);
  assert.equal(await ui.locator('[data-link]').getAttribute('href'),null);
  assert.equal(await ui.locator('[data-qr]').getAttribute('src'),null);

  // Editing and saving while preparation is in flight still supersedes that snapshot.
  const prepare=delay('prepare');
  await button('prepare').click();await prepare.ready;
  await edit('skin-second',true);await edit('skin-second',false);
  prepare.resume();await done();
  assert.match(await ui.locator('[data-result]').innerText(),/draft changed/i);
  assert.equal(await button('checks').isDisabled(),true);
  await button('prepare').click();await done();
  assert.equal(await button('checks').isEnabled(),true);

  const check=delay('render-check');
  await button('checks').click();await check.ready;
  await edit('skin-first',false);
  check.resume();await done();
  assert.match(await ui.locator('[data-result]').innerText(),/draft changed/i);
  assert.equal(await button('staging').isDisabled(),true);

  // An explicitly opened file stays bound to its own version while the draft changes.
  await ui.locator('[data-file]').setInputFiles({name:'second.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(releases['skin-second']))});
  await ui.getByText('Version ready for checks and phone review.').waitFor();
  const fileCheck=delay('render-check');
  await button('checks').click();await fileCheck.ready;
  await edit('skin-first',true);fileCheck.resume();await done();
  assert.match(await ui.locator('[data-result]').innerText(),/24 game screens passed/);
  assert.equal(await button('staging').isEnabled(),true);

  // A host with unavailable account redemption keeps inspection usable and blocks both writes.
  history.set('skin-second',{staging:[{name:'Second',digest:'9'.repeat(64)}]});
  writeUnavailable='Release changes need player sign-in and reward redemption configured on this service.';
  await edit('skin-second',false);await button('history').click();await done();
  assert.match(await ui.locator('[data-destination]').innerText(),/player sign-in/);
  assert.equal(await button('checks').isEnabled(),true);
  assert.equal(await button('staging').isDisabled(),true);
  assert.equal(await button('withdraw-staging').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log(engine,'passed hosted write gates, withdrawal, history, network selection, version switching and in-flight draft races');
}finally{await browser.close();}
