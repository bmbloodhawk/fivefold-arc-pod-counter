// Exact-renderer checks against the disposable loopback Studio, never a live service.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const target = new URL(process.argv[2] || 'http://127.0.0.1:8787/review');
assert.equal(target.hostname,'127.0.0.1');
assert.equal((await fetch(target)).headers.get('x-studio-fixture'),'memory','Use a disposable in-memory Studio for this regression.');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json',import.meta.url));
const playwright = require('playwright-core');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const directory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(),'appearance-studio-renderer-20261123',engine));
await mkdir(directory,{recursive:true});
const browser = await playwright[engine].launch(engine === 'chromium' ? {headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'} : {headless:true});
const errors = [], writes = [], report = {engine,fixtures:[],devices:[],modes:[],players:[]};
const observe = page => {
  page.on('pageerror',error => errors.push(error.message));
  page.on('request',request => {if (!['GET','HEAD'].includes(request.method())) writes.push({method:request.method(),path:new URL(request.url()).pathname});});
};
const makeContext = async () => {
  const context = await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  await context.route('**/*',route => new URL(route.request().url()).origin === target.origin ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.rendererStorageAudit=[];
    for (const method of ['setItem','removeItem','clear']) {
      const original=Storage.prototype[method];
      Storage.prototype[method]=function(...args){window.rendererStorageAudit.push({method,key:args[0]});return original.apply(this,args);};
    }
  });
  return context;
};
const metrics = () => ({
  variables:Object.fromEntries([...document.documentElement.style].filter(key=>key.startsWith('--')).sort().map(key=>[key,document.documentElement.style.getPropertyValue(key)])),
  labels:[...document.querySelectorAll('.mode-nav button')].map(node=>({label:node.getAttribute('aria-label'),text:node.querySelector('small').textContent})),
  geometry:Object.fromEntries(['.dial-assembly','.main-value','.mode-nav','.adjust-controls','#endTurnButton'].map(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return[selector,{x:box.x,y:box.y,width:box.width,height:box.height}];})),
  background:getComputedStyle(document.querySelector('#endTurnButton')).backgroundColor,
  focus:document.documentElement.style.getPropertyValue('--focus-ring'),
});
const settleDocument = async () => {await document.fonts.ready;await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getTiming().iterations)).map(animation=>animation.finished.catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
const settle = async page => {await page.bringToFront();await page.evaluate(settleDocument);};

try {
  const context = await makeContext(), page = await context.newPage(); observe(page);
  page.on('dialog',dialog=>dialog.message().startsWith('Discard ') ? dialog.accept() : dialog.dismiss());
  await page.goto(target.href,{waitUntil:'domcontentloaded'});
  const frame = () => page.frames().find(item => new URL(item.url()).searchParams.get('appearance-preview') === '1');
  await page.waitForFunction(() => document.querySelector('#exactPreview')?.contentDocument?.documentElement.dataset.previewFixture === 'turn');
  for (const scene of ['lobby','turn','other','damage','offline','status','dialog','error','menu','radiationDialog','commanderDialog','eliminated','longLabels','end','turn']) {
    await page.locator('#studioScene').selectOption(scene);
    await page.waitForFunction(value => document.querySelector('#exactPreview').contentDocument.documentElement.dataset.previewFixture === value,scene);
    const actual = await frame().evaluate(() => ({scene:document.documentElement.dataset.previewFixture,mode:document.querySelector('#modeTitle').textContent,life:document.querySelector('#mainValue').value,lobby:!document.querySelector('#lobbyView').hidden,dialogs:[...document.querySelectorAll('dialog[open]')].map(node=>node.id),disabled:document.querySelector('#endTurnButton').disabled,controlsHidden:document.querySelector('#adjustControls').hidden,dialDisabled:document.querySelector('#dialGesture').getAttribute('aria-disabled')}));
    if (scene === 'lobby') assert.equal(actual.lobby,true);
    if (scene === 'damage') {assert.equal(actual.mode,'COMMANDER');assert.equal(actual.life,'0');}
    if (scene === 'offline') {assert.equal(actual.disabled,true);assert.equal(actual.dialDisabled,'true');}
    if (scene === 'dialog') assert.ok(actual.dialogs.includes('customLifeDialog'));
    if (scene === 'error') assert.ok(actual.dialogs.includes('connectionDialog'));
    if (scene === 'end') {assert.ok(actual.dialogs.includes('victoryDialog'));assert.equal(actual.controlsHidden,true);}
    if (scene === 'menu') assert.equal(await frame().locator('#gameMenu').isVisible(),true);
    if (scene === 'radiationDialog') assert.ok(actual.dialogs.includes('radiationDialog'));
    if (scene === 'commanderDialog') assert.ok(actual.dialogs.includes('commanderSourceDialog'));
    if (scene === 'eliminated') assert.equal(await frame().locator('#lethalMark').isVisible(),true);
    if (scene === 'longLabels') assert.equal(actual.life,'1040');
    report.fixtures.push(actual);
  }
  await page.getByText('Preview settings',{exact:true}).click();
  for (const players of [2,3,4,5,6,7,8]) {
    await page.locator(`[data-preview-players="${players}"]`).click();
    await page.waitForFunction(value => Number(document.querySelector('#exactPreview').contentDocument.documentElement.dataset.previewPlayers) === value,players);
    report.players.push(players);
  }
  for (const mode of ['life','commander','radiation','poison','energy','generic']) {
    await page.locator(`[data-preview-mode="${mode}"]`).click();
    await page.waitForFunction(value => document.querySelector('#exactPreview').contentDocument.documentElement.dataset.previewMode === value,mode);
    report.modes.push(mode);
  }
  const timeOrigin = await frame().evaluate(()=>performance.timeOrigin);
  for (const device of [{id:'iphone-se-3',width:375,height:667},{id:'iphone-16',width:393,height:852},{id:'iphone-16-pro-max',width:440,height:956},{id:'ipad-mini',width:744,height:1133},{id:'desktop-game',width:860,height:900}]) {
    await page.locator('#devicePreset').selectOption(device.id);
    await page.waitForFunction(size => {const root=document.querySelector('#exactPreview').contentDocument.documentElement;return root.clientWidth===size.width&&root.clientHeight===size.height;},device);
    assert.equal(await frame().evaluate(()=>performance.timeOrigin),timeOrigin,'Changing device preserves the loaded real renderer.');
    report.devices.push(device);
  }
  await page.locator('#devicePreset').selectOption('iphone-16');
  await page.locator('[data-preview-players="4"]').click();
  await page.locator('[data-preview-mode="life"]').click();
  await page.getByText('Preview settings',{exact:true}).click();
  await page.locator('#workspaceReview').click();
  await page.locator('#runPreflightButton').click();
  await page.waitForFunction(()=>!document.querySelector('#runPreflightButton').disabled,undefined,{timeout:90000});
  report.preflight={summary:await page.locator('#preflightSummary').textContent(),screens:await page.locator('#preflightList li').count(),failures:await page.locator('#preflightList .fail').count()};
  assert.equal(report.preflight.screens,200);assert.equal(report.preflight.failures,0);
  report.previewStorageWrites=await frame().evaluate(()=>window.rendererStorageAudit);
  assert.deepEqual(report.previewStorageWrites,[]);
  assert.deepEqual(writes,[],'Fixture, device, mode and preflight controls perform no API writes.');
  await page.getByRole('button',{name:'Colors & mood',exact:true}).click();
  await page.screenshot({path:resolve(directory,'desktop1280.png'),scale:'css'});

  // Only this disposable context gets the developer demo flag. All game input
  // uses real UI; no account is restored or real room allocated.
  const normal=await context.newPage();observe(normal);
  await normal.setViewportSize({width:393,height:852});
  await normal.addInitScript(()=>{sessionStorage.setItem('fivefold-arc:developer-mode','on');localStorage.setItem('fivefold-arc:interface-style','button');});
  await normal.goto(new URL('/index.html',target).href,{waitUntil:'domcontentloaded'});
  await normal.locator('#quickTestButton').click();await normal.locator('#startGameButton').click();
  // Released local-demo Start does not switch views. Reopen the persisted local
  // demo through its real entry point; this unrelated flow is not modified.
  await normal.reload({waitUntil:'domcontentloaded'});await normal.locator('#quickTestButton').click();
  // Compare at a native 1:1 CSS-pixel scale; a transformed Fit frame rounds
  // text baselines differently in WebKit's compositor.
  await page.setViewportSize({width:1800,height:1160});
  await page.locator('#deviceZoom').selectOption('100');
  await page.waitForFunction(()=>{const iframe=document.querySelector('#exactPreview');return Math.abs(iframe.getBoundingClientRect().width-iframe.contentDocument.documentElement.clientWidth)<1;});
  report.parity={}; report.parityDifferences=[];
  const compare = async name => {
    async function readBoth() {
      await settle(normal);
      const game = await normal.evaluate(metrics);
      await settle(page);
      await frame().evaluate(settleDocument);
      return {game,studio:await frame().evaluate(metrics)};
    }
    const cold = await readBoth();
    const coldExact = isDeepStrictEqual(cold.game,cold.studio);
    let measured = cold;
    if (!coldExact) {
      // The released optical fitter measures asynchronous view changes. Retain
      // both cold measurements, then use an identical real viewport resize to
      // compare the fitted layouts after the entrance transition has finished.
      for (const width of [394,393]) {
        await normal.setViewportSize({width,height:852});
        await page.locator('#exactPreview').evaluate((iframe,value)=>{iframe.style.width=value+'px';},width);
        await frame().waitForFunction(value=>document.documentElement.clientWidth===value,width);
        await readBoth();
      }
      measured = await readBoth();
    }
    report.parity[name] = { ...measured,coldExact,...(!coldExact ? {cold} : {}) };
    await writeFile(resolve(directory,'PARITY.json'),JSON.stringify(report.parity,null,2));
    if (!isDeepStrictEqual(measured.studio,measured.game)) report.parityDifferences.push(name);
  };
  await compare('nativeButton');
  await page.locator('[data-skin="ember-library"]').click();
  await normal.locator('#moreButton').click();await normal.locator('#deviceAppearanceChoice').selectOption('ember-library');await normal.locator('#closeGameMenuButton').click();
  await normal.waitForFunction(()=>document.documentElement.dataset.gameSkin==='ember-library');
  await compare('approvedEmberButton');
  await normal.locator('#moreButton').click();await normal.locator('#toggleInterfaceStyleButton').click();await normal.locator('#closeGameMenuButton').click();
  // Legacy visual authoring stays disabled; send a named Dial review payload
  // from Studio's trusted parent window without modifying the catalog record.
  await page.evaluate(async()=>{const {skin}=await(await fetch('/api/game-skins/ember-library')).json();document.querySelector('#exactPreview').contentWindow.postMessage({type:'fivefold-arc:appearance-skin',skin:{...skin,interfaceStyle:'dial',previewState:'turn',previewMode:'life',previewPlayers:4,useGameBase:true}},location.origin);});
  await frame().waitForFunction(()=>document.querySelector('#gameView').dataset.interfaceStyle==='dial');
  await compare('approvedEmberDial');
  await normal.locator('#moreButton').click();await normal.locator('#deviceAppearanceChoice').selectOption('standard');await normal.locator('#closeGameMenuButton').click();
  await page.evaluate(()=>document.querySelector('#exactPreview').contentWindow.postMessage({type:'fivefold-arc:appearance-skin',skin:{id:'__neutral_arc__',interfaceStyle:'dial',useGameBase:true,previewState:'turn',previewMode:'life',previewPlayers:4}},location.origin));
  await frame().waitForFunction(()=>document.querySelector('#gameView').dataset.interfaceStyle==='dial'&&!document.documentElement.classList.contains('game-skin-active'));
  await compare('nativeDial');
  if (await page.locator('[data-skin="expanded-study"]').count()) {
    await page.locator('[data-skin="expanded-study"]').click();await page.getByRole('button',{name:'Game layout',exact:true}).click();await page.locator('#interfaceStyle').selectOption('dial');
    await normal.locator('#moreButton').click();await normal.locator('#deviceAppearanceChoice').selectOption('expanded-study');await normal.locator('#closeGameMenuButton').click();await normal.waitForFunction(()=>document.documentElement.dataset.gameSkin==='expanded-study');
    await compare('expandedDial');
    await normal.locator('#moreButton').click();await normal.locator('#toggleInterfaceStyleButton').click();await normal.locator('#closeGameMenuButton').click();await page.locator('#interfaceStyle').selectOption('button');
    await compare('expandedButton');
  }
  await writeFile(resolve(directory,'PARITY.json'),JSON.stringify(report.parity,null,2));
  if (await page.locator('[data-skin="inherited-placement"]').count()) {
    await page.locator('[data-skin="inherited-placement"]').click();if(await page.locator('#expandAppearanceControls').isVisible())await page.locator('#expandAppearanceControls').click();await page.getByRole('button',{name:'Game layout',exact:true}).click();
    await page.getByText('Place game regions',{exact:true}).click();await page.locator('#componentPlacementControls summary').filter({hasText:'End turn area'}).click();
    const slider=page.locator('[data-placement="turnActions"][data-placement-field="x"]');
    report.inherited={note:await page.locator('#componentPlacementControls .helper').filter({hasText:'Inherited placement:'}).textContent(),min:await slider.getAttribute('min'),max:await slider.getAttribute('max'),rendered:await frame().evaluate(()=>document.documentElement.style.getPropertyValue('--skin-turn-actions-x'))};
    assert.equal(report.inherited.min,'-32');assert.equal(report.inherited.max,'32');assert.equal(report.inherited.rendered,'100px');
    await page.locator('[data-placement-reset="turnActions"]').click();
    await frame().waitForFunction(()=>document.documentElement.style.getPropertyValue('--skin-turn-actions-x')==='0px');
    assert.equal(await page.locator('[data-placement="turnActions"][data-placement-field="scale"]').inputValue(),'100');
  }

  const recoveryContext=await makeContext(), recovery=await recoveryContext.newPage();observe(recovery);
  await recovery.route(/\/index\.html\?appearance-preview=1$/,route=>route.abort('blockedbyclient'));
  await recovery.goto(target.href,{waitUntil:'domcontentloaded'});
  await recovery.locator('#exactPreviewRecovery').waitFor({state:'visible'});
  const popupPromise=recovery.waitForEvent('popup');
  await recovery.locator('#openExactPreviewButton').click();
  const external=await popupPromise;observe(external);
  await external.waitForURL(url=>url.origin===target.origin&&url.searchParams.get('phone-layout'));
  await external.waitForFunction(()=>!document.querySelector('#gameView').hidden);
  await recovery.locator('[data-skin="harbor-study"]').click();
  if(await recovery.locator('#expandAppearanceControls').isVisible())await recovery.locator('#expandAppearanceControls').click();
  await recovery.locator('#background').fill('#102938');
  await external.waitForFunction(()=>document.documentElement.style.getPropertyValue('--bg')==='#102938');
  report.recovery={sameOrigin:new URL(external.url()).origin===target.origin,scheme:new URL(external.url()).protocol,liveColor:await external.evaluate(()=>document.documentElement.style.getPropertyValue('--bg')),previewStorageWrites:await external.evaluate(()=>window.rendererStorageAudit)};
  await external.locator('[data-phone-layout-field="lifeNumberScale"]').press('ArrowRight');await recovery.bringToFront();
  await recovery.waitForFunction(()=>document.querySelector('#lifeNumberScale').value==='105');
  report.recovery.phoneToStudioScale=await recovery.locator('#lifeNumberScale').inputValue();
  assert.deepEqual(report.recovery.previewStorageWrites,[]);
  assert.equal(writes.filter(item=>!item.path.startsWith('/api/appearance-studio/phone-layout')).length,0);
  assert.deepEqual(errors,[]);
  report.errors=errors;report.writes=writes.map(item=>({...item,path:item.path.split('/').slice(0,4).join('/')}));
  report.limits='Browser viewports and the local renderer only; no physical phone, production, live multiplayer or touch usability certification.';
  await writeFile(resolve(directory,'REPORT.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({fixtures:report.fixtures.length,devices:report.devices.length,modes:report.modes.length,players:report.players,preflight:report.preflight,recovery:report.recovery,errors,report:resolve(directory,'REPORT.json')},null,2));
  assert.deepEqual(report.parityDifferences,[],'Exact normal-game versus Studio measurements differ. See PARITY.json for both measurements.');
} finally {await browser.close();}
