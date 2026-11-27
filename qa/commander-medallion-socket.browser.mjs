// Verify real Prismatic seat materials, engraved art and native dial fitting.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';
import { loadNightWatchSkin, loadPrismaticConfluenceSkin } from '../server/src/bundled-reward-skins.js';

const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json',import.meta.url));
const engine = process.env.STUDIO_BROWSER || 'chromium';
const driver = require('playwright-core')[engine];
const skin = (await loadPrismaticConfluenceSkin()).bundledAppearance;
const oldSkin = (await loadNightWatchSkin()).bundledAppearance;
const { server } = createRealtimeServer({
  staticDir: fileURLToPath(new URL('../client',import.meta.url)), appEnv: 'test',
  appearanceCatalog: { read: async () => ({ schemaVersion:1, revision:0, skins:[], assets:[] }) },
  durableRecoveryEnabled:false, autoRecoverRooms:false,
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await driver.launch({ headless: true, ...(engine === 'chromium' && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport:{width:393,height:852}, serviceWorkers:'block', reducedMotion:'reduce' });
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.route('**/*',route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/index.html?appearance-preview=1');
  const navigation = await page.evaluate(() => performance.timeOrigin);
  const send = async (appearance, mode = 'life', style = 'dial', players = 4) => {
    await page.evaluate(skin => window.postMessage({type:'fivefold-arc:appearance-skin',skin},location.origin),
      {...appearance, previewState:'turn', previewMode:mode, interfaceStyle:style, previewPlayers:players, previewCommanderColors:['U','R'], useGameBase:true});
    await page.waitForFunction(([id,mode,style,players]) => {
      const root = document.documentElement, game = document.querySelector('#gameView');
      return root.dataset.gameSkin === id && root.dataset.previewPlayers === String(players) && game.dataset.counterMode === mode && game.dataset.interfaceStyle === style;
    }, [appearance.id,mode,style,players]);
  };
  const sizes = [[393,852],[320,700],[1280,900],[844,390],[393,852]];
  const reportDir = process.env.STUDIO_REPORT_DIR;
  if (reportDir) await mkdir(reportDir,{recursive:true});
  let checks = 0, maxOffset = 0;
  const rotations = new Set();
  function measure() {
    const face = document.querySelector('.dial-face'), rotor = document.querySelector('.counter-design-face');
    const box = face.getBoundingClientRect(), metal = rotor.getBoundingClientRect();
    const layers = [[face,'::before'],[face,'::after'],[face.parentElement,'::after']].map(([host,which]) => {
      const css = getComputedStyle(host,which), rect = host.getBoundingClientRect();
      const width = parseFloat(css.width), height = parseFloat(css.height);
      return { x:rect.x + parseFloat(css.left) + width / 2, y:rect.y + parseFloat(css.top) + height / 2,
        width, height, content:css.content, transform:css.transform, pointer:css.pointerEvents };
    });
    return { faceWidth:box.width, metalWidth:parseFloat(getComputedStyle(rotor).width),
      x:metal.x + metal.width / 2, y:metal.y + metal.height / 2, layers,
      angle:getComputedStyle(rotor).transform, documentWidth:document.documentElement.scrollWidth, navigation:performance.timeOrigin };
  }
  for (const style of ['dial','button']) {
    for (const mode of ['life','commander','radiation','poison','energy','generic']) {
      await send(skin, mode, style, mode === 'commander' ? 8 : 4);
      for (const [width,height] of sizes) {
        await page.setViewportSize({width,height});
        await page.waitForFunction(([w,h]) =>
          Math.abs(visualViewport.width - w) < 2 &&
          Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-height')) - h) < 2 &&
          document.documentElement.scrollWidth <= w + 1, [width,height], { timeout: 5000 });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); });
        const sample = await page.evaluate(measure);
        const [stone,cut,contact] = sample.layers;
        assert.equal(sample.navigation,navigation);
        assert.ok(sample.documentWidth <= width + 1, JSON.stringify({style,mode,width,height,sample}));
        for (const layer of sample.layers) {
          assert.notEqual(layer.content,'none'); assert.equal(layer.transform,'none'); assert.equal(layer.pointer,'none');
          assert.ok(Math.abs(layer.width - layer.height) < .1);
          const delta = Math.max(Math.abs(layer.x - sample.x),Math.abs(layer.y - sample.y));
          // WebKit snaps the transformed image bounds to its compositing pixels.
          assert.ok(delta <= 1, JSON.stringify({style,mode,width,height,delta,sample}));
          maxOffset = Math.max(maxOffset,delta);
        }
        assert.ok(Math.abs(stone.width - sample.faceWidth) < .1 && stone.width > cut.width && cut.width > contact.width);
        assert.ok(Math.abs(contact.width - sample.metalWidth) < .1);
        assert.ok((stone.width - contact.width) / 2 <= 14.1);
        if (style === 'dial') rotations.add(sample.angle);
        if (reportDir && mode === 'life' && [393,1280].includes(width)) {
          await page.screenshot({path:resolve(reportDir,`socket-${engine}-${style}-${width}.png`)});
        }
        checks++;
      }
    }
  }
  assert.ok(rotations.size >= 2, 'Native life and auxiliary counter rotations should differ.');
  const engraved = {...skin,id:'upright-center-test',counterDesign:{...skin.counterDesign,modes:{
    ...skin.counterDesign.modes,life:{...skin.counterDesign.modes.life,uprightCenter:true}
  }}};
  await send(engraved);
  const face = page.locator('.dial-face');
  await page.waitForFunction(() => {
    const ring = document.querySelector('.counter-design-ring img'), center = document.querySelector('.counter-design-engraving img');
    return document.querySelector('#gameView').dataset.glassDialReady === 'UR' && center?.naturalWidth && ring?.src === center.src;
  });
  const photos = [];
  for (const angle of ['0deg','120deg']) {
    await page.locator('#gameView').evaluate((game,value) => game.style.setProperty('--counter-art-rotation',value),angle);
    photos.push((await face.screenshot({scale:'css'})).toString('base64'));
  }
  const paint = await page.evaluate(async photos => {
    const frames = await Promise.all(photos.map(async data => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image,0,0);
      return context.getImageData(0,0,image.width,image.height);
    }));
    const [a,b] = frames, count = [0,0], changed = [0,0];
    for (let y=0; y<a.height; y++) for (let x=0; x<a.width; x++) {
      const radius = Math.hypot(x+.5-a.width/2,y+.5-a.height/2) / a.width;
      const zone = radius < .235 ? 0 : radius > .32 && radius < .42 ? 1 : -1;
      if (zone < 0) continue;
      count[zone]++;
      const i = 4*(y*a.width+x);
      if ([0,1,2].some(channel=>Math.abs(a.data[i+channel]-b.data[i+channel])>4)) changed[zone]++;
    }
    return {center:changed[0]/count[0], ring:changed[1]/count[1]};
  },photos);
  assert.ok(paint.center < .001 && paint.ring > .1, JSON.stringify(paint));
  await page.locator('#gameView').evaluate(game => game.style.removeProperty('--counter-art-rotation'));
  for (const scale of [70,130]) {
    const modes = { ...skin.counterDesign.modes, life:{...skin.counterDesign.modes.life,artScale:scale} };
    await send({...skin,id:'socket-scale-'+scale,counterDesign:{...skin.counterDesign,modes}});
    const sample = await page.evaluate(measure);
    assert.ok(Math.abs(sample.layers[0].width - Math.min(1,scale/100) * sample.faceWidth) < .1);
    assert.ok(Math.abs(sample.layers[2].width - sample.metalWidth) < .1);
  }
  const boxes = await page.evaluate(() => {
    const game = document.querySelector('#gameView');
    const controls = [...game.querySelectorAll('#dialGesture, .dial-step, .dial-step-label, #mainValue, #endTurnButton')];
    const targets = () => controls.map(node => {
      const box = node.getBoundingClientRect();
      return [box.x,box.y,box.width,box.height,getComputedStyle(node).clipPath];
    });
    const withSocket = targets();
    delete game.dataset.glassMedallion;
    const withoutSocket = targets();
    game.dataset.glassMedallion = 'true';
    return {withSocket,withoutSocket};
  });
  assert.deepEqual(boxes.withSocket,boxes.withoutSocket);
  // Remove only the one body painting. Sample inside all eight buttons, clear
  // of their type and borders: glass must reveal it and solid metal must not.
  for (const seatTreatment of ['glass','raised']) {
    await send({...skin,id:'seat-material-'+seatTreatment,seatTreatment,seatOpacity:65,seatBlur:0,backgroundScale:100},'life','dial',8);
    await page.waitForFunction(() => document.querySelector('#gameView').dataset.glassHallReady === 'UR');
    const patches = await page.locator('.pod-seat').evaluateAll(seats => seats.map(seat => {
      const rect = seat.getBoundingClientRect();
      return {x:Math.ceil(rect.left+8), y:Math.round(rect.top+rect.height*.45),width:5,height:5};
    }));
    assert.equal(patches.length,8);
    const before = [];
    for (const clip of patches) before.push(await page.screenshot({clip,scale:'css'}));
    const hideHall = await page.addStyleTag({content:'html.game-skin-active { --prism-rendered-hall: none !important; }'});
    for (const [index,clip] of patches.entries()) {
      const after = await page.screenshot({clip,scale:'css'});
      assert.equal(after.equals(before[index]),seatTreatment === 'raised',seatTreatment+' seat '+(index+1));
    }
    await hideHall.evaluate(sheet => sheet.remove());
  }
  for (const comparison of [{...skin,id:'without-counter-art',counterArtData:{}},oldSkin]) {
    await send(comparison);
    assert.equal(await page.locator('#gameView[data-glass-medallion]').count(),0);
    assert.equal(await page.locator('.dial-assembly').evaluate(node => getComputedStyle(node,'::after').content),'none');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine,checks,maxCenterOffsetCssPx:maxOffset,rotations:rotations.size,rotatedPixelFractions:paint}));
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
