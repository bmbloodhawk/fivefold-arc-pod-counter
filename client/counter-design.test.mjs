import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeDraftIcons, usesNativeCounterIcon, nativeTabSet, counterDesignFor, counterDesignSpec, counterArtDataSpec, createCounterDesignRenderer } from './counter-design.js';
import { updateCounterDesign } from './counter-design-editor.js';
import { validateAppearanceSkin, publicAppearanceSkin } from './appearance-validation.js';
import { rendererDocument } from './test-support/renderer-document.mjs';
import { createCommanderGlass } from './commander-glass.js';
import { appearanceReadability } from './appearance-readability.js';

test('authored glyphs and per-mode overrides keep precedence over inherited navigation', () => {
  const source = {id:'saved',rendererVersion:2,symbols:{radiation:'☢'},counterDesign:{modes:{energy:{icon:'configured'}}}};
  assert.equal(usesNativeCounterIcon(source,'radiation'),false);
  assert.equal(usesNativeCounterIcon(source,'life'),true);
  assert.equal(usesNativeCounterIcon({...source,counterDesign:{navigationIcons:'configured'}},'life'),false);
  const draft = nativeDraftIcons(source);
  assert.equal(usesNativeCounterIcon(draft,'radiation'),true);
  assert.equal(usesNativeCounterIcon(draft,'energy'),false);
  assert.equal(source.counterDesign.navigationIcons,undefined);
  assert.equal(usesNativeCounterIcon({id:'__neutral_arc__'},'radiation'),true);
  assert.equal(usesNativeCounterIcon({id:'legacy'},'radiation'),true);
  assert.equal(usesNativeCounterIcon({...draft,counterDesign:{...draft.counterDesign,modes:{radiation:{icon:'configured'}}}},'radiation'),false);
});

test('tab artwork follows the canvas pattern until the Studio fixes a set', () => {
  const skin = {id:'sample',name:'Sample',rendererVersion:2};
  for (const [pattern,expected] of [['dots','ink'],['weave','glass'],['grid','circuit'],['none','neutral']]) {
    assert.equal(nativeTabSet({...skin,canvasDesign:{pattern}}),expected);
  }
  for (const nativeIconSet of ['neutral','ink','glass','circuit']) {
    const draft = {...skin,canvasDesign:{pattern:'grid'},counterDesign:{nativeIconSet}};
    assert.deepEqual(validateAppearanceSkin(draft).errors,[]);
    assert.equal(nativeTabSet(publicAppearanceSkin(draft)),nativeIconSet);
  }
  const invalid = {...skin,counterDesign:{nativeIconSet:'other'}};
  assert.ok(validateAppearanceSkin(invalid).errors.length);
  assert.equal(publicAppearanceSkin(invalid).counterDesign.nativeIconSet,undefined);
  assert.ok(validateAppearanceSkin({...skin,rendererVersion:1,counterDesign:{nativeIconSet:'glass'}}).errors.length);
});

test('per-counter art is sparse, mode-specific, bounded and cosmetic only', () => {
  const skin={rendererVersion:2,counterDesign:{modes:{radiation:{accent:'#66dd88',surface:'#102118',text:'#effaf0',face:'radial',markings:'ticks',seal:'mode',artOpacity:999,artScale:0,life:500,selector:'body'},energy:{face:'faceted'}}},counterArtData:{radiation:'verified',energy:'https://unsafe.invalid'}};
  const radiation=counterDesignFor(skin,'radiation',value=>value==='verified'?value:'');
  assert.equal(radiation.accent,'#66dd88');
  assert.equal(radiation.art,'verified');
  assert.equal(radiation.artOpacity,.55);
  assert.equal(radiation.artScale,.7);
  assert.equal(radiation.life,undefined);
  assert.equal(radiation.selector,undefined);
  assert.equal(counterDesignFor(skin,'life'),null);
  assert.equal(counterDesignFor(skin,'energy').art,'');
  assert.equal(counterDesignFor(skin,'energy').accent,undefined);
});

test('canonical Neutral, v1 and absent configuration do not activate new dial art', () => {
  const counterDesign={modes:{radiation:{face:'radial',seal:'mode'}}};
  assert.equal(counterDesignFor({id:'__neutral_arc__',rendererVersion:2,counterDesign},'radiation'),null);
  assert.equal(counterDesignFor({id:'v1',counterDesign},'radiation'),null);
  assert.equal(counterDesignFor({rendererVersion:2},'radiation'),null);
  assert.equal(counterDesignFor({rendererVersion:2,counterDesign},'constructor'),null);
});

test('expanded skins can attach sockets and choose how the face and center move', () => {
  const draft = {id:'engraving', name:'Engraving', rendererVersion:2, tableDesign:{dialSocket:'metal'},
    counterDesign:{modes:{life:{uprightCenter:true, artRotation:'fixed'}}}};
  const art = {counterArtData:{life:'approved'}};
  const accept = value => value === 'approved' ? value : '';
  assert.deepEqual(validateAppearanceSkin(draft).errors,[]);
  assert.deepEqual(publicAppearanceSkin(draft).counterDesign,draft.counterDesign);
  const face = counterDesignFor({...draft,...art},'life',accept);
  assert.deepEqual([face.uprightCenter,face.artRotation,face.socket],[true,'fixed','metal']);
  assert.equal(counterDesignFor(draft,'poison',accept).socket,'metal');
  assert.equal(counterDesignFor(draft,'life',accept).uprightCenter,undefined);
  const prism = {...draft, ...art, commanderTreatment:'prismatic-glass'};
  assert.equal(counterDesignFor({...prism,tableDesign:{}},'life',accept).socket,'stone');
  assert.equal(counterDesignFor({...prism,tableDesign:{dialSocket:'none'}},'life',accept).socket,undefined);
  assert.ok(validateAppearanceSkin({...draft,rendererVersion:1}).errors.length);
  assert.ok(validateAppearanceSkin({...draft,tableDesign:{dialSocket:'arbitrary'}}).errors.length);
  assert.ok(validateAppearanceSkin({...draft,counterDesign:{modes:{life:{artRotation:37}}}}).errors.length);
});

test('schema exports allow only known counter modes and fixed visual choices', () => {
  assert.equal(counterDesignSpec.type,'object');
  assert.deepEqual(Object.keys(counterArtDataSpec.fields),['life','commander','radiation','poison','energy','generic']);
  assert.equal(counterDesignSpec.fields.modes.fields.radiation.fields.artAsset.type,'id');
  assert.deepEqual(counterDesignSpec.fields.modes.fields.radiation.fields.face.values,['native','rings','radial','faceted']);
  assert.equal(counterDesignSpec.fields.modes.fields.radiation.fields.css,undefined);
});

test('separate ring art requires a v2 assignment and verified raster for this counter', () => {
  const skin = {id:'test-ring',name:'Ring',rendererVersion:2,counterRingArtData:{life:'safe-ring',poison:'untrusted'}};
  const safe = value => value === 'safe-ring' ? value : '';
  assert.equal(counterDesignFor(skin,'life',safe),null);
  const withRing = {...skin,counterDesign:{modes:{life:{ringArtAsset:'dial-band'},poison:{ringArtAsset:'poison-band'}}}};
  assert.equal(counterDesignFor(withRing,'life',safe).ringArt,'safe-ring');
  assert.equal(counterDesignFor(withRing,'poison',safe),null);
  assert.equal(counterDesignFor({...withRing,rendererVersion:1},'life',safe),null);
  assert.equal(counterDesignFor({...skin,counterDesign:{modes:{life:{ringArtAsset:'https://site.invalid'}}}},'life',safe),null);
  const saved = {id:'test-ring',name:'Ring',rendererVersion:2,counterDesign:withRing.counterDesign};
  assert.deepEqual(validateAppearanceSkin(saved).errors,[]);
  assert.deepEqual(publicAppearanceSkin(saved).counterDesign,saved.counterDesign);
  assert.ok(validateAppearanceSkin({...saved,rendererVersion:1}).errors.some(issue=>issue.path === 'skin.counterDesign.modes.life' && issue.message.includes('ringArtAsset')));
});

test('a separate rotating ring stays outside the commander painter across pending decodes, replacement and removal', async () => {
  const { document, game } = rendererDocument();
  const face = document.createElement('div');
  game.append(face);
  const query = document.querySelector;
  document.querySelector = selector => selector === '.dial-face' ? face : query(selector);
  document.defaultView = {URL:{createObjectURL:key=>'blob:'+key,revokeObjectURL(){}}};
  const pending = new Map();
  const glass = createCommanderGlass(document,()=>({owner:'P1',viewed:'P1',seats:{P1:['U']}}),
    async (_, source) => ({render:()=>new Promise(done=>pending.set(source,done))}));
  const renderer = createCounterDesignRenderer(document,{safeImage:value=>typeof value === 'string' ? value : ''});
  const split = {id:'dial',rendererVersion:2,commanderTreatment:'prismatic-glass',counterRingArtData:{life:'ring-one',energy:'ring-only'},
    counterArtData:{life:'center-one'},counterDesign:{modes:{
      life:{ringArtAsset:'band',artRotation:'fixed',uprightCenter:true},energy:{ringArtAsset:'other-band'}}}};
  const render = (skin,mode) => {
    const center = renderer.refresh(skin,mode);
    glass.refresh('',center);
    return center;
  };
  const ringImage = () => face.childNodes.find(node=>node.classList.contains('counter-design-face')).childNodes[0].childNodes[0];
  const frame = () => new Promise(done=>setImmediate(done));
  const first = render(split,'life');
  assert.equal(first.node.parentNode.className,'counter-design-engraving');
  assert.equal(first.node.hidden,true);
  assert.equal(first.engraving,undefined);
  assert.equal(game.dataset.counterRingArt,'separate');
  assert.equal(game.dataset.counterArtRotation,undefined);
  assert.equal(ringImage().src,'ring-one');
  await frame();
  const next = {...split,counterArtData:{life:'center-two'},counterRingArtData:{life:'ring-two',energy:'ring-only'}};
  const second = render(next,'life');
  await frame();
  pending.get('center-one')('old'); pending.get('center-two')('ready');
  await frame();
  assert.equal(second.node.getAttribute('src'),'blob:ready');
  assert.equal(ringImage().src,'ring-two');
  assert.equal(ringImage().hasAttribute('src'),false,'The asynchronous painter never wrote to the ring.');
  assert.equal(render(next,'energy'),null);
  assert.equal(ringImage().src,'ring-only');
  assert.ok(!face.childNodes.some(node=>node.classList.contains('counter-design-engraving')));
  const legacy = render({...next,counterRingArtData:{}},'life');
  assert.equal(game.dataset.counterRingArt,undefined);
  assert.equal(game.dataset.counterArtRotation,'fixed');
  assert.ok(legacy.engraving);
  assert.equal(legacy.node.parentNode.classList.contains('counter-design-ring'),true);
  glass.clear();
  renderer.clear();
  assert.equal(face.childNodes.length,0);
});

test('the full ring crop applies only to the assigned, verified ring in its own mode', () => {
  const skin = {id:'instrument', name:'Instrument', rendererVersion:2, counterDesign:{modes:{
    life:{ringArtAsset:'polar',ringCrop:'full'}, commander:{ringArtAsset:'etched',ringCrop:'annulus'},
    energy:{ringArtAsset:'missing',ringCrop:'full'}, generic:{ringCrop:'full'},
  }}, counterRingArtData:{life:'verified',commander:'verified',energy:'unverified',generic:'verified'}};
  const accept = value => value === 'verified' ? value : '';
  const {counterDesign, ...base} = skin;
  assert.deepEqual(validateAppearanceSkin({id:skin.id,name:skin.name,rendererVersion:2,counterDesign}).errors,[]);
  assert.equal(publicAppearanceSkin(skin).counterDesign.modes.life.ringCrop,'full');
  assert.equal(counterDesignFor(skin,'life',accept).ringCrop,'full');
  assert.equal(counterDesignFor(skin,'commander',accept).ringCrop,undefined);
  assert.equal(counterDesignFor(skin,'energy',accept),null);
  assert.equal(counterDesignFor(skin,'generic',accept),null);
  const malformed = {...base,counterDesign:{modes:{life:{ringArtAsset:'polar',ringCrop:'stretch'}}}};
  assert.equal(counterDesignFor(malformed,'life',accept).ringCrop,undefined);
  assert.ok(validateAppearanceSkin(malformed,{preview:true}).errors.some(error=>error.path.endsWith('.ringCrop')));
});

test('the full-strength allowance follows the protected backing on each individual face', () => {
  const skin = {id:'contrast-study', name:'Contrast study', rendererVersion:2,
    counterDesign:{modes:{life:{artOpacity:95,captionBacking:'surface'}, poison:{artOpacity:56}}}};
  const findings = validateAppearanceSkin(skin).errors;
  assert.ok(findings.some(issue=>issue.path === 'skin.counterDesign.modes.poison.artOpacity'));
  assert.ok(!findings.some(issue=>issue.path === 'skin.counterDesign.modes.life.artOpacity'));
  assert.equal(counterDesignFor({...skin,counterArtData:{life:'image'}},'life',value=>value).artOpacity,.95);
  assert.equal(counterDesignFor({...skin,counterArtData:{poison:'image'}},'poison',value=>value).artOpacity,.55);
});

test('counter editor clears only the chosen visual override and retains other modes and icon intent', () => {
  const skin={id:'draft',life:40,counterDesign:{navigationIcons:'native',modes:{radiation:{accent:'#99ee77',icon:'configured'},poison:{face:'rings'}}}};
  updateCounterDesign(skin,'radiation','accent',null);
  assert.deepEqual(skin.counterDesign.modes.radiation,{icon:'configured'});
  assert.deepEqual(skin.counterDesign.modes.poison,{face:'rings'});
  updateCounterDesign(skin,'radiation','icon',null);
  assert.equal(skin.counterDesign.modes.radiation,undefined);
  assert.equal(skin.counterDesign.navigationIcons,'native');
  assert.equal(skin.life,40);
});

test('the real shared boundary rejects arbitrary counter artwork and unsafe nested fields', () => {
  const skin={id:'draft',name:'Counter study',status:'Draft',rendererVersion:2,counterDesign:{navigationIcons:'native',modes:{radiation:{accent:'#99ee77',face:'radial',artAsset:'approved-dial'}}}};
  assert.deepEqual(publicAppearanceSkin(skin).counterDesign,skin.counterDesign);
  assert.equal(validateAppearanceSkin(skin).errors.length,0);
  assert.ok(validateAppearanceSkin({...skin,counterDesign:{modes:{radiation:{face:'url(javascript:x)'}}}}).errors.length);
  assert.ok(validateAppearanceSkin({...skin,counterArtData:{radiation:'https://unsafe.invalid/a.png'}},{preview:true}).errors.length);
  assert.ok(validateAppearanceSkin({...skin,counterDesign:{modes:{radiation:{life:999}}}}).errors.length);
});

test('switching away from a designed counter removes decorations and scoped colors', () => {
  const fixture=rendererDocument(), face=fixture.document.createElement('div');
  fixture.game.append(face);
  const query=fixture.document.querySelector;
  fixture.document.querySelector=selector=>selector==='.dial-face'?face:query(selector);
  const renderer=createCounterDesignRenderer(fixture.document,{safeImage:value=>value==='raster'?value:''});
  const skin={rendererVersion:2,counterDesign:{modes:{radiation:{text:'#efffee',face:'radial',markings:'ticks',seal:'none'}}},counterArtData:{radiation:'raster'}};
  renderer.refresh(skin,'radiation');
  assert.equal(fixture.game.dataset.counterFace,'radial');
  assert.equal(fixture.game.properties.get('--counter-design-text'),'#efffee');
  assert.equal(face.childNodes.length,2);
  assert.equal(face.childNodes[0].getAttribute('aria-hidden'),'true');
  renderer.refresh(skin,'life');
  assert.equal(face.childNodes.length,0);
  assert.equal(fixture.game.dataset.counterDesign,undefined);
  assert.equal(fixture.game.properties.get('--counter-design-text'),undefined);
  assert.match(fixture.seal.innerHTML,/<svg>/,'The native seal DOM is never replaced.');
});

test('publication readability names a low-contrast counter-specific value and label', () => {
  const skin={rendererVersion:2,background:'#080808',surface:'#161616',text:'#ffffff',muted:'#dddddd',accent:'#ffdd99',counterDesign:{modes:{radiation:{text:'#ffffff',accent:'#eeeeee',surface:'#ffffff'}}}};
  const findings=appearanceReadability(skin);
  assert.ok(findings.some(item=>item.severity==='error'&&item.path==='counterDesign.modes.radiation.text'));
  assert.ok(findings.some(item=>item.severity==='error'&&item.path==='counterDesign.modes.radiation.accent'));
});

test('caption plates are explicit and use validated palette colors without changing numeric ink',()=>{
  const skin={rendererVersion:2,surface:'#f9f1da',text:'#29251e',accent:'#704025',counterDesign:{modes:{life:{captionBacking:'surface'}}}};
  const design=counterDesignFor(skin,'life');
  assert.equal(design.captionSurface,'#f9f1da');assert.equal(design.captionText,'#29251e');assert.equal(design.captionAccent,'#704025');
  assert.equal(design.text,undefined);
  assert.equal(counterDesignFor({...skin,counterDesign:{modes:{life:{captionBacking:'native'}}}},'life'),null);
  assert.equal(counterDesignFor({...skin,rendererVersion:1},'life'),null);
  const tokenOnly=counterDesignFor({rendererVersion:2,tokens:{color:{surface:'#eeddcc',text:'#221100',accentPrimary:'#663322'}},counterDesign:{modes:{life:{captionBacking:'surface'}}}},'life');
  assert.equal(tokenOnly.captionSurface,'#eeddcc');assert.equal(tokenOnly.captionText,'#221100');assert.equal(tokenOnly.captionAccent,'#663322');
});

test('compact caption plates retain the normal artwork limit and validate label contrast', () => {
  const skin = {id:'notebook',name:'Notebook',rendererVersion:2,surface:'#f9f1da',text:'#29251e',accent:'#704025',
    counterDesign:{modes:{life:{captionBacking:'compact',artOpacity:55}}}};
  assert.deepEqual(validateAppearanceSkin(skin).errors,[]);
  assert.deepEqual(publicAppearanceSkin(skin).counterDesign,skin.counterDesign);
  const design = counterDesignFor(skin,'life');
  assert.equal(design.captionBacking,'compact');
  assert.equal(design.captionSurface,skin.surface);
  assert.equal(design.captionText,skin.text);
  assert.equal(design.captionAccent,skin.accent);
  assert.equal(design.text,undefined);
  assert.ok(appearanceReadability({...skin,text:skin.surface}).some(finding=>
    finding.path==='counterDesign.modes.life.text' && finding.severity==='error'));
  const old = {...skin,rendererVersion:1};
  assert.ok(validateAppearanceSkin(old).errors.some(issue=>issue.path.endsWith('.captionBacking')));
  assert.equal(publicAppearanceSkin(old).counterDesign.modes.life.captionBacking,undefined);
  skin.counterDesign.modes.life.artOpacity = 56;
  assert.ok(validateAppearanceSkin(skin).errors.some(issue=>issue.path.endsWith('.artOpacity')));
  assert.equal(counterDesignFor(skin,'life').artOpacity,.55);
});
