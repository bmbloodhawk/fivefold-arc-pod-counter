// Exercise the standard appearance on a disposable multiplayer table. Supplying
// NEUTRAL_BASE_CLIENT also compares controls and navigation with a prior build.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';
import { settleDial } from './dial-layout.browser.mjs';

const engine = process.env.STUDIO_BROWSER || 'chromium';
const { [engine]: driver } = createRequire(process.env.PLAYWRIGHT_TOOLING || import.meta.url)('playwright-core');
const browser = await driver.launch(engine === 'chromium' && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const modes = ['life','commander','radiation','poison','energy','generic'];
const directory = process.env.STUDIO_REPORT_DIR;
const auth = await readFile(new URL('./competition-auth-fixture.mjs', import.meta.url), 'utf8');
if (directory) await mkdir(directory, { recursive: true });

async function readState(page) {
  return page.evaluate(() => {
    const game = document.querySelector('#gameView');
    const tab = document.querySelector('#modeNav button.active');
    const art = game.querySelector('.neutral-counter-art');
    const center = art && getComputedStyle(art);
    const style = getComputedStyle(tab,'::before');
    const turn = getComputedStyle(game.querySelector('#endTurnButton'));
    const selectors = ['.dial-face','.counter-readout','#mainValue','#counterContext','#modeNav',
      '#endTurnButton','.dial-step-plus','.dial-step-minus','#adjustControls',...Array.from(document.querySelectorAll('#modeNav button'), b => '[data-mode="'+b.dataset.mode+'"]')];
    const boxes = Object.fromEntries(selectors.map(selector => {
      const { x,y,width,height } = game.querySelector(selector).getBoundingClientRect();
      return [selector,[x,y,width,height]];
    }));
    return { boxes, value: +document.querySelector('#mainValue').textContent, name: document.querySelector('#counterContext').textContent,
      title: document.querySelector('#modeTitle').textContent, tab: tab.dataset.mode, label: tab.textContent.trim(),
      active: tab.getAttribute('aria-current'), angle: parseFloat(game.style.getPropertyValue('--dial-seal-rotation')),
      turnButtonStyle: [turn.backgroundColor,turn.backgroundImage,turn.borderColor,turn.color],
      seal: center && center.display !== 'none' ? center.backgroundImage : '',
      centerStyle: center && [center.backgroundSize,center.backgroundPosition,center.backgroundRepeat,center.opacity,center.transform,center.pointerEvents],
      ringTransform: getComputedStyle(game.querySelector('.dial-face'),'::after').transform,
      icon: style.content === 'none' ? '' : style.maskImage || style.webkitMaskImage,
      tabStyle: [style.width,style.height,style.maskSize,style.maskPosition,style.backgroundColor] };
  });
}

async function checkArtwork(page, mode, state) {
  const center = 'icons/neutral-counter-'+mode+'.svg', icon = 'icons/neutral-tab-'+mode+'.svg';
  assert.ok(state.seal.includes(center) && state.icon.includes(icon), 'Artwork for '+mode);
  assert.deepEqual(state.centerStyle,['contain','50% 50%','no-repeat','0.74','none','none']);
  const colored = await page.evaluate(async ([center,icon]) => {
    const [engraving] = await Promise.all([center,icon].map(async file=>{
      const image = new Image(); image.src=file; await image.decode(); return image;
    }));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.drawImage(engraving,0,0,64,64);
    const data = ctx.getImageData(0,0,64,64).data;
    // Check the decoded artwork has visible colored paint, beyond the bare mask its slot previously held.
    let chromatic = 0;
    for (let i=0;i<data.length;i+=4) {
      const r=data[i],g=data[i+1],b=data[i+2];
      if (data[i+3]>=160 && Math.max(r,g,b)-Math.min(r,g,b)>=16) chromatic++;
    }
    return chromatic;
  }, [center,icon]);
  assert.ok(colored>=8,mode+' center decoded without visible color');
}

async function run(staticDir, baseline) {
  const { server, service } = createRealtimeServer({ staticDir, appEnv: 'test', durableRecoveryEnabled: false });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, serviceWorkers:'block' });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.route('**/account-auth.js*', route => route.fulfill({contentType:'text/javascript',body:auth}));
    const page = await context.newPage(), errors = [], rasterRequests = [];
    page.on('pageerror', e=>errors.push(e.message));
    context.on('request', request=>{
      if (/\/assets\/neutral-counter-[^/]+\.webp/.test(new URL(request.url()).pathname)) rasterRequests.push(request.url());
    });
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    await page.locator('#createPodButton').tap();
    await page.locator('#createStepOneNext').tap();
    await page.locator('#createName').fill('Neve');
    await page.locator('#createStepTwoNext').tap();
    await page.locator('#createStepThreeSkip').tap();
    await page.locator('#createForm button[type=submit]').tap();
    await page.locator('#lobbyInviteCode').waitFor();
    const code = (await page.locator('#lobbyInviteCode').innerText()).trim();
    for (let seatId=1; seatId<4; seatId++) {
      const connection = service.createConnection();
      service.claimSeat(code,connection.connectionId,{seatId,name:'Player '+(seatId+1)});
    }
    await page.locator('#startGameButton').tap();
    await page.locator('#gameView').waitFor();
    const snapshots = {};
    for (const style of ['dial','button']) {
      if (style === 'button') {
        await page.locator('#moreButton').tap();
        await page.locator('#toggleInterfaceStyleButton').tap();
        if (await page.locator('#closeGameMenuButton').isVisible()) await page.locator('#closeGameMenuButton').tap();
      }
      await page.waitForFunction(s => document.querySelector('#gameView').dataset.interfaceStyle === s, style);
      for (const mode of modes) {
        await page.locator('#modeNav [data-mode="'+mode+'"]').tap();
        await settleDial(page);
        const prior = await readState(page);
        assert.equal(prior.tab, mode);
        assert.equal(prior.active, 'page');
        assert.ok(prior.name && prior.title && prior.label);
        snapshots[style+'-'+mode] = prior;
        if (!baseline) {
          await checkArtwork(page,mode,prior);
          if (directory) await page.screenshot({path:join(directory,engine+'-'+style+'-'+mode+'.png')});
        }
        async function adjust(sign) {
          if (style === 'button') return page.locator('#adjustControls [data-delta="'+sign+'"]').tap();
          const box = await page.locator('.dial-step-'+(sign>0?'plus':'minus')+'-label').boundingBox();
          await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        }
        await adjust(1);
        await page.waitForFunction(n => Number(document.querySelector('#mainValue').textContent) === n, prior.value+1);
        await settleDial(page);
        const after = await readState(page);
        assert.equal(after.angle-prior.angle,12);
        assert.equal(after.name,prior.name);
        if (!baseline) {
          assert.deepEqual(after.centerStyle,prior.centerStyle,mode+' engraving stays upright');
          if (style==='dial') assert.notEqual(after.ringTransform,prior.ringTransform,mode+' ring turns');
        }
        await adjust(-1);
        await page.waitForFunction(n=>Number(document.querySelector('#mainValue').textContent)===n,prior.value);
      }
    }
    if (!baseline) {
      const preview = await context.newPage();
      preview.on('pageerror', e=>errors.push(e.message));
      await checkSkinSwitching(preview, origin);
      await preview.close();
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(rasterRequests,[]);
    return snapshots;
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
}

async function expectTabMasks(page, family, selectedModes = modes) {
  const rows = await page.locator('#modeNav button').evaluateAll(buttons => buttons.map(button => {
    const icon = button.querySelector('svg');
    if (!icon) return null;
    const css = getComputedStyle(icon);
    return { file:css.maskImage || css.webkitMaskImage, position:css.maskPosition,
      size:css.maskSize, pigment:css.backgroundColor, display:css.display, visibility:css.visibility };
  }));
  for (const mode of selectedModes) {
    const index = modes.indexOf(mode), row = rows[index];
    const file = family === 'neutral' ? 'neutral-tab-'+mode+'.svg' : 'tabs-'+family+'.svg';
    assert.ok(row?.file.includes('icons/'+file), family+' '+mode+' tab mask');
    assert.equal(row.size, family === 'neutral' ? '100% 100%' : '600% 100%');
    assert.equal(parseFloat(row.position),index*20);
    assert.notEqual(row.pigment,'rgba(0, 0, 0, 0)');
    assert.notEqual(row.display,'none');
    assert.equal(row.visibility,'visible');
  }
}

async function checkTabFamilies(page, send, image) {
  const patterns = {dots:'ink',grid:'circuit',weave:'glass'};
  const basis = {name:'Tab design',rendererVersion:2,counterDesign:{navigationIcons:'native'}};
  for (const style of ['dial','button']) {
    await send({...basis,id:'qa-tabs-neutral'},'life',style);
    await settleDial(page);
    await expectTabMasks(page,'neutral');
    for (const [pattern,family] of Object.entries(patterns)) {
      const patterned = {...basis,canvasDesign:{pattern}};
      await send({...patterned,id:'qa-tabs-neutral-'+pattern,counterDesign:{...basis.counterDesign,nativeIconSet:'neutral'}},'life',style);
      await settleDial(page);
      await expectTabMasks(page,'neutral');
      const {boxes, value} = await readState(page);
      await send({...patterned,id:'qa-tabs-'+pattern},'life',style);
      await settleDial(page);
      await expectTabMasks(page,family);
      const current = await readState(page);
      assert.equal(current.value,value);
      for (const [selector,box] of Object.entries(boxes)) {
        // The dial layout can snap a fractional edge on repaint, notably in WebKit.
        // Use the same one-CSS-pixel bound as the pre-change geometry comparison below.
        assert.ok(box.every((v,i)=>Math.abs(v-current.boxes[selector][i])<=1),
          JSON.stringify({family,style,selector,before:box,after:current.boxes[selector]}));
      }
      if (style === 'dial') {
        // Compare painted pixels with the same transparent slot. Computed mask
        // properties alone can pass when an engine fails to paint an SVG root.
        const icons=page.locator('#modeNav button > svg');
        const before=await Promise.all(modes.map((_,i)=>icons.nth(i).screenshot()));
        const sheet=await page.addStyleTag({content:'#modeNav button > svg {background-color:transparent!important}'});
        try {
          for (const [i,mode] of modes.entries()) {
            assert.ok(!before[i].equals(await icons.nth(i).screenshot()),family+' paints '+mode);
          }
        } finally { await sheet.evaluate(node=>node.remove()); }
      }
    }
  }
  const mixed = {...basis,id:'qa-tab-overrides',canvasDesign:{pattern:'grid'},symbols:{energy:'✦'},symbolData:{poison:image},
    counterDesign:{navigationIcons:'native',nativeIconSet:'glass',modes:{energy:{icon:'configured'}}}};
  await send(mixed,'energy');
  await expectTabMasks(page,'glass',modes.filter(mode=>mode!=='poison' && mode!=='energy'));
  assert.equal(await page.locator('#modeNav [data-mode="poison"] img').getAttribute('src'),image);
  assert.equal(await page.locator('#modeNav [data-mode="energy"] span').textContent(),'✦');
  assert.equal(await page.locator('#modeNav button.active').getAttribute('aria-current'),'page');
  // Some early v2 skins recorded glyphs directly, before per-mode icon choices existed.
  await send({id:'qa-saved-glyph',name:'Saved glyph',rendererVersion:2,symbols:{energy:'✦'}},'energy');
  assert.equal(await page.locator('#modeNav [data-mode="energy"] span').textContent(),'✦');
  await expectTabMasks(page,'neutral',modes.filter(mode=>mode!=='energy'));
}

async function checkSkinSwitching(page, origin) {
  await page.goto(origin+'/index.html?appearance-preview=1');
  const [center,ring] = await page.evaluate(() => ['#16495c','#d3a45f'].map(color => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0,0,16,16);
    return canvas.toDataURL('image/png');
  }));
  async function send(skin, mode='life', style='dial', state='turn') {
    await page.evaluate(payload => window.postMessage({type:'fivefold-arc:appearance-skin',skin:payload},location.origin),
      {...skin,previewPlayers:4,previewState:state,previewMode:mode,interfaceStyle:style});
    await page.waitForFunction(([id,mode,style,state]) => {
      const root = document.documentElement.dataset;
      return (root.gameSkin || null) === id && root.previewFixture === state && root.previewMode === mode
        && document.querySelector('#gameView').dataset.interfaceStyle === style;
    },[skin.id === '__neutral_arc__' ? null : skin.id,mode,style,state]);
  }

  const inherited = '.counter-sigil', emblem = '.counter-design-emblem';
  const visible = selector => page.locator(selector).isVisible();
  // Read the painted element and its palette tint. A URL on a hidden child or
  // a mask on an otherwise empty layer would not produce the intended engraving.
  async function expectEngraving(selector, mode) {
    const painted = await page.locator(selector).evaluate(node => {
      const style = getComputedStyle(node), tint = getComputedStyle(node,'::after');
      return {background:style.backgroundImage, mask:tint.maskImage || tint.webkitMaskImage,
        tint:tint.backgroundColor, input:style.pointerEvents, svg:getComputedStyle(node.querySelector('svg')).visibility};
    });
    const path = 'icons/neutral-counter-'+mode+'.svg';
    assert.ok(await visible(selector),mode+' engraving is visible');
    assert.ok(painted.background.includes(path) && painted.mask.includes(path),mode+' engraved master and accent');
    assert.notEqual(painted.tint,'rgba(0, 0, 0, 0)',mode+' palette tint');
    assert.equal(painted.svg,'hidden');
    assert.equal(painted.input,'none');
  }

  const neutral = {id:'__neutral_arc__',name:'Neutral Arc'};
  const v1 = {id:'qa-v1',name:'Inherited legacy'};
  const v2 = {id:'qa-v2',name:'Inherited expanded',rendererVersion:2,
    counterDesign:{navigationIcons:'native',modes:{energy:{seal:'mode',accent:'#59a2bf'},poison:{seal:'none'}}}};
  await checkTabFamilies(page,send,center);
  for (const style of ['dial','button']) {
    for (const mode of modes) {
      await send(v1,mode,style);
      await expectEngraving(inherited,mode);
      assert.equal((await readState(page)).icon,'');
      await expectTabMasks(page,'neutral',[mode]);
    }
    await send(v2,'commander',style);
    await expectEngraving(inherited,'commander');
    await send(v2,'energy',style);
    await expectEngraving(emblem,'energy');
    assert.equal(await visible(inherited),false);
    assert.equal(await page.locator(emblem).evaluate(node=>getComputedStyle(node,'::after').backgroundColor),'rgb(89, 162, 191)');
    await send(v2,'poison',style);
    assert.equal(await visible(inherited),false,'the author hid this seal');
    assert.equal(await page.locator(emblem).count(),0);
    await send(v2,'generic',style);
    await expectEngraving(inherited,'generic');
    await expectTabMasks(page,'neutral',['generic']);
  }

  const custom = {id:'qa-illustrated',name:'Custom artwork',rendererVersion:2,
    sealData:center, symbolData:{life:center}, buttonData:ring, counterArtData:{life:ring}};
  await send(custom,'life','button');
  assert.equal(await page.locator(inherited+' > img').getAttribute('src'),center);
  assert.equal(await page.locator(inherited).evaluate(node=>getComputedStyle(node).backgroundImage),'none');
  assert.equal(await page.locator('.counter-design-face > img').getAttribute('src'),ring);
  assert.equal(await page.locator('#modeNav button.active > img').getAttribute('src'),center);
  assert.ok(await page.locator('#endTurnButton').evaluate((node,image)=>getComputedStyle(node).backgroundImage.includes(image),ring));

  const separate = {id:'qa-split',name:'Independent ring',rendererVersion:2,
    counterDesign:{modes:{life:{ringArtAsset:'polar',ringCrop:'full',seal:'none'},commander:{ringArtAsset:'polar',seal:'none'}}},
    counterArtData:{life:center,commander:center},counterRingArtData:{life:ring,commander:ring}};
  const ringNode = page.locator('.counter-design-ring'), centerNode = page.locator('.counter-design-engraving');
  for (const style of ['dial','button']) {
    for (const mode of ['life','commander']) {
      await send(separate,mode,style);
      const full = mode === 'life';
      const mask = await ringNode.evaluate(node=>getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage);
      const clip = await centerNode.evaluate(node=>getComputedStyle(node).clipPath);
      assert.equal(await page.locator('#gameView').getAttribute('data-counter-ring-crop'),full ? 'full' : null);
      assert.equal(await ringNode.locator('img').getAttribute('src'),ring);
      assert.equal(await centerNode.locator('img').getAttribute('src'),center);
      if (full) { assert.equal(mask,'none'); assert.equal(clip,'none'); }
      else { assert.match(mask,/radial-gradient/); assert.match(clip,/^circle\(/); }
    }
    await send(separate,'radiation',style);
    assert.equal(await ringNode.count(),0);
    assert.equal(await centerNode.count(),0);
    assert.equal(await page.locator('#gameView').getAttribute('data-counter-ring-art'),null);
    assert.equal(await page.locator('#gameView').getAttribute('data-counter-ring-crop'),null);
    await expectEngraving(inherited,'radiation');
  }

  let forcedColorsActive = false;
  for (const skin of [neutral,v1,v2]) {
    const mode = skin === v2 ? 'energy' : 'life';
    const layer = skin === neutral ? '.neutral-counter-art' : skin === v1 ? inherited : emblem;
    await send(skin,mode,'dial','eliminated');
    assert.ok(await visible('#lethalMark'));
    assert.equal(await visible(layer),false,'lethal mark takes precedence for '+skin.id);
    await send(skin,mode);
    assert.ok(await visible(layer));
    await page.emulateMedia({forcedColors:'active'});
    forcedColorsActive = await page.evaluate(()=>matchMedia('(forced-colors: active)').matches);
    if (forcedColorsActive) {
      assert.equal(await visible(layer),false,'forced colors clears '+skin.id+' decoration');
      assert.ok(await visible('#mainValue'));
      assert.ok(await visible('#modeNav button.active'));
      const highContrast = await page.locator('#modeNav button.active').evaluate((button,native) => {
        const css = native ? getComputedStyle(button,'::before') : getComputedStyle(button.querySelector('svg'));
        const probe=document.createElement('i');
        probe.style.cssText='color:ButtonText;forced-color-adjust:none';
        document.body.append(probe);
        const systemInk=getComputedStyle(probe).color;
        probe.remove();
        return [css.backgroundColor,systemInk,CSS.supports('forced-color-adjust','none'),css.getPropertyValue('forced-color-adjust')];
      },skin===neutral);
      assert.equal(highContrast[0],highContrast[1]);
      if (highContrast[2]) assert.equal(highContrast[3],'none');
    }
    await page.emulateMedia({forcedColors:null});
    assert.ok(await visible(layer));
  }
  console.log(engine+(forcedColorsActive?' verified native, inherited and mode-emblem forced colors.':' does not expose active forced colors in this browser.'));

  await send(neutral,'radiation');
  for (const [treatment,family] of [['grid','circuit'],['inlay','ink'],['glass','glass'],['weave','neutral']]) {
    await page.evaluate(async treatment => {
      const {applyCollectionVisual} = await import('./collection-visual.js');
      applyCollectionVisual(document.documentElement,{schemaVersion:1,treatment,background:'#111111',surface:'#222222',accent:'#ffbb66',text:'#ffffff',muted:'#cccccc',border:'#bbbbbb'});
    },treatment);
    assert.equal(await page.locator('html').getAttribute('data-collection-treatment'),treatment);
    await expectTabMasks(page,family);
  }
  await expectEngraving(inherited,'radiation');
  assert.equal((await readState(page)).icon,'');
  assert.ok(await visible('#modeNav button.active > svg'));
  await send({id:'qa-collection-reward',name:'Collection palette and chosen family',rendererVersion:2,
    counterDesign:{navigationIcons:'native',nativeIconSet:'ink'}},'radiation');
  await page.evaluate(async () => {
    const {applyCollectionVisual}=await import('./collection-visual.js');
    applyCollectionVisual(document.documentElement,{schemaVersion:1,treatment:'grid',background:'#111111',surface:'#222222',accent:'#ffbb66',text:'#ffffff',muted:'#cccccc',border:'#bbbbbb'});
  });
  await expectTabMasks(page,'ink');
  const authoredSprite = await page.evaluate(async () => {
    const {applyCollectionVisual} = await import('./collection-visual.js');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const icons = 'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="24"><rect width="144" height="24" fill="gold"/></svg>');
    applyCollectionVisual(document.documentElement,{schemaVersion:1,treatment:'glass',background:'#111111',surface:'#222222',accent:'#ffbb66',text:'#ffffff',muted:'#cccccc',border:'#bbbbbb'},
      {backdrop:canvas.toDataURL('image/jpeg'),bezel:canvas.toDataURL('image/png'),icons});
    return icons;
  });
  const sprite = await page.locator('#modeNav button.active').evaluate(button => {
    const art = getComputedStyle(button,'::after'), fallback = getComputedStyle(button.querySelector('svg'));
    return [art.backgroundImage, art.backgroundPosition, fallback.visibility, fallback.maskImage];
  });
  assert.ok(sprite[0].includes(authoredSprite));
  assert.equal(parseFloat(sprite[1]),40);
  assert.deepEqual(sprite.slice(2),['hidden','none']);
  await send(neutral,'radiation');
  await page.evaluate(async () => {
    const {applyCollectionVisual} = await import('./collection-visual.js');
    applyCollectionVisual(document.documentElement,null);
    document.documentElement.setAttribute('data-private-skin-review','');
  });
  const privateReview = await readState(page);
  assert.ok(privateReview.seal.includes('icons/neutral-counter-radiation.svg'));
  assert.equal(privateReview.icon,'');
  assert.ok(await visible('#modeNav button.active > svg'),'unselected private review retains its original navigation');
}

try {
  const current = await run(fileURLToPath(new URL('../client/', import.meta.url)), false);
  if (process.env.NEUTRAL_BASE_CLIENT) {
    const original = await run(process.env.NEUTRAL_BASE_CLIENT, true);
    for (const [key, state] of Object.entries(current)) {
      for (const [selector, rect] of Object.entries(state.boxes)) {
        assert.ok(rect.every((x,i) => Math.abs(x-original[key].boxes[selector][i]) <= 1),key+' '+selector+' moved');
      }
      for (const field of ['value','name','title','label','tab','angle']) assert.equal(state[field],original[key][field]);
      assert.deepEqual(state.turnButtonStyle,original[key].turnButtonStyle,key+' turn button appearance');
      if (original[key].icon.includes('/neutral-tab-')) {
        assert.deepEqual(state.tabStyle,original[key].tabStyle,key+' tab style');
        assert.ok(original[key].icon.includes('/neutral-tab-'+state.tab+'.svg'),key+' original tab artwork');
      }
    }
  }
  console.log(engine+' passed six counters in Dial and Button, real +/− taps, inherited and authored centers, navigation, full and cropped rings, collection, private review and lethal states'+(process.env.NEUTRAL_BASE_CLIENT?', including pre-change button style and control geometry.':'.'));
} finally { await browser.close(); }
