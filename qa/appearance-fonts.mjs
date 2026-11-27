// Real renderer font regression, against disposable loopback data only.
// Run serially with other mutating regressions on the same fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localFontKeys,appearanceFonts } from '../client/appearance-fonts.js';
const origin=new URL(process.argv[2]||'http://127.0.0.1:8794/review');assert.equal(origin.hostname,'127.0.0.1');
assert.equal((await fetch(origin)).headers.get('x-studio-fixture'),'memory','Use a disposable in-memory Studio for this regression.');
const require=createRequire(process.env.PLAYWRIGHT_TOOLING||new URL('./package.json',import.meta.url));
const {chromium,webkit}=require('playwright-core');
const directory=resolve(process.env.STUDIO_FONT_REPORT_DIR||resolve(tmpdir(),'appearance-fonts-20261123'));
await mkdir(directory,{recursive:true});
const checks=[],measurements=[],requests=[],errors=[];
const base={id:'font-qa',status:'Preview',rendererVersion:2,background:'#081a23',surface:'#143341',text:'#effaf8',muted:'#c1d8dc',accent:'#95ded3',useGameBase:true,previewReadOnly:true,previewState:'longLabels',previewPlayers:4,previewMode:'life'};
async function run(engine,name) {
  const browser=await engine.launch(name==='chromium'?{headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{headless:true});
  try {
    // Isolate lazy face loading from the deliberate service-worker offline
    // precache. The shipped worker caches all 159 KiB during app installation.
    const context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block'}),page=await context.newPage();
    let release;const fontGate=new Promise(resolve=>{release=resolve;});let hold=name==='chromium';
    await page.route(url=>/^https?:/.test(url.protocol)&&url.origin!==origin.origin,route=>route.abort());
    if(name==='chromium')await page.route('**/cinzel-latin-variable.woff2',async route=>{
      const url=new URL(route.request().url());if(url.origin!==origin.origin)return route.abort();
      if(hold&&url.pathname.endsWith('/cinzel-latin-variable.woff2'))await fontGate;
      await route.continue();
    });
    page.on('pageerror',error=>errors.push({engine:name,error:error.message}));
    page.on('request',request=>requests.push({engine:name,method:request.method(),origin:new URL(request.url()).origin,path:new URL(request.url()).pathname}));
    await page.goto(new URL('/index.html?appearance-preview=1',origin).href);await page.waitForSelector('#gameView .pod-seat');
    assert.equal(requests.filter(request=>request.engine===name&&request.path.endsWith('.woff2')).length,0);
    await page.evaluate(()=>{window.fontDone=0;document.fonts.addEventListener('loadingdone',()=>window.fontDone++);});
    async function show(font,interfaceStyle='dial',overrides={}) {
      await page.evaluate(skin=>window.postMessage({type:'fivefold-arc:appearance-skin',skin},location.origin),{...base,fontFamily:font,fontWeight:600,interfaceStyle,...overrides});
      await page.waitForFunction(({font,interfaceStyle})=>document.querySelector('#gameView').dataset.localFont===font&&document.querySelector('#gameView').dataset.interfaceStyle===interfaceStyle,{font,interfaceStyle});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    const metric=()=>page.locator('.main-value').evaluate(node=>{
      const style=getComputedStyle(node),canvas=document.createElement('canvas').getContext('2d');canvas.font='600 64px '+style.fontFamily;
      const box=node.getBoundingClientRect();return {family:style.fontFamily,fontSize:style.fontSize,weight:style.fontWeight,x:style.getPropertyValue('--dial-glyph-x'),y:style.getPropertyValue('--dial-glyph-y'),sampleWidth:canvas.measureText('Fivefold 1040').width,box:{x:box.x,y:box.y,width:box.width,height:box.height},done:window.fontDone};
    });
    await show('cinzel');
    if(name==='chromium') {
      await page.waitForFunction(()=>[...document.fonts].some(face=>face.family.replace(/["']/g,'')==='Cinzel'&&face.status==='loading'),{},{timeout:3000});
      const before=await metric();hold=false;release();await page.waitForFunction(()=>document.fonts.check('600 64px "Cinzel"')&&window.fontDone>0);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const after=await metric();
      assert.notEqual(after.sampleWidth,before.sampleWidth);assert.ok(after.x!==before.x||after.y!==before.y,'fitter measures new glyph ink after the delayed face loads');
      measurements.push({engine:name,phase:'delayed-face',before,after});checks.push(name+': cold Cinzel swap triggers real glyph remeasurement without a viewport or game change');
    }
    const widths=[];
    for(const font of localFontKeys) {
      for(const interfaceStyle of ['button','dial']) {
        await show(font,interfaceStyle);const family=appearanceFonts[font].family.split(',')[0];await page.evaluate(family=>document.fonts.load('600 64px '+family),family);await page.evaluate(()=>document.fonts.ready);
        const value=await metric();assert.ok(value.family.includes(family.replaceAll('"','')));assert.equal(await page.evaluate(family=>document.fonts.check('600 64px '+family),family),true);
        if(interfaceStyle==='dial')widths.push(value.sampleWidth);
        for(const width of [320,393,768]) {
          await page.setViewportSize({width,height:852});
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
          const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,targets:[...document.querySelectorAll('#endTurnButton,.mode-nav button')].filter(node=>node.getClientRects().length).map(node=>({id:node.id||node.dataset.mode,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))}));
          if(geometry.scroll>width+1) {await page.screenshot({path:resolve(directory,name+'-overflow.png'),fullPage:true});console.log(JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#gameView *')].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().right>innerWidth+1).map(node=>({tag:node.tagName,id:node.id,class:node.className,width:node.getBoundingClientRect().width,right:node.getBoundingClientRect().right,font:getComputedStyle(node).fontSize}))),null,2));}
          assert.ok(geometry.scroll<=width+1,JSON.stringify(geometry));assert.ok(geometry.targets.every(target=>target.width>=24&&target.height>=24));
        }
        measurements.push({engine:name,font,interfaceStyle,...value});
      }
      await page.setViewportSize({width:393,height:852});await page.screenshot({path:resolve(directory,name+'-'+font+'.png'),fullPage:true});
    }
    assert.equal(new Set(widths.map(value=>value.toFixed(2))).size,3);
    checks.push(name+': all three real faces render distinct metrics in both layouts; targets and horizontal fit survive 320/393/768');
    await show('cinzel','dial',{surfaceDesign:{surfaces:{readout:{typography:{value:{family:'literata',shadow:'none'}}},navigation:{typography:{label:{family:'robotoCondensed'}}}}}});
    assert.match((await metric()).family,/Literata/);
    assert.match(await page.locator('.mode-nav small').first().evaluate(node=>getComputedStyle(node).fontFamily),/Roboto Condensed/);
    checks.push(name+': per-role families override the newly selected global local face');
    await page.setViewportSize({width:1440,height:1050});await page.goto(origin.href);await page.waitForSelector('[data-skin="harbor-study"]');await page.locator('[data-skin="harbor-study"]').click();await page.getByRole('button',{name:'Type & readability',exact:true}).click();
    await page.locator('#fontFamily').selectOption('literata');await page.waitForFunction(()=>document.querySelector('#exactPreview').contentDocument.querySelector('#gameView').dataset.localFont==='literata');
    const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/appearance-studio/catalog'&&response.request().method()==='PUT');await page.locator('#saveButton').click();const received=await response,saved=await received.json();assert.equal(received.ok(),true,JSON.stringify(saved));assert.equal(saved.catalog.skins.find(skin=>skin.id==='harbor-study').fontFamily,'literata');
    checks.push(name+': global registry picker preserves its selected family through real draft save');
    await context.close();
    const fallbackContext=await browser.newContext({viewport:{width:320,height:852},serviceWorkers:'block'}),fallback=await fallbackContext.newPage();
    await fallback.route('**/*',route=>new URL(route.request().url()).origin!==origin.origin||route.request().url().endsWith('.woff2')?route.abort():route.continue());
    await fallback.goto(new URL('/index.html?appearance-preview=1',origin).href);await fallback.waitForSelector('#gameView .pod-seat');await fallback.evaluate(skin=>window.postMessage({type:'fivefold-arc:appearance-skin',skin},location.origin),{...base,fontFamily:'cinzel',interfaceStyle:'button'});await fallback.waitForFunction(()=>document.querySelector('#gameView').dataset.localFont==='cinzel');await fallback.evaluate(()=>document.fonts.ready);
    const fallbackGeometry=await fallback.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,number:document.querySelector('.main-value').value,font:getComputedStyle(document.querySelector('.main-value')).fontFamily}));assert.equal(fallbackGeometry.number,'1040');assert.ok(fallbackGeometry.scroll<=fallbackGeometry.width+1);measurements.push({engine:name,fallback:fallbackGeometry});
    await fallback.screenshot({path:resolve(directory,name+'-fallback.png'),fullPage:true});checks.push(name+': blocked font files retain legible system fallbacks and protected phone controls');await fallbackContext.close();
  } finally {await browser.close();}
}
try {await run(chromium,'chromium');if(process.env.STUDIO_WEBKIT!=='0')await run(webkit,'webkit');assert.deepEqual(errors,[]);assert.ok(requests.every(request=>request.origin===origin.origin));assert.equal(requests.some(request=>request.path.startsWith('/api/')&&!request.path.startsWith('/api/appearance-studio/')&&request.path!=='/api/game-layout'),false);assert.equal(requests.some(request=>request.method!=='GET'&&!request.path.startsWith('/api/appearance-studio/')),false);console.log(JSON.stringify({directory,checks},null,2));}
finally {await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,measurements,requests,errors},null,2));}
