// Exercise the desktop authoring flow with the disposable design-review catalog.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:8793/review');
assert.equal(origin.hostname, '127.0.0.1');
assert.equal((await fetch(origin)).headers.get('x-studio-fixture'), 'memory');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const engine = process.env.STUDIO_BROWSER || 'chromium';
const browser = await require('playwright-core')[engine].launch({ headless:true, ...(engine === 'chromium' ? {executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'} : {}) });
const out = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(),'appearance-custom-designs',engine));
await mkdir(out, {recursive:true});
const page = await browser.newPage({ viewport:{width:1800,height:1160}, acceptDownloads:true, serviceWorkers:'block' });
const errors=[], writes=[], external=[], checks=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
page.on('request',request=>{
  const url=new URL(request.url());
  if (/^https?:$/.test(url.protocol) && url.origin !== origin.origin) external.push(url.origin);
  if (!['GET','HEAD'].includes(request.method())) writes.push(url.pathname);
});
await page.route('**/*',route=>new URL(route.request().url()).origin===origin.origin ? route.continue() : route.abort());
const frame=page.frameLocator('#exactPreview');
const root=frame.locator('html'), game=frame.locator('#gameView');
async function openField(selector) {
  await page.locator(selector).evaluate(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement) if(parent.tagName==='DETAILS') parent.open=true;});
}
async function waitColor(color) {
  await page.waitForFunction(expected=>document.querySelector('#exactPreview')?.contentDocument?.documentElement.style.getPropertyValue('--bg')===expected,color);
  await root.evaluate(async el=>{await el.ownerDocument.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
}
const dimensions=()=>game.evaluate(el=>({gutter:getComputedStyle(el).paddingInlineStart,gap:getComputedStyle(el).rowGap}));
try {
  await page.goto(origin.href);
  await page.locator('[data-skin="studio-example-night-circuit"]').waitFor();
  assert.equal(await page.locator('#deviceSafe').isChecked(),false);
  assert.equal(await page.locator('#deviceFrame').isChecked(),false);
  await page.locator('#deviceZoom').selectOption('100');
  const styleSamples=[];
  for (const [id,bg,font,face] of [['field-notes','#e5d9bc','Literata','rings'],['night-circuit','#061517','mono','faceted'],['rose-window','#1c132b','Cinzel','radial']]) {
    await page.locator('[data-skin="studio-example-'+id+'"]').click();
    await waitColor(bg);
    const sample=await game.evaluate(el=>{
      const doc=el.ownerDocument;
      return {face:el.dataset.counterFace,font:getComputedStyle(doc.getElementById('mainValue')).fontFamily,background:getComputedStyle(doc.body).backgroundImage,rad:!!doc.querySelector('#modeNav [data-mode="radiation"] svg'),art:el.querySelectorAll('.appearance-surface-art').length,fontStatus:doc.fonts.status};
    });
    assert.equal(sample.face,face); assert.ok(sample.font.toLowerCase().includes(font.toLowerCase()),sample.font);
    assert.ok(sample.rad); assert.ok(sample.background.includes('gradient'));
    if (id==='rose-window') assert.ok(sample.art>0,'flag STUDIO_DESIGN_REVIEW_ART=1 to load the local art sample');
    await page.locator('#exactPreview').screenshot({path:resolve(out,id+'.png'),animations:'disabled'});
    styleSamples.push({...sample,id});
  }
  assert.equal(new Set(styleSamples.map(s=>s.background)).size,3);
  checks.push('Three different real game renders, loaded typefaces, original radiation icon, and local Rose Window art');
  await page.screenshot({path:resolve(out,'desktop-studio.png'),animations:'disabled'});
  assert.equal(writes.length,0);
  await page.locator('#openDesignStarters').click();
  await page.locator('[data-starter="night-circuit"]').click();
  await waitColor('#061517');
  const starterId=await page.locator('.skin-card.selected').getAttribute('data-skin').catch(()=>null);
  assert.notEqual(starterId,'studio-example-night-circuit');
  await page.locator('#pickGamePart').click(); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'pickGamePart');
  await page.locator('#pickGamePart').click();
  const card=await frame.locator('.pod-seat').first().boundingBox();
  await page.mouse.click(card.x+card.width/2,card.y+card.height/2);
  assert.equal(await page.locator('#surfaceDesignTarget').inputValue(),'playerCards');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'surfaceDesignTarget');
  await page.locator('#pickGamePart').click(); await page.locator('#gamePartList').selectOption('mode-radiation');
  assert.equal(await page.locator('#counterDesignMode').inputValue(),'radiation');
  checks.push('Preview picking with a pointer, keyboard navigation, and Escape returns to the right editor');
  await page.locator('#pickGamePart').click(); await page.locator('#gamePartList').selectOption('canvas');
  await page.locator('#canvasDesign-pattern').selectOption('contours');
  const ink=page.getByRole('textbox',{name:'Pattern ink hex',exact:true});
  await ink.fill('48A6BF');await ink.press('Enter');
  assert.equal(await page.locator('#canvasDesign-patternColor').inputValue(),'#48a6bf');
  await page.getByRole('button',{name:'Inherit pattern ink',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Use current color for pattern ink',exact:true}).count(),1);
  await page.locator('#undoButton').click();
  assert.equal(await page.locator('#canvasDesign-patternColor').inputValue(),'#48a6bf');
  await page.locator('#redoButton').click();
  await openField('#designMoment');
  await page.locator('#designMoment').selectOption('otherTurn');
  await page.getByRole('button',{name:'Preview this moment'}).click();
  await page.waitForFunction(()=>document.querySelector('#exactPreview')?.contentDocument?.querySelector('#gameView')?.dataset.yourTurn==='false');
  const wash=()=>root.evaluate(el=>getComputedStyle(el).getPropertyValue('--scene-wash'));
  const other=await wash();assert.ok(other);
  await page.locator('#studioScene').selectOption('turn');
  await page.waitForFunction(()=>document.querySelector('#exactPreview')?.contentDocument?.querySelector('#gameView')?.dataset.yourTurn==='true');
  assert.notEqual(await wash(),other);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await game.evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  checks.push('Exact hex entry, per-color inheritance, Undo/Redo, moment preview, and reduced-motion decoration');
  await page.locator('#studioNavigation [aria-controls="edit-layout"]').click();
  await openField('#tableDesign-rowGap');
  for(const [key,value] of [['sideGutter','18'],['rowGap','9']]) await page.locator('#tableDesign-'+key).fill(value);
  await page.waitForFunction(()=>{const el=document.querySelector('#exactPreview')?.contentDocument?.querySelector('#gameView');return el && getComputedStyle(el).rowGap==='9px';});
  assert.deepEqual(await dimensions(),{gutter:'18px',gap:'9px'});
  await page.locator('#studioNavigation [aria-controls="edit-foundation"]').click();
  await openField('#skinName');
  await page.locator('#skinName').fill('Custom browser proof');
  const saved=page.waitForResponse(res=>res.request().method()==='PUT' && new URL(res.url()).pathname==='/api/appearance-studio/catalog');
  await page.locator('#saveButton').click();
  const response=await saved; assert.equal(response.ok(),true);
  const result=(await response.json()).catalog;
  const skin=result.skins.find(s=>s.name==='Custom browser proof');
  assert.ok(skin && skin.status==='Draft' && !skin.id.startsWith('studio-example-'));
  assert.equal(skin.canvasDesign.pattern,'contours');assert.equal(skin.tableDesign.rowGap,9);
  assert.equal(skin.counterDesign.navigationIcons,'native');
  const download=page.waitForEvent('download');await page.locator('#exportCatalogButton').click();
  const backup=JSON.parse(await readFile(await (await download).path(),'utf8'));
  const portable=(backup.catalog||backup).skins.find(s=>s.id===skin.id);
  assert.deepEqual(portable.tableDesign,skin.tableDesign);assert.deepEqual(portable.surfaceDesign,skin.surfaceDesign);
  assert.deepEqual(portable.sceneDesign,skin.sceneDesign);assert.deepEqual(portable.counterDesign,skin.counterDesign);
  await page.reload();await page.locator('[data-skin="'+skin.id+'"]').click();await waitColor('#061517');
  assert.deepEqual(await dimensions(),{gutter:'18px',gap:'9px'});
  checks.push('Bounded gutter and gap reach real CSS, a distinct draft saves, all design families export and reopen');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.ok(writes.every(path=>path==='/api/appearance-studio/catalog'));
  await writeFile(resolve(out,'report.json'),JSON.stringify({engine,checks,errors,external,writes,styleSamples},null,2));
  console.log(JSON.stringify({engine,checks,errors,external,writes}));
} finally {await browser.close();}
