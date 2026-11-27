// Disposable loopback fixtures only. No save/publish, account or room API writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const target=new URL(process.argv[2]);assert.equal(target.hostname,'127.0.0.1');
const require=createRequire(process.env.PLAYWRIGHT_TOOLING?resolve(process.env.PLAYWRIGHT_TOOLING):new URL('../package.json',import.meta.url));
const engine=process.env.STUDIO_BROWSER || 'chromium';
const driver=require('playwright-core')[engine];
const directory=process.env.STUDIO_REPORT_DIR?resolve(process.env.STUDIO_REPORT_DIR):fileURLToPath(new URL('../.local/qa/counter-design/',import.meta.url));
await mkdir(directory,{recursive:true});
const browser=await driver.launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const report={comparisons:[],errors:[],writes:[]};
const settle=async page=>{await page.bringToFront();await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});};
const inspect=()=>{
  const game=document.querySelector('#gameView');
  return {mode:game.dataset.counterMode,face:game.dataset.counterFace,markings:game.dataset.counterMarkings,seal:game.dataset.counterSeal,
    readoutColor:getComputedStyle(document.querySelector('.main-value')).color,
    faceColor:document.querySelector('.counter-design-face')?getComputedStyle(document.querySelector('.counter-design-face')).backgroundColor:null,
    background:document.querySelector('.counter-design-face')?getComputedStyle(document.querySelector('.counter-design-face')).backgroundImage:null,
    art:[...document.querySelectorAll('.counter-design-face img')].map(node=>({src:node.src,opacity:getComputedStyle(node).opacity})),
    emblem:document.querySelector('.counter-design-emblem')?.innerHTML||'',
    nav:[...document.querySelectorAll('.mode-nav button')].map(node=>({label:node.getAttribute('aria-label'),svg:Boolean(node.querySelector('svg')),text:node.querySelector('small').textContent})),
    targets:Object.fromEntries(['#endTurnButton','.mode-nav','.dial-assembly'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return[selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})),
  };
};
try {
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===target.origin?route.continue():route.abort());
  await context.addInitScript(()=>{window.counterStorageWrites=[];for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(new URL(location.href).searchParams.has('appearance-preview'))window.counterStorageWrites.push({method,key:args[0]});return original.apply(this,args);};}});
  const observe=page=>{page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))report.writes.push({method:r.method(),path:new URL(r.url()).pathname});});};
  const page=await context.newPage();observe(page);
  page.on('dialog',dialog=>dialog.message().startsWith('Discard ')?dialog.accept():dialog.dismiss());
  await page.goto(target.href,{waitUntil:'domcontentloaded'});
  await page.locator('[data-skin="counter-design-study"]').waitFor();
  const frame=()=>page.frames().find(item=>item.url().includes('appearance-preview=1'));
  await page.waitForFunction(()=>document.querySelector('#exactPreview')?.contentDocument?.querySelector('#gameView')?.hidden===false);
  const catalog=()=>page.evaluate(async()=>await(await fetch('/api/appearance-studio/catalog',{headers:{'x-feedback-portal-key':sessionStorage.getItem('fivefold-arc:developer-key')}})).text());
  const before=await catalog();

  await page.locator('#newSkinButton').click();
  await frame().waitForFunction(()=>Boolean(document.querySelector('[data-mode="radiation"] svg')));
  report.newDraft={nativeIcons:await frame().locator('.mode-nav button svg').count(),decorations:await frame().locator('.counter-design-face').count()};
  assert.equal(report.newDraft.nativeIcons,6);assert.equal(report.newDraft.decorations,0);
  await page.locator('#studioNavigation button[aria-controls="edit-symbols"]').click();
  const tabSet=page.locator('select[data-tab-icon-set]');
  const waitForTab = (mode,file) => frame().waitForFunction(([mode,file])=>{
    const icon=document.querySelector('[data-mode="'+mode+'"] svg');
    return icon && getComputedStyle(icon).maskImage.includes(file);
  },[mode,file]);
  assert.equal(await tabSet.inputValue(),'auto');
  await tabSet.selectOption('circuit');
  await waitForTab('life','tabs-circuit.svg');
  await page.locator('select[data-symbol="radiation"]').selectOption('☢');
  await frame().waitForFunction(()=>!document.querySelector('[data-mode="radiation"] svg'));
  await tabSet.selectOption('glass');
  await waitForTab('life','tabs-glass.svg');
  assert.equal(await frame().locator('[data-mode="radiation"] span').textContent(),'☢');
  await page.locator('select[data-symbol="radiation"]').selectOption('__native__');
  await waitForTab('radiation','tabs-glass.svg');
  await tabSet.selectOption('auto');
  await waitForTab('radiation','neutral-tab-radiation.svg');

  await page.locator('[data-skin="harbor-study"]').click();
  await frame().waitForFunction(()=>document.documentElement.dataset.gameSkin==='harbor-study');
  await waitForTab('radiation','neutral-tab-radiation.svg');
  report.existingV2WithoutAuthoredGlyphInheritsArt=true;
  await page.locator('[data-skin="ember-library"]').click();
  await frame().waitForFunction(()=>Boolean(document.querySelector('[data-mode="radiation"] svg')));
  await page.locator('#expandAppearanceControls').click();
  await frame().waitForFunction(()=>document.documentElement.dataset.rendererVersion==='2'&&Boolean(document.querySelector('[data-mode="radiation"] svg')));
  report.legacyUpgradeNative=true;

  const normal=await context.newPage();observe(normal);await normal.setViewportSize({width:393,height:852});
  await normal.addInitScript(()=>{sessionStorage.setItem('fivefold-arc:developer-mode','on');localStorage.setItem('fivefold-arc:interface-style','button');localStorage.setItem('fivefold-arc:device-appearance','standard');});
  await normal.goto(new URL('/index.html',target).href,{waitUntil:'domcontentloaded'});
  await normal.locator('#quickTestButton').click();await normal.locator('#startGameButton').click();await normal.reload({waitUntil:'domcontentloaded'});await normal.locator('#quickTestButton').click();
  await normal.locator('#moreButton').click();await normal.locator('#deviceAppearanceChoice').selectOption('counter-design-study');await normal.locator('#closeGameMenuButton').click();
  await normal.waitForFunction(()=>document.documentElement.dataset.gameSkin==='counter-design-study');
  await page.locator('[data-skin="counter-design-study"]').click();
  for(const style of ['button','dial']){
    if(style==='dial'){await normal.locator('#moreButton').click();await normal.locator('#toggleInterfaceStyleButton').click();await normal.locator('#closeGameMenuButton').click();}
    await page.getByRole('button',{name:'Game layout',exact:true}).click();await page.locator('#interfaceStyle').selectOption(style);
    await page.locator('#studioNavigation button[aria-controls="edit-symbols"]').click();
    for(const mode of ['life','commander','radiation','poison','energy','generic']){
      await normal.locator('[data-mode="'+mode+'"]').click();
      await page.locator('#counterDesignMode').selectOption(mode);
      await frame().waitForFunction(expected=>document.querySelector('#gameView').dataset.counterMode===expected,mode);
      await settle(normal);const game=await normal.evaluate(inspect);await settle(page);await frame().evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
      const studio=await frame().evaluate(inspect);assert.deepEqual(studio,game,style+' '+mode);
      if(mode==='radiation'){assert.equal(game.face,'radial');assert.equal(game.faceColor,'rgb(17, 32, 20)');assert.equal(game.readoutColor,'rgb(240, 255, 233)');assert.match(game.emblem,/<svg/);assert.equal(game.art.length,1);}
      if(mode==='poison')assert.equal(game.markings,'runes');
      await normal.locator('#moreButton').click();await normal.locator('#deviceAppearanceChoice').selectOption('counter-design-basis');await normal.locator('#closeGameMenuButton').click();
      await normal.waitForFunction(()=>document.documentElement.dataset.gameSkin==='counter-design-basis');await settle(normal);
      const basis=await normal.evaluate(inspect);assert.deepEqual(game.targets,basis.targets,'Decoration preserves '+style+' '+mode+' target geometry.');
      await normal.locator('#moreButton').click();await normal.locator('#deviceAppearanceChoice').selectOption('counter-design-study');await normal.locator('#closeGameMenuButton').click();await normal.waitForFunction(()=>document.documentElement.dataset.gameSkin==='counter-design-study');
      report.comparisons.push({style,mode,game,studio,basisTargets:basis.targets});
    }
  }
  await page.locator('#counterDesignMode').selectOption('radiation');
  await page.locator('[data-counter-field="captionBacking"]').selectOption('native');
  await frame().waitForFunction(()=>!document.querySelector('#gameView').dataset.counterCaptionBacking);
  const captionBefore=await frame().evaluate(()=>Object.fromEntries(['.counter-mode','.counter-context'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return[selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})));
  await page.locator('[data-counter-field="captionBacking"]').selectOption('surface');
  await frame().waitForFunction(()=>document.querySelector('#gameView').dataset.counterCaptionBacking==='surface');
  report.captionPlate=await frame().evaluate(()=>({captions:Object.fromEntries(['.counter-mode','.counter-context'].map(selector=>{const node=document.querySelector(selector),r=node.getBoundingClientRect(),s=getComputedStyle(node);return[selector,{box:{x:r.x,y:r.y,width:r.width,height:r.height},background:s.backgroundColor,shadow:s.textShadow,stroke:s.webkitTextStrokeWidth}];})),fade:getComputedStyle(document.querySelector('.counter-label-art-fade')).backgroundImage}));
  assert.deepEqual(Object.fromEntries(Object.entries(report.captionPlate.captions).map(([selector,value])=>[selector,value.box])),captionBefore,'Caption backing never changes caption geometry.');
  for(const caption of Object.values(report.captionPlate.captions)){assert.equal(caption.background,'rgb(17, 32, 20)');assert.equal(caption.shadow,'none');assert.equal(caption.stroke,'0px');}
  await page.screenshot({path:resolve(directory,'studio-radiation.png'),scale:'css'});
  await frame().locator('#gameView').screenshot({path:resolve(directory,'radiation-dial.png')});
  await page.locator('[data-counter-field="captionBacking"]').selectOption('compact');
  await frame().waitForFunction(()=>document.querySelector('#gameView').dataset.counterCaptionBacking==='compact');
  for (const name of ['Mira','Alexandria Morningwalker · SIMULATED']) {
    const sizes = await frame().locator('#counterContext > span').evaluate((label,name)=>{
      const original = label.textContent;
      label.textContent = name;
      const text = document.createRange();
      text.selectNodeContents(label);
      const widths = fragments => Array.from(fragments,rect=>rect.width);
      const result = {plates:widths(label.getClientRects()),lines:widths(text.getClientRects())};
      label.textContent = original;
      return result;
    },name);
    if (name==='Mira') assert.equal(sizes.lines.length,1);
    else assert.ok(sizes.lines.length>1,'The longer simulated name must wrap.');
    assert.deepEqual(sizes.plates,sizes.lines,'Compact plates follow each line of the name.');
  }
  report.previewStorageWrites=await frame().evaluate(()=>window.counterStorageWrites);
  assert.deepEqual(report.previewStorageWrites,[]);
  assert.equal(await catalog(),before,'Editing and inspecting do not alter the source catalog.');
  assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);
  report.engine=engine;
} finally {
  await writeFile(resolve(directory,'REPORT.json'),JSON.stringify(report,null,2));await browser.close();
}
console.log(JSON.stringify({comparisons:report.comparisons.length,newDraft:report.newDraft,existingV2WithoutAuthoredGlyphInheritsArt:report.existingV2WithoutAuthoredGlyphInheritsArt,legacyUpgradeNative:report.legacyUpgradeNative,errors:report.errors,writes:report.writes,report:resolve(directory,'REPORT.json')},null,2));
