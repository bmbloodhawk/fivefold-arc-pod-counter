// Disposable loopback Studio only. Run the local fixture on an unused port.
// PLAYWRIGHT_TOOLING points to package.json beside playwright-core.
// Run serially with other mutating regressions on the same fixture (revision CAS).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const origin=new URL(process.argv[2]||'http://127.0.0.1:8794/review');
assert.equal(origin.hostname,'127.0.0.1');
assert.equal((await fetch(origin)).headers.get('x-studio-fixture'),'memory','Use a disposable in-memory Studio for this regression.');
const require=createRequire(process.env.PLAYWRIGHT_TOOLING||new URL('./package.json',import.meta.url));
const {chromium,webkit}=require('playwright-core');
const directory=resolve(process.env.STUDIO_REPORT_DIR||resolve(tmpdir(),'appearance-surface-design-20261123'));
await mkdir(directory,{recursive:true});
const checks=[],measurements=[],requests=[],errors=[];
const surfaces={
  gameHeader:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',muted:'#473f30',typography:{heading:{family:'mono',shadow:'none'}}},
  playerCards:{fill:{kind:'linear',color:'#eee5cc',color2:'#ddd0af',angle:125},ink:'#172c37',accent:'#263b42',border:{color:'#725c32',width:2,style:'dashed'},radii:{topLeft:0,topRight:14},texture:{kind:'grid',strength:5},shadow:'inset',typography:{label:{family:'mono',weight:700,style:'italic',shadow:'none',scale:105},value:{family:'serif',shadow:'none'}}},
  readout:{ink:'#f6ddaa',accent:'#d8c590',muted:'#c9bca2',typography:{value:{family:'mono',shadow:'none',weight:700},label:{style:'italic'}}},
  turnBar:{fill:{kind:'radial',color:'#fff6de',color2:'#e5d9be'},ink:'#172c37',muted:'#473f30',accent:'#4b3b27'},
  primaryActions:{fill:{kind:'solid',color:'#ddd0af'},ink:'#172c37'},
  lifeControls:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',muted:'#473f30'},
  commanderTools:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',muted:'#473f30',typography:{value:{family:'mono',shadow:'none'}}},
  navigation:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',accent:'#4b3b27',typography:{label:{family:'mono',shadow:'none'}}},
  gameMenu:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37'},
  dialogs:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',muted:'#473f30',typography:{heading:{family:'mono',shadow:'none'}}},
  inputs:{fill:{kind:'solid',color:'#fff6de'},ink:'#172c37',border:{color:'#725c32',width:2}},
  lobby:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',muted:'#473f30',accent:'#4b3b27'},
  results:{fill:{kind:'solid',color:'#eee5cc'},ink:'#172c37',muted:'#473f30',accent:'#4b3b27'}
};
const base={id:'surface-qa',name:'Surface QA',status:'Preview',rendererVersion:2,background:'#081a23',surface:'#143341',text:'#effaf8',muted:'#c1d8dc',accent:'#95ded3',interfaceStyle:'button',useGameBase:true,previewReadOnly:true};
async function run(engine,name) {
  const browser=await engine.launch(name==='chromium'?{headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{headless:true});
  try {
    const context=await browser.newContext({viewport:{width:393,height:852}}),page=await context.newPage();
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin.origin?route.continue():route.abort());
    page.on('pageerror',error=>errors.push({engine:name,error:error.message}));
    page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/')||request.method()!=='GET')requests.push({engine:name,method:request.method(),path});});
    await page.goto(new URL('/index.html?appearance-preview=1',origin).href);
    await page.waitForSelector('#gameView .pod-seat');
    async function show(value,state='turn',mode='life') {
      await page.evaluate(skin=>window.postMessage({type:'fivefold-arc:appearance-skin',skin},location.origin),{...value,previewState:state,previewMode:mode,previewPlayers:4});
      await page.waitForFunction(({state,mode})=>document.documentElement.dataset.previewFixture===state&&document.documentElement.dataset.previewMode===mode,{state,mode});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    const style=selector=>page.locator(selector).first().evaluate(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect();return {color:style.color,background:style.backgroundColor,image:style.backgroundImage,family:style.fontFamily,weight:style.fontWeight,fontStyle:style.fontStyle,shadow:style.textShadow,boxShadow:style.boxShadow,topLeft:style.borderTopLeftRadius,topRight:style.borderTopRightRadius,borderStyle:style.borderTopStyle,width:box.width,height:box.height};});
    await show(base);const previous=await style('.mode-nav button:not(.active) small');
    const custom={...base,surfaceDesign:{surfaces}};
    for(const interfaceStyle of ['button','dial']) {
      await show({...custom,interfaceStyle});
      const nav=await style('.mode-nav button:not(.active) small'),amount=await style('.commander-tax-quick-value span'),seat=await style('.pod-seat'),seatName=await style('.pod-seat .seat-name'),value=await style('.main-value'),life=await style('.adjust-controls button span');
      assert.equal(nav.color,'rgb(23, 44, 55)');assert.equal(amount.color,'rgb(23, 44, 55)');assert.equal(life.color,'rgb(23, 44, 55)');
      assert.equal(seat.topLeft,'0px');assert.equal(seat.topRight,'14px');assert.equal(seat.borderStyle,'dashed');assert.match(seat.image,/gradient/);
      assert.match(seatName.family,/monospace/);assert.equal(seatName.fontStyle,'italic');assert.equal(value.shadow,'none');assert.match(value.family,/monospace/);
      measurements.push({engine:name,interfaceStyle,nav,amount,seat,seatName,value,life});
    }
    checks.push(name+': real descendants, gradient/texture, corner radii, typography and shadow change both layouts');
    assert.equal((await style('.brand-bar')).background,'rgb(238, 229, 204)');
    assert.equal((await style('.brand-bar .brand strong')).color,'rgb(23, 44, 55)');
    const connection=await style('.connection-pill');
    await page.evaluate(()=>{for(const id of ['gameView','lobbyView','intermissionView'])document.getElementById(id).hidden=true;document.getElementById('landingView').hidden=false;});
    assert.notEqual((await style('.brand-bar')).background,'rgb(238, 229, 204)');
    assert.equal((await style('.connection-pill')).color,connection.color);
    checks.push(name+': gameplay header styles its real brand title while landing and connection status retain native presentation');
    for(const [state,target]of [['menu','#gameMenu'],['dialog','#customLifeDialog'],['radiationDialog','#radiationDialog'],['lobby','#lobbyControls'],['end','#victoryDialog .victory-dialog-content']]) {
      await show(custom,state);
      const value=await style(target);assert.equal(value.background,'rgb(238, 229, 204)',name+' '+state);
      measurements.push({engine:name,state,target,...value});
      if(state==='dialog')assert.equal((await style('#customLifeAmount')).color,'rgb(23, 44, 55)');
    }
    await show(custom,'error');assert.notEqual((await style('#connectionDialog')).background,'rgb(238, 229, 204)');
    checks.push(name+': game menu, counter dialogs, form input, lobby and results receive independent materials; connection dialog stays outside scope');
    const darkSurfaces=Object.fromEntries(Object.entries(surfaces).map(([key,value])=>[key,{...value,fill:{kind:'linear',color:'#142e39',color2:'#081a23',angle:135},...(value.ink?{ink:'#f1ead7'}:{}),...(value.muted?{muted:'#c2cdbb'}:{}),...(value.accent?{accent:'#ecbe7f'}:{})}]));
    for(const interfaceStyle of ['button','dial']) {
      await show({...base,interfaceStyle,surfaceDesign:{surfaces:darkSurfaces}});
      assert.equal((await style('.mode-nav button:not(.active) small')).color,'rgb(241, 234, 215)');assert.equal((await style('.commander-tax-quick-value span')).color,'rgb(241, 234, 215)');assert.equal((await style('.main-value')).color,'rgb(241, 234, 215)');assert.match((await style('.brand-bar')).image,/linear-gradient/);
    }
    await page.screenshot({path:resolve(directory,name+'-dark-surfaces.png'),fullPage:true});checks.push(name+': full dark material/ink fields also reach actual header, navigation, commander amounts and total in both layouts');
    for(const width of [320,393,768]) {
      await page.setViewportSize({width,height:852});await show(custom);
      const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(geometry.scroll<=width+1,JSON.stringify(geometry));measurements.push({engine:name,...geometry});
    }
    await show(base);assert.equal((await style('.mode-nav button:not(.active) small')).color,previous.color);
    const legacy={...base,rendererVersion:1};await show(legacy);const legacyBefore=await style('.mode-nav small');await show({...legacy,surfaceDesign:{surfaces}});assert.deepEqual(await style('.mode-nav small'),legacyBefore);
    checks.push(name+': sparse clearing restores old v2 and version1 ignores expanded overrides');
    await page.setViewportSize({width:393,height:852});await show(custom);await page.screenshot({path:resolve(directory,name+'-surfaces.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1050});
    await page.goto(origin.href);await page.waitForSelector('#surfaceDesignTarget',{state:'attached'});
    await page.locator('[data-skin="harbor-study"]').click();
    await page.getByRole('button',{name:'Controls & cards',exact:true}).click();
    await page.locator('#surfaceDesignTarget').selectOption('playerCards');
    await page.getByRole('checkbox',{name:'Main text',exact:true}).check();
    const chosenHex=name==='chromium'?'#112233':'#223344',chosenRgb=name==='chromium'?'rgb(17, 34, 51)':'rgb(34, 51, 68)';
    const hex=page.getByRole('textbox',{name:'Main text hex',exact:true});
    if(await hex.inputValue()===chosenHex) {await hex.fill('#334455');await hex.press('Tab');}
    await hex.fill(chosenHex);await hex.press('Tab');
    await page.waitForFunction(expected=>getComputedStyle(document.querySelector('#exactPreview').contentDocument.querySelector('.pod-seat .seat-name')).color===expected,chosenRgb);
    await page.locator('#undoButton').click();assert.notEqual(await hex.inputValue(),chosenHex);await page.locator('#redoButton').click();assert.equal(await hex.inputValue(),chosenHex);
    await page.getByRole('button',{name:'Reset surface to inherited',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:'Main text',exact:true}).isChecked(),false);
    await page.locator('#undoButton').click();assert.equal(await hex.inputValue(),chosenHex);
    const typography=page.locator('.surface-design-editor details').filter({has:page.locator('summary', {hasText:'Typography by role'})});await typography.locator('summary').click();
    await page.getByRole('checkbox',{name:'Font family',exact:true}).check();await page.getByRole('combobox',{name:'Font family value',exact:true}).selectOption('mono');
    await page.getByRole('button',{name:'Copy surface style',exact:true}).click();
    await page.locator('#surfaceDesignTarget').selectOption('turnBar');
    const clearTarget=page.getByRole('button',{name:'Reset surface to inherited',exact:true});if(await clearTarget.isEnabled())await clearTarget.click();
    await page.getByRole('checkbox',{name:'Supporting text',exact:true}).check();const supporting=page.getByRole('textbox',{name:'Supporting text hex',exact:true});await supporting.fill('#556677');await supporting.press('Tab');
    await page.getByRole('button',{name:'Merge Player cards style',exact:true}).click();assert.equal(await hex.inputValue(),chosenHex);assert.equal(await supporting.inputValue(),'#556677');
    assert.equal(await page.getByRole('combobox',{name:'Font family value',exact:true}).inputValue(),'mono');
    await page.locator('#undoButton').click();assert.equal(await page.getByRole('checkbox',{name:'Main text',exact:true}).isChecked(),false);assert.equal(await supporting.inputValue(),'#556677');await page.locator('#redoButton').click();assert.equal(await hex.inputValue(),chosenHex);
    checks.push(name+': local copy merges matching material/role fields, preserves target supporting ink, and Undo/Redo reverses the merge');
    const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/appearance-studio/catalog'&&response.request().method()==='PUT');await page.locator('#saveButton').click();const response=await saved;assert.equal(response.ok(),true,await response.text());
    for(const width of [320,393,768]) {
      await page.setViewportSize({width,height:900});
      const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(overflow.scroll<=width+1,JSON.stringify(overflow));
    }
    checks.push(name+': exact keyboard hex edit, Undo/Redo, per-surface inherit/reset and draft save work in integrated Studio at desktop/320/393/768 widths');
    await page.screenshot({path:resolve(directory,name+'-editor.png'),fullPage:true});await context.close();
  } finally {await browser.close();}
}
try {
  await run(chromium,'chromium');
  if(process.env.STUDIO_WEBKIT!=='0')await run(webkit,'webkit');
  assert.deepEqual(errors,[]);
  assert.equal(requests.some(request=>request.path.startsWith('/api/')&&!request.path.startsWith('/api/appearance-studio')&&request.path!=='/api/game-layout'),false);
  assert.equal(requests.some(request=>!['GET','HEAD'].includes(request.method)&&!request.path.startsWith('/api/appearance-studio/')),false);
  console.log(JSON.stringify({directory,checks,requestCount:requests.length},null,2));
} finally {await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,measurements,requests,errors},null,2));}
