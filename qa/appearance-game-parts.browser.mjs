// Rehearse authoring through Studio controls on a disposable loopback catalog.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const target = new URL(process.argv[2]);
assert.equal(target.hostname,'127.0.0.1');
assert.equal((await fetch(target)).headers.get('x-studio-fixture'),'memory');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('../package.json',import.meta.url));
const { chromium, webkit } = require('playwright-core');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {});
const page = await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
const nav = section => page.locator('#studioNavigation button[aria-controls="edit-'+section+'"]').click();
const getArt = name => page.locator('#assetLibrary article').filter({has:page.getByText(name,{exact:true})});
const frame = () => page.frames().find(candidate=>candidate.url().includes('appearance-preview=1'));
const readGeometry = () => Object.fromEntries(['.dial-gesture','.dial-step-plus','.dial-step-minus','.mode-nav','.main-value'].map(selector=>{
  const {x,y,width,height}=document.querySelector(selector).getBoundingClientRect();
  return [selector,[x,y,width,height].map(Math.round)];
}));
const run = Date.now().toString(36), title = engine + '-' + run;
const cropName = 'QA '+title+' left tab';
const draftName = 'Game parts '+title;
const sourceName = title+' two panel engraving';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="128" height="128" fill="#ef542c"/><rect x="128" width="128" height="128" fill="#2b49e4"/></svg>';
try {
  await page.goto(target.href);
  await page.locator('[data-skin="harbor-study"]').waitFor();
  await page.locator('#newSkinButton').click();
  await page.locator('.skin-management > summary').click();
  await page.locator('#skinName').fill(draftName);
  await page.locator('#skinName').press('Tab');

  await nav('assets');
  await page.locator('#assetName').fill(sourceName);
  await page.locator('#assetSource').fill('Local generated crop test');
  await page.locator('#assetPlacement').selectOption('dial');
  await page.locator('#assetFile').setInputFiles({name:'pair.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await page.locator('#importAssetButton').click();
  const original = getArt(sourceName);
  await original.getByRole('button',{name:'Approve artwork'}).click();
  await original.getByText('Approved · Dial art').waitFor();
  const bytesBefore = await original.locator('img').getAttribute('src');
  await original.getByRole('button',{name:'Crop a copy'}).click();
  const dialog = page.getByRole('dialog',{name:'Crop artwork'});
  await dialog.locator('[data-crop-name]').fill(cropName);
  const left = dialog.locator('[data-crop-x]');
  await left.focus(); await left.press('Home');
  await dialog.getByRole('button',{name:'Save crop to library'}).click();
  await dialog.locator('[data-crop-status]').filter({hasText:'Saved “'+cropName+'”'}).waitFor();
  const savedPixels = await getArt(cropName).locator('img').evaluate(async img=>{
    await img.decode(); const c=document.createElement('canvas'); c.width=c.height=1;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];
  });
  assert.ok(savedPixels[0] > 200 && savedPixels[2] < 80);
  await dialog.locator('[data-crop-role]').selectOption('thumbnail');
  await dialog.locator('[data-crop-name]').fill('QA '+title+' right thumbnail');
  await left.press('End');
  await dialog.locator('[data-crop-round]').check();
  await dialog.getByRole('button',{name:'Save crop to library'}).click();
  await dialog.locator('[data-crop-status]').filter({hasText:'right thumbnail”'}).waitFor();
  await dialog.getByRole('button',{name:'Done'}).click();
  assert.equal(await original.locator('img').getAttribute('src'),bytesBefore);
  const thumb = getArt('QA '+title+' right thumbnail');
  const alpha = await thumb.locator('img').evaluate(async img=>{
    await img.decode();const c=document.createElement('canvas');c.width=c.height=128;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0,128,128);
    return [ctx.getImageData(0,0,1,1).data[3],[...ctx.getImageData(64,64,1,1).data]];
  });
  assert.equal(alpha[0],0); assert.ok(alpha[1][2] > 170 && alpha[1][0] < 80);
  await getArt(cropName).getByRole('button',{name:'Approve artwork'}).click();
  await nav('symbols');
  await page.locator('[data-symbol-asset="life"]').selectOption({label:cropName});
  await nav('layout');
  await page.locator('#interfaceStyle').selectOption('dial');
  const preview = frame();
  await preview.waitForFunction(()=>document.querySelector('#gameView').dataset.interfaceStyle === 'dial' &&
    document.querySelector('[data-mode="life"] img')?.naturalWidth && document.querySelector('.dial-step-plus').getBoundingClientRect().width > 0);
  await preview.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const geometry = await preview.evaluate(readGeometry);
  const socket = page.locator('#tableDesign-dialSocket');
  await socket.locator('xpath=ancestor::details').locator('summary').click();
  await socket.selectOption('metal');
  await nav('symbols');
  await page.locator('[data-counter-field="artAsset"]').selectOption({label:sourceName});
  await page.locator('[data-counter-field="captionBacking"]').selectOption('surface');
  const opacity = page.locator('[data-counter-field="artOpacity"]');
  await opacity.press('End');
  await page.locator('[data-counter-field="artRotation"]').selectOption('fixed');
  await page.locator('[data-counter-field="uprightCenter"]').check();
  await nav('components');
  await page.getByRole('button',{name:'Use translucent card backing'}).click();
  await preview.waitForFunction(()=>{
    const game = document.querySelector('#gameView');
    return game.dataset.counterSocket==='metal' && game.dataset.counterArtRotation==='fixed' &&
      game.dataset.counterValueBacking==='surface' && game.dataset.surfacePlayerCardsFill==='true' &&
      document.querySelector('.counter-design-engraving img')?.naturalWidth && document.querySelector('[data-mode="life"] img')?.naturalWidth;
  });
  const values=await preview.evaluate(()=>{
    const seat=document.querySelector('.pod-seat:not(.eliminated)'),face=document.querySelector('.dial-face');
    return {card:getComputedStyle(seat).backgroundColor, name:getComputedStyle(seat.querySelector('.seat-name')).opacity,
      life:getComputedStyle(seat.querySelector('.seat-life')).opacity, socket:getComputedStyle(face,'::before').backgroundImage,
      centerHidden:document.querySelector('.counter-design-engraving img').hidden,rotation:getComputedStyle(document.querySelector('.counter-design-face')).transform,
      backing:getComputedStyle(document.querySelector('.main-value')).backgroundColor};
  });
  assert.match(values.card,/0\.55\)/); assert.equal(values.name,'1'); assert.equal(values.life,'1');
  assert.match(values.socket,/repeating-conic-gradient/); assert.equal(values.centerHidden,false); assert.equal(values.rotation,'none');
  assert.doesNotMatch(values.backing,/rgba\(0, 0, 0, 0\)|transparent/); assert.deepEqual(await preview.evaluate(readGeometry),geometry);
  await nav('layout');
  for (const style of ['dial','button']) {
    await page.locator('#interfaceStyle').selectOption(style);
    await preview.waitForFunction(style=>document.querySelector('#gameView').dataset.interfaceStyle===style,style);
    const plate = await preview.evaluate(()=>{
      const parent=document.querySelector('.counter-context'),label=parent.querySelector('span');
      const range=document.createRange(); range.selectNodeContents(label);
      return {parent:getComputedStyle(parent).backgroundColor,color:getComputedStyle(label).backgroundColor,
        width:label.getBoundingClientRect().width,text:range.getBoundingClientRect().width};
    });
    assert.match(plate.parent,/rgba\(0, 0, 0, 0\)|transparent/);
    assert.doesNotMatch(plate.color,/rgba\(0, 0, 0, 0\)|transparent/);
    assert.ok(Math.abs(plate.width-plate.text)<3,style+' caption backing should fit the player name');
  }
  await page.locator('#interfaceStyle').selectOption('dial');
  await page.locator('#saveButton').click();
  await page.waitForFunction(name=>document.querySelector('[data-skin].selected')?.innerText.includes(name) ||
    [...document.querySelectorAll('[data-skin]')].some(node=>node.textContent.includes(name)),draftName);
  await page.reload(); await page.getByText(draftName,{exact:true}).first().waitFor();
  await nav('layout'); const persisted=page.locator('#tableDesign-dialSocket');
  assert.equal(await persisted.inputValue(),'metal');
  await nav('symbols');
  assert.equal(await page.locator('[data-counter-field="artOpacity"]').inputValue(),'100');
  assert.equal(await page.locator('[data-counter-field="uprightCenter"]').isChecked(),true);
  assert.equal(await page.locator('[data-counter-field="artRotation"]').inputValue(),'fixed');
  assert.deepEqual(errors,[]);
  console.log(engine+' passed asset import, reusable crops, independent dial/card settings, native geometry and reload.');
} catch (error) {
  const status = await page.locator('[data-crop-status],#assetStatus,#saveState').allTextContents();
  console.error('Studio feedback:',status,'browser errors:',errors);
  throw error;
} finally { await browser.close(); }
