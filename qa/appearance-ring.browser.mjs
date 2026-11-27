// Author two independent images in a disposable desktop Studio and operate the real phone dial.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const target = new URL(process.argv[2]);
assert.equal(target.hostname,'127.0.0.1');
assert.equal((await fetch(target)).headers.get('x-studio-fixture'),'memory');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('../package.json',import.meta.url));
const engine = process.env.STUDIO_BROWSER || 'chromium';
const browser = await require('playwright-core')[engine].launch(
  engine === 'chromium' && process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}
);
const page = await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror',e => errors.push(e.message));
page.on('dialog',dialog=>dialog.type()==='beforeunload' || dialog.message().startsWith('Approve “') ? dialog.accept() : dialog.dismiss());
const run = engine+' '+Date.now().toString(36);
const skinName = 'Ring study '+run, centerName = 'Fern '+run, ringName = 'Compass '+run;
const nav = section => page.locator('[aria-controls="edit-'+section+'"]').click();
const field = key => page.locator('[data-counter-field="'+key+'"]');
const release = page.locator('#studioReleaseEditor');
async function importDial(name, illustration) {
  await page.locator('#assetName').fill(name);
  await page.locator('#assetSource').fill('Original local test illustration');
  await page.locator('#assetPlacement').selectOption('dial');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'+illustration+'</svg>';
  await page.locator('#assetFile').setInputFiles({name:'drawing.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await page.locator('#importAssetButton').click();
  const asset = page.locator('#assetLibrary article').filter({has:page.getByText(name,{exact:true})});
  await asset.getByRole('button',{name:'Approve artwork'}).click();
  await asset.getByText('Approved · Dial art').waitFor();
}
async function saveAndReload() {
  const response = page.waitForResponse(r=>r.url().endsWith('/api/appearance-studio/catalog') && r.request().method()==='PUT');
  await page.locator('#saveButton').click();
  assert.equal((await response).status(),200);
  await page.locator('#saveState').filter({hasText:'Saved draft'}).waitFor();
  await page.reload();
  await page.getByText(skinName,{exact:true}).first().waitFor();
  await nav('symbols');
}
function transforms() {
  const face=document.querySelector('.counter-design-ring'), center=document.querySelector('.counter-design-engraving');
  return {ring:getComputedStyle(face).transform,center:getComputedStyle(center).transform,
    ringSource:face.querySelector('img').src,centerSource:center.querySelector('img').src};
}
// Measure the painted magenta sector itself in the phone screenshot. The reference
// drawing places that sector clear of the caption and value throughout this tap.
async function dialPigments(phone) {
  const png=(await phone.screenshot({scale:'css'})).toString('base64');
  return phone.evaluate(async png=>{
    const image = new Image();image.src='data:image/png;base64,'+png;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const box=document.querySelector('.dial-face').getBoundingClientRect();
    const cx=box.left+box.width/2, cy=box.top+box.height/2, radius=box.width/2;
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let dx=0,dy=0,count=0,leafX=0,leafY=0,leafCount=0;
    for(let y=Math.max(0,Math.floor(box.top));y<Math.min(canvas.height,box.bottom);y++) {
      for(let x=Math.max(0,Math.floor(box.left));x<Math.min(canvas.width,box.right);x++) {
        const a=x-cx,b=y-cy,r=Math.hypot(a,b),i=(y*canvas.width+x)*4;
        if(r>radius*.64 && r<radius*.98 && pixels[i]>125 && pixels[i+2]>120 && pixels[i+1]<pixels[i]*.45) {
          dx+=a/r;dy+=b/r;count++;
        }
        if(r<radius*.60 && pixels[i]>95 && pixels[i+1]>155 && pixels[i+1]>pixels[i]*1.2 && pixels[i+2]<pixels[i]*.6) {
          leafX+=a;leafY+=b;leafCount++;
        }
      }
    }
    return {angle:Math.atan2(dy,dx)*180/Math.PI,count,leaf:[leafX/leafCount,leafY/leafCount],leafCount};
  },png);
}
async function waitForPaint(phone) {
  const deadline=Date.now()+6000;
  let samples;
  do {
    samples=await dialPigments(phone);
    if(samples.count>50 && samples.leafCount>12) return samples;
    await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  } while(Date.now()<deadline);
  assert.fail('The ring sector and center marker must both be visible: '+JSON.stringify(samples));
}
try {
  await page.goto(target.href);
  await page.locator('[data-skin="harbor-study"]').waitFor();
  await page.locator('#newSkinButton').click();
  await page.locator('.skin-management > summary').click();
  await page.locator('#skinName').fill(skinName);await page.locator('#skinName').press('Tab');
  await nav('assets');
  await importDial(centerName,'<rect width="128" height="128" fill="#167050"/><ellipse fill="#baff38" cx="30" cy="55" rx="3" ry="4"/>');
  await importDial(ringName,'<circle cx="64" cy="64" r="64" fill="#168e88"/><path fill="#ff00ee" d="M64 64 8 29 A66 66 0 0 1 29 8Z"/>');
  await nav('layout');await page.locator('#interfaceStyle').selectOption('dial');
  await nav('symbols');
  await field('artAsset').selectOption({label:centerName});
  await field('captionBacking').selectOption('surface');
  await field('artOpacity').press('End');
  await field('artRotation').selectOption('fixed');await field('uprightCenter').check();
  await field('ringArtAsset').selectOption({label:ringName});
  assert.ok(await field('artRotation').isHidden());assert.ok(await field('uprightCenter').isDisabled());
  assert.equal(await page.getByLabel('Center artwork',{exact:true}).locator('option:checked').textContent(),centerName);
  const exact = page.frames().find(f=>f.url().includes('appearance-preview=1'));
  await exact.waitForFunction(()=>document.querySelector('#gameView').dataset.counterRingArt==='separate');
  assert.equal(await field('ringCrop').inputValue(),'annulus');
  await field('ringCrop').selectOption('full');
  await exact.waitForFunction(()=>document.querySelector('#gameView').dataset.counterRingCrop==='full');
  await page.locator('#counterDesignMode').selectOption('poison');
  assert.ok(await field('ringCrop').isHidden());
  assert.equal(await field('ringArtAsset').inputValue(),'');
  assert.ok(await field('artRotation').isVisible());
  await page.locator('#counterDesignMode').selectOption('life');
  await nav('review');
  await page.locator('#rewardSearch').fill('First Crown');
  await page.locator('#rewardAchievement').selectOption('first-crown');
  await page.locator('#addRewardAchievement').click();
  await saveAndReload();
  assert.equal(await field('ringArtAsset').locator('option:checked').textContent(),ringName);
  assert.equal(await field('artAsset').locator('option:checked').textContent(),centerName);
  assert.ok(await field('artRotation').isDisabled());
  assert.equal(await field('ringCrop').inputValue(),'full');
  // Use the cropped ring for the annular pigment checks below.
  await field('ringCrop').selectOption('annulus');
  await saveAndReload();
  assert.equal(await field('ringCrop').inputValue(),'annulus');
  await nav('review');
  await release.locator('[data-action="prepare"]').click();
  await release.locator('[data-result]').filter({hasText:'Version ready'}).waitFor();
  await release.locator('[data-action="play"]').click();
  const link=release.locator('[data-link]');
  await link.waitFor();
  const address=await link.getAttribute('href');assert.equal(new URL(address).origin,target.origin);
  const phone=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2,serviceWorkers:'block'});
  phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(address);
  await phone.waitForFunction(()=>document.documentElement.dataset.releasePractice==='ready' &&
    document.querySelector('#gameView').dataset.counterRingArt==='separate' &&
    document.querySelector('.counter-design-ring img')?.naturalWidth && document.querySelector('.counter-design-engraving img')?.naturalWidth);
  const toneBefore=await waitForPaint(phone), before=await phone.evaluate(transforms);
  assert.notEqual(before.ringSource,before.centerSource);
  const label=await phone.locator('.dial-step-plus-label').boundingBox();
  await phone.touchscreen.tap(label.x+label.width/2,label.y+label.height/2);
  await phone.waitForFunction(()=>document.querySelector('#mainValue').textContent==='41');
  await phone.evaluate(async()=>{await Promise.all(document.querySelector('.counter-design-ring').getAnimations().map(a=>a.finished));});
  const toneAfter=await waitForPaint(phone), after=await phone.evaluate(transforms);
  assert.notEqual(after.ring,before.ring);
  assert.equal(after.center,before.center);
  assert.ok(Math.hypot(toneAfter.leaf[0]-toneBefore.leaf[0],toneAfter.leaf[1]-toneBefore.leaf[1])<1.5,
    'the painted center must stay upright: '+JSON.stringify([toneBefore,toneAfter]));
  const delta=(toneAfter.angle-toneBefore.angle+540)%360-180;
  assert.ok(Math.abs(delta-12)<2,'expected a 12° painted ring step, observed '+delta);
  await phone.close();await page.bringToFront();
  await release.locator('[data-action="stop"]').click();
  await nav('symbols');await field('ringArtAsset').selectOption('');
  assert.ok(await field('artRotation').isVisible());
  assert.equal(await field('artRotation').inputValue(),'fixed');assert.ok(await field('uprightCenter').isChecked());
  await saveAndReload();
  assert.equal(await field('ringArtAsset').inputValue(),'');
  assert.equal(await field('artAsset').locator('option:checked').textContent(),centerName);
  assert.equal(await field('artRotation').inputValue(),'fixed');assert.ok(await field('uprightCenter').isChecked());
  const restored=page.frames().find(f=>f.url().includes('appearance-preview=1'));
  await restored.waitForFunction(()=>!document.querySelector('#gameView').dataset.counterRingArt &&
    document.querySelector('.counter-design-engraving img')?.naturalWidth &&
    document.querySelector('.counter-design-ring img').src===document.querySelector('.counter-design-engraving img').src);
  assert.deepEqual(errors,[]);
  console.log(engine+' passed split-ring authoring, per-counter isolation, saved reload, '+delta.toFixed(2)+'° of painted ring movement, stationary center and restored one-image behavior.');
} catch(error) {
  console.error('Studio feedback:',await page.locator('#saveState, #assetStatus, #studioReleaseEditor [data-result]').allTextContents());
  throw error;
} finally { await browser.close(); }
