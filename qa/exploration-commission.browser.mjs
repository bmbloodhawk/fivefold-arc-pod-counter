// Disposable loopback renderer fixture. Uses the shipped app/profile/Studio UI;
// account replies and authentication are isolated test presets, never live data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';

const engine = process.env.STUDIO_BROWSER || 'chromium';
const directory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(), 'exploration-commission-renderer', engine));
await mkdir(directory, {recursive:true});
const key = 'loopback-exploration-fixture';
const originalCatalog = {schemaVersion:1,selected:'__neutral_arc__',assets:[],skins:[{
  id:'skin-exploration-test-preset',name:'Exploration local test preset',status:'Draft',rendererVersion:2,
  background:'#081a23',surface:'#143341',accent:'#95ded3',secondary:'#68a6b7',text:'#effaf8',muted:'#c1d8dc',
}]};
let catalog = structuredClone(originalCatalog);
const {server} = createRealtimeServer({appEnv:'test',staticDir:fileURLToPath(new URL('../client/',import.meta.url)),
  feedbackPortalKey:key,durableRecoveryEnabled:false,autoRecoverRooms:false,
  appearanceCatalog:{read:async()=>structuredClone(catalog),write:async value=>(catalog=structuredClone(value)),
    readAsset:async()=>null,writeAsset:async()=>{throw new Error('No fixture assets');},deleteAsset:async()=>{}},
  fetchImpl:async()=>{throw new Error('No external fixture connection');},lookupCommanderIdentity:async()=>null,
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json',import.meta.url));
const browser = await require('playwright-core')[engine].launch({headless:true,...(engine === 'chromium'
  ? {executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'} : {})});
const errors = [], writes = [], results = [];
const empty = {startedAt:null,timeZone:null,earnedAt:null,commanderVariety:0,recordedTurns:0,playDates:0};
try {
  for (const viewport of [{width:320,height:700},{width:393,height:852}]) {
    let mission = structuredClone(empty);
    const context = await browser.newContext({viewport,timezoneId:'America/Los_Angeles',serviceWorkers:'block'});
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if (!['GET','HEAD'].includes(request.method())) writes.push(new URL(request.url()).pathname);});
    const routeFixture = async route=>{
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const json = data=>route.fulfill({json:data});
      if (url.pathname === '/account-auth.js') return route.fulfill({contentType:'text/javascript',body:
        `export const currentAccountToken=async()=> 'local-fixture',restoredAccountToken=currentAccountToken,
        googleAccountToken=currentAccountToken,emailAccountToken=currentAccountToken,
        signOutAccount=async()=>{},sendAccountPasswordReset=async()=>{},validateAccountPassword=async()=>({isValid:true});`});
      if (url.pathname === '/api/account/history') return json({history:{wins:0,gamesPlayed:0,winRate:0,games:[],
        achievements:[],milestones:[],thisMonth:{wins:0,gamesPlayed:0},explorationCommission:mission}});
      if (url.pathname === '/api/account/preferences') return json({preferences:{preferredName:null,defaultPlayerCount:4,
        interfaceStyle:'dial',usePersonalSkin:false,personalSkinId:null},skins:[]});
      if (url.pathname === '/api/account/decks') return json({decks:[]});
      if (url.pathname === '/api/account/appearance-catch-up') return json({notice:null});
      if (url.pathname === '/api/account/missions/exploration-commission/start') {
        assert.equal(route.request().method(),'POST');
        assert.deepEqual(route.request().postDataJSON(),{timeZone:'America/Los_Angeles'});
        mission = {...mission,startedAt:1795800000000,timeZone:'America/Los_Angeles'};
        return json({mission});
      }
      return route.continue();
    };
    await context.route('**/*',routeFixture);
    async function profile(target = page) {
      await target.goto(origin);
      await target.locator('#myGamesButton:not([disabled])').waitFor();
      await target.locator('#myGamesButton').click();
      await target.locator('[data-profile-tab="1"]').click();
      await target.locator('.exploration-commission').waitFor();
      await target.evaluate(()=>document.fonts.ready);
    }
    await profile();
    const panel = page.locator('.exploration-commission');
    assert.deepEqual(await panel.locator('progress').evaluateAll(nodes=>nodes.map(node=>[node.value,node.max])),[[0,2],[0,25],[0,3]]);
    const begin = panel.locator('[data-begin-exploration]');
    await begin.scrollIntoViewIfNeeded();
    assert.ok((await begin.boundingBox()).height >= 48);
    await page.screenshot({path:resolve(directory,`${viewport.width}-begin.png`)});
    await begin.focus(); await page.keyboard.press('Enter');
    await panel.getByRole('status').filter({hasText:'Mission begun'}).waitFor();
    assert.match(await panel.innerText(),/America\/Los_Angeles/);
    mission = {...mission,commanderVariety:1,recordedTurns:17,playDates:2};
    await profile();
    assert.deepEqual(await panel.locator('progress').evaluateAll(nodes=>nodes.map(node=>[node.value,node.max])),[[1,2],[17,25],[2,3]]);
    await panel.scrollIntoViewIfNeeded();
    const bounds = await panel.evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth,
      dialog:document.querySelector('#myGamesDialog').getBoundingClientRect().width,viewport:innerWidth}));
    assert.ok(bounds.scroll <= bounds.width + 1, 'Mission fits its profile panel');
    assert.ok(bounds.dialog <= bounds.viewport, 'Profile dialog fits viewport');
    await page.screenshot({path:resolve(directory,`${viewport.width}-progress.png`)});
    await panel.locator('summary').click();
    assert.equal(await panel.locator('details').getAttribute('open'),'');
    await panel.locator('details p').last().scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(directory,`${viewport.width}-rules.png`)});
    const changedZoneContext = await browser.newContext({viewport,timezoneId:'Pacific/Auckland',serviceWorkers:'block'});
    await changedZoneContext.route('**/*',routeFixture);
    const changedZonePage = await changedZoneContext.newPage();
    changedZonePage.on('pageerror',error=>errors.push(error.message));
    await profile(changedZonePage);
    assert.equal(await changedZonePage.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone),'Pacific/Auckland');
    const retainedPanel = changedZonePage.locator('.exploration-commission');
    assert.match(await retainedPanel.innerText(),/Play dates stay in America\/Los_Angeles/);
    assert.doesNotMatch(await retainedPanel.innerText(),/Pacific\/Auckland/);
    assert.deepEqual(await retainedPanel.locator('progress').evaluateAll(nodes=>nodes.map(node=>[node.value,node.max])),[[1,2],[17,25],[2,3]]);
    assert.equal(await retainedPanel.locator('[data-begin-exploration]').count(),0);
    await retainedPanel.scrollIntoViewIfNeeded();
    await changedZonePage.screenshot({path:resolve(directory,`${viewport.width}-retained-timezone.png`)});
    await changedZoneContext.close();
    mission = {...mission,commanderVariety:2,recordedTurns:25,playDates:3,earnedAt:1796000000000};
    await profile();
    assert.match(await panel.getByRole('status').innerText(),/permanently earned/);
    assert.equal(await panel.locator('[data-begin-exploration]').count(),0);
    results.push({viewport,progress:[[1,2],[17,25],[2,3]],bounds,beginViaKeyboard:true,earnedState:true,
      retainedTimeZone:'America/Los_Angeles',changedDeviceTimeZone:'Pacific/Auckland'});
    await context.close();
  }
  // The actual Studio editor loads the server catalog and changes only an unsaved
  // fixture draft. No publish, save, asset, or release operation is invoked.
  const studio = await browser.newPage({viewport:{width:1366,height:900},serviceWorkers:'block'});
  studio.on('pageerror',error=>errors.push(error.message));
  await studio.addInitScript(value=>sessionStorage.setItem('fivefold-arc:developer-key',value),key);
  await studio.route('**/*',route=>new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await studio.goto(origin + '/appearance-studio.html');
  await studio.locator('[data-skin="skin-exploration-test-preset"]').click();
  await studio.locator('[aria-controls="edit-review"]').click();
  const reward = studio.locator('#studioRewardEditor');
  await reward.locator('#rewardSearch').fill('Exploration Commission');
  await reward.locator('#rewardAchievement option[value="exploration-commission"]').waitFor({state:'attached'});
  await reward.locator('#rewardAchievement').selectOption('exploration-commission');
  await reward.locator('#addRewardAchievement').click();
  assert.match(await reward.locator('[data-reward-steps]').innerText(),/Exploration Commission/);
  await reward.locator('details summary').click();
  await reward.locator('[data-test-steps] input').check();
  assert.match(await reward.locator('[data-player-preview]').innerText(),/1 of 1 achievements earned · Unlocked/);
  await studio.screenshot({path:resolve(directory,'studio-reward-preset.png')});
  assert.deepEqual(catalog,originalCatalog,'Studio selection never saved or changed the sample catalog');
  assert.deepEqual(errors,[]);
  assert.ok(writes.every(path=>path === '/api/account/missions/exploration-commission/start'));
  const report = {passed:true,engine,results,studioSelector:true,unsavedPresetOnly:true,errors,writes,
    limits:['Browser viewport emulation and isolated account replies; no physical-device evidence.',
      'This checks the actual client renderer and Studio controls; backend mission/reward behavior is covered separately.']};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,engine,report:resolve(directory,'report.json')}));
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
