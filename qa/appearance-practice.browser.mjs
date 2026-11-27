// Run against a disposable in-memory Studio. The phone context only holds its practice ticket.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSkinRelease} from '../server/src/studio-release-package.js';

const address=new URL(process.argv[2]);
assert.equal(address.hostname,'127.0.0.1');
const review=await fetch(address);
assert.equal(review.headers.get('x-studio-fixture'),'memory');
const key=(await review.text()).match(/setItem\("fivefold-arc:developer-key","([0-9a-f]+)"\)/)?.[1];
assert.ok(key);
const request=(action,data)=>fetch(new URL('/api/appearance-studio/releases/'+action,address),{
  method:'POST',headers:{'content-type':'application/json','x-feedback-portal-key':key},body:JSON.stringify(data)
});
const draft={id:'skin-practice-browser',name:'Practice fixture',status:'Draft',sourceSkinId:'__neutral_arc__',
  rendererVersion:2,commanderTreatment:'prismatic-glass',interfaceStyle:'dial',background:'#0b1117',
  surface:'#13212b',text:'#fffbed',muted:'#ddd5c9',accent:'#efce89',rewardRule:{allOf:['first-crown']}};
const release=await buildSkinRelease(draft,{revision:1,skins:[draft],assets:[]},async()=>null,[]);
const start=await request('playtest',{release});
assert.equal(start.status,201,await start.clone().text());
const ticket=await start.json();
const require=createRequire(process.env.PLAYWRIGHT_TOOLING||new URL('../package.json',import.meta.url));
const {chromium,webkit}=require('playwright-core');
const engine=process.env.STUDIO_BROWSER||'chromium';
const browser=engine==='webkit'?await webkit.launch():await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const forbidden=[],errors=[];
  const ticketPath='/api/studio-playtests/'+ticket.ticket;
  let statusUnavailable=false, artworkFetches=0;
  async function allowPracticeRequest(route) {
    const req=route.request(), url=new URL(req.url());
    if (url.origin!==address.origin || req.method()!=='GET' || url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/studio-playtests/')) {
      forbidden.push(req.method()+' '+url.pathname); return route.abort();
    }
    if (url.pathname===ticketPath) artworkFetches++;
    if (url.pathname===ticketPath+'/status' && statusUnavailable) {
      return route.fulfill({status:503,body:'Temporarily unavailable'});
    }
    return route.continue();
  }
  await context.route('**/*',allowPracticeRequest);
  await context.addInitScript(()=>{
    window.practiceWrites=[];
    for(const method of ['setItem','removeItem','clear']){
      const orig=Storage.prototype[method];
      Storage.prototype[method]=function(...args){window.practiceWrites.push([method,args[0]]);return orig.apply(this,args);};
    }
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.goto(ticket.url);
  const game=page.locator('#gameView'), menu=page.getByRole('button',{name:'Practice options'});
  await menu.waitFor();
  assert.equal(await game.getAttribute('data-glass-owner'),'UR');
  assert.equal(await page.locator('#mainValue').textContent(),'40');
  async function tapPlus() {
    const label = await page.locator('.dial-step-plus-label').boundingBox();
    await page.touchscreen.tap(label.x+label.width/2,label.y+label.height/2);
  }
  await tapPlus();
  assert.equal(await page.locator('#mainValue').textContent(),'41');
  await page.locator('[data-seat="P2"]').click();
  assert.equal(await page.locator('#mainValue').textContent(),'40');
  assert.equal(await game.getAttribute('data-glass-owner'),'UR');
  assert.equal(await game.getAttribute('data-glass-viewed'),'WB');
  await page.locator('[data-mode="poison"]').click();
  await tapPlus();
  assert.equal(await page.locator('#mainValue').textContent(),'1');
  await menu.click();
  const options=page.getByRole('dialog',{name:'Practice table'});
  await options.locator('[data-practice-style]').selectOption('button');
  await options.locator('[data-practice-seat]').selectOption('P1');
  const owner=options.locator('[data-practice-commander]'), partner=options.locator('[data-practice-colleague]');
  await owner.getByLabel('Blue').uncheck();await owner.getByLabel('Red').uncheck();await owner.getByLabel('Black').check();
  await options.getByLabel('Partner commander').check();
  await partner.getByLabel('Green').check();
  await options.getByRole('button',{name:'Back to table'}).click();
  assert.equal(await page.locator('#mainValue').textContent(),'1');
  assert.equal(await game.getAttribute('data-glass-owner'),'BG');
  assert.equal(await game.getAttribute('data-glass-viewed'),'WB');
  await page.locator('.adjust-controls [data-delta="1"]').click(); assert.equal(await page.locator('#mainValue').textContent(),'2');
  await page.locator('[data-seat="P1"]').click();await page.locator('[data-mode="life"]').click();
  assert.equal(await page.locator('#mainValue').textContent(),'41');
  await page.locator('#endTurnButton').click();
  await page.waitForFunction(()=>document.querySelector('.pod-seat.turn-active')?.dataset.seat==='P2');
  for (const seat of ['P2','P3','P4']) {
    await page.locator('[data-seat="'+seat+'"]').click();
    await page.locator('#customLifeButton').click();
    const custom=page.locator('#customLifeDialog');
    await custom.getByLabel('Amount').fill('40');
    await custom.getByText('Subtract −X').click();
    await custom.getByRole('button',{name:'Apply life change'}).click();
  }
  await page.clock.fastForward(17000);
  await page.waitForFunction(()=>!document.querySelector('#victoryNotice').hidden);
  assert.ok(await page.locator('#victoryDialog').isHidden());
  await menu.click();await options.getByRole('button',{name:'Restart practice'}).click();
  await page.waitForFunction(()=>document.querySelector('#mainValue').textContent==='40' && document.querySelector('#gameView').dataset.interfaceStyle==='dial');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('fivefold-arc:developer-key')),null);
  assert.deepEqual(await page.evaluate(()=>window.practiceWrites),[]);
  assert.equal(await page.locator('#gameMenu').isVisible(),false);
  // Playwright's virtual clocks are shared by pages in the same context.
  const expiryPage=await browser.newPage({viewport:{width:390,height:844}});
  await expiryPage.route('**/*',allowPracticeRequest);
  await expiryPage.clock.install();await expiryPage.goto(ticket.url);
  await expiryPage.getByRole('button',{name:'Practice options'}).waitFor();
  await expiryPage.clock.fastForward('01:00:10');
  await expiryPage.waitForFunction(()=>document.documentElement.dataset.releasePractice==='closed');
  assert.match(await expiryPage.locator('.practice-notice').textContent(),/expired/i);
  await expiryPage.close();await page.bringToFront();
  const statusResponse = code => page.waitForResponse(r=>new URL(r.url()).pathname===ticketPath+'/status' && r.status()===code);
  await Promise.all([statusResponse(200),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);
  statusUnavailable=true;
  await Promise.all([statusResponse(503),page.clock.fastForward(12_000)]);
  await tapPlus();
  assert.equal(await page.locator('#mainValue').textContent(),'41');
  await menu.click();
  await page.clock.fastForward(21_000);
  await page.waitForFunction(()=>document.documentElement.dataset.releasePractice==='paused');
  assert.ok(await page.locator('main').isHidden());
  assert.ok(await options.isHidden());
  assert.match(await page.locator('.practice-notice').textContent(),/reconnect/i);
  statusUnavailable=false;
  await Promise.all([statusResponse(200),page.evaluate(()=>window.dispatchEvent(new Event('online')))]);
  await menu.waitFor();
  assert.equal(await page.locator('#mainValue').textContent(),'41');
  // A suspended phone can return without running a single interval.
  statusUnavailable=true;
  await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now()+31_000)));
  await Promise.all([statusResponse(503),page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))]);
  await page.waitForFunction(()=>document.documentElement.dataset.releasePractice==='paused');
  statusUnavailable=false;
  await page.clock.fastForward(11_000);
  await menu.waitFor();
  assert.equal(await page.locator('#mainValue').textContent(),'41');
  assert.equal(artworkFetches,2,'heartbeat and recovery do not reload the artwork');
  const stop=await request('stop-playtest',{ticket:ticket.ticket}); assert.equal(stop.status,200);
  await page.clock.fastForward(11_000);
  await page.waitForFunction(()=>document.documentElement.dataset.releasePractice==='closed');
  assert.match(await page.locator('.practice-notice').textContent(),/ended/i);
  assert.ok(await page.locator('main').isHidden());
  await page.goto(ticket.url);await page.waitForFunction(()=>document.documentElement.dataset.releasePractice==='closed');
  assert.ok(await page.locator('main').isHidden());
  assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
  console.log(engine+' passed local gameplay, owner/partner colors, both layouts, brief offline play, outage pause and recovery, open-phone revocation, expiry and account/network/storage isolation.');
} finally {
  await request('stop-playtest',{ticket:ticket.ticket});
  await browser.close();
}
