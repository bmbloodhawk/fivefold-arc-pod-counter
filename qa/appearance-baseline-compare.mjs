// Compare native controls with a separately served, read-only release archive.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const current=new URL(process.argv[2]||'http://127.0.0.1:8787/'),baseline=new URL(process.argv[3]||'http://127.0.0.1:8791/');
for(const url of [current,baseline])assert.equal(url.hostname,'127.0.0.1');
const require=createRequire(process.env.PLAYWRIGHT_TOOLING||new URL('./package.json',import.meta.url));
const {chromium}=require('playwright-core');
const directory=resolve(process.env.STUDIO_REPORT_DIR||resolve(tmpdir(),'appearance-release-comparison-20261123'));
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[],writes=[],report={baselineCommit:'74a5c88b',current:{},baseline:{}};
const globalLayout={modeLayouts:{button:{componentLayout:{counterReadout:{x:4,y:2,scale:100}}},dial:{componentLayout:{counterReadout:{x:-4,y:3,scale:100}}}}};
report.globalLayout=globalLayout;
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const synthetic={id:'legacy-synthetic',name:'Synthetic legacy renderer fixture',status:'Approved',background:'#1c1015',surface:'#35202b',accent:'#ffb88a',secondary:'#ae6375',text:'#fff0e6',muted:'#dec7c6',seatRadius:14,buttonRadius:10,seatOpacity:88,seatBlur:2,seatBorder:65,buttonOpacity:92,buttonBlur:1,buttonBorder:72,symbolData:{radiation:pixel},symbolScale:{radiation:80},overlayData:{counter:pixel,dial:pixel},overlayOpacity:{counter:15,dial:25},overlayScale:{counter:90,dial:100},overlayBlend:{counter:'screen',dial:'normal'},dialArtSpin:true,modeLayouts:{button:{componentLayout:{counterReadout:{x:6,y:-4,scale:105}}},dial:{componentLayout:{counterReadout:{x:-4,y:6,scale:95}}}}};
const read=()=>{
  const context=document.createElement('canvas').getContext('2d');
  const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return[...context.getImageData(0,0,1,1).data];};
  return {labels:[...document.querySelectorAll('.mode-nav button')].map(node=>({label:node.getAttribute('aria-label'),text:node.querySelector('small').textContent})),nodes:Object.fromEntries(['.dial-assembly','.main-value','.mode-nav','.adjust-controls','#endTurnButton'].map(selector=>{const node=document.querySelector(selector),r=node.getBoundingClientRect(),s=getComputedStyle(node);return[selector,{rect:{x:r.x,y:r.y,width:r.width,height:r.height},font:{family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,lineHeight:s.lineHeight},background:rgba(s.backgroundColor),color:rgba(s.color)}];})),assets:{icons:[...document.querySelectorAll('.mode-nav button')].map(node=>node.innerHTML),overlays:[...document.querySelectorAll('.skin-overlay')].map(node=>({className:node.className,style:node.style.cssText,parent:node.parentElement.className})),seal:document.querySelector('.counter-sigil').innerHTML},focus:document.documentElement.style.getPropertyValue('--focus-ring')};
};
const settle=async page=>{await page.bringToFront();await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});};
try{
  for(const [name,url] of [['baseline',baseline],['current',current]]){
    const context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===url.origin?route.continue():route.abort());
    await context.route('**/api/game-layout',route=>route.fulfill({json:{layout:globalLayout}}));
    // Synthetic response fixtures exercise the real old/new renderers without
    // adding records, granting access, or publishing into either catalog.
    await context.route('**/api/game-skins**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/game-skins/legacy-synthetic')return route.fulfill({json:{skin:synthetic}});
      if(path==='/api/game-skins'){const response=await route.fetch();const body=await response.json();body.skins.push({id:synthetic.id,name:synthetic.name});return route.fulfill({response,json:body});}
      return route.continue();
    });
    await context.addInitScript(()=>{sessionStorage.setItem('fivefold-arc:developer-mode','on');localStorage.setItem('fivefold-arc:interface-style','button');localStorage.setItem('fivefold-arc:device-appearance','standard');});
    const page=await context.newPage();page.on('pageerror',e=>errors.push({name,error:e.message}));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push({name,method:r.method(),path:new URL(r.url()).pathname});});
    await page.goto(new URL('/index.html',url).href,{waitUntil:'domcontentloaded'});
    await page.locator('#quickTestButton').click();await page.locator('#startGameButton').click();await page.reload({waitUntil:'domcontentloaded'});await page.locator('#quickTestButton').click();
    await settle(page);report[name].nativeButton=await page.evaluate(read);
    await page.locator('#moreButton').click();await page.locator('#toggleInterfaceStyleButton').click();await page.locator('#closeGameMenuButton').click();
    await settle(page);report[name].nativeDial=await page.evaluate(read);
    await page.locator('#moreButton').click();await page.locator('#deviceAppearanceChoice').selectOption('ember-library');await page.locator('#closeGameMenuButton').click();await page.waitForFunction(()=>document.documentElement.dataset.gameSkin==='ember-library');
    await settle(page);report[name].legacyEmberDial=await page.evaluate(read);
    await page.locator('#moreButton').click();await page.locator('#toggleInterfaceStyleButton').click();await page.locator('#closeGameMenuButton').click();
    await settle(page);report[name].legacyEmberButton=await page.evaluate(read);
    await page.screenshot({path:resolve(directory,`${name}-ember-button.png`),scale:'css'});
    await page.locator('#moreButton').click();await page.locator('#deviceAppearanceChoice').selectOption('legacy-synthetic');await page.locator('#closeGameMenuButton').click();await page.waitForFunction(()=>document.documentElement.dataset.gameSkin==='legacy-synthetic');
    await settle(page);report[name].syntheticButton=await page.evaluate(read);
    await page.locator('#moreButton').click();await page.locator('#toggleInterfaceStyleButton').click();await page.locator('#closeGameMenuButton').click();
    await settle(page);report[name].syntheticSwitchedDial=await page.evaluate(read);
    await page.locator('#moreButton').click();await page.locator('#deviceAppearanceChoice').selectOption('standard');await page.locator('#closeGameMenuButton').click();await page.waitForFunction(()=>!document.documentElement.classList.contains('game-skin-active'));
    await page.locator('#moreButton').click();await page.locator('#deviceAppearanceChoice').selectOption('legacy-synthetic');await page.locator('#closeGameMenuButton').click();await page.waitForFunction(()=>document.documentElement.dataset.gameSkin==='legacy-synthetic');
    await settle(page);report[name].syntheticDial=await page.evaluate(read);
    await context.close();
  }
  assert.deepEqual(report.current.nativeButton,report.baseline.nativeButton,'Released native Button controls, labels and styles stay identical.');
  assert.deepEqual(report.current.nativeDial,report.baseline.nativeDial,'Released native Dial controls, labels and styles stay identical.');
  assert.deepEqual(report.current.syntheticButton,report.baseline.syntheticButton,'Legacy Button geometry, asset DOM and scale remain identical.');
  assert.deepEqual(report.current.syntheticSwitchedDial,report.baseline.syntheticSwitchedDial,'The released legacy mode-transition placement remains identical.');
  assert.deepEqual(report.current.syntheticDial,report.baseline.syntheticDial,'Legacy Dial geometry, asset DOM and scale remain identical.');
  report.legacyDifferences={};
  for(const mode of ['legacyEmberButton','legacyEmberDial'])report.legacyDifferences[mode]=Object.fromEntries(Object.entries(report.current[mode].nodes).map(([selector,value])=>[selector,Object.fromEntries(Object.entries(value).filter(([key,currentValue])=>JSON.stringify(currentValue)!==JSON.stringify(report.baseline[mode].nodes[selector][key])).map(([key,currentValue])=>[key,{before:report.baseline[mode].nodes[selector][key],after:currentValue}]))]).filter(([,value])=>Object.keys(value).length));
  assert.deepEqual(report.current.legacyEmberButton,report.baseline.legacyEmberButton);
  assert.deepEqual(report.current.legacyEmberDial,report.baseline.legacyEmberDial);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  report.errors=errors;report.writes=writes;report.limits='393 × 852 Chromium with fixed local fixtures. Equality covers measured control rects, font styles, normalized colors, accessible labels, native/custom icon markup and overlay attributes. Full screenshot pixel identity and physical-device behavior are not established.';
  await writeFile(resolve(directory,'REPORT.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({nativeButton:'identical',nativeDial:'identical',legacyDifferences:report.legacyDifferences,errors,writes,report:resolve(directory,'REPORT.json')},null,2));
}finally{await browser.close();}
