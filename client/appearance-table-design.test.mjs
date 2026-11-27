import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRendererTheme, needsGeometryPreflight } from './renderer-bridge.js';
import { validateAppearanceSkin, publicAppearanceSkin } from './appearance-validation.js';
import { resetAppearanceSection } from './appearance-studio-drafts.js';
import { appearanceReadability } from './appearance-readability.js';
import { designStarterValues, designStarters } from './appearance-design-starters.js';

const draft = overrides => ({id:'original-work',name:'Original work',status:'Draft',rendererVersion:2,...overrides});
test('named canvas layers compile only for an edited expanded skin, and clear through the shared bridge',()=>{
  const base=buildRendererTheme(draft());
  assert.equal(base.datasets.canvasLayers,undefined);
  assert.equal(base.variables['--design-canvas-images'],undefined);
  const canvasDesign={fill:'radial',endColor:'#123456',lightX:19,lightY:72,pattern:'stars',strength:0,frame:'double'};
  for(const value of [draft({id:'__neutral_arc__',canvasDesign}),draft({rendererVersion:1,canvasDesign})]) {
    assert.equal(buildRendererTheme(value).datasets.canvasLayers,undefined);
  }
  const themed=buildRendererTheme(draft({canvasDesign}));
  assert.match(themed.variables['--design-canvas-images'],/19% 72%/);
  assert.match(themed.variables['--design-canvas-images'],/0%,transparent/);
  assert.equal(themed.variables['--design-canvas-sizes'].split(',').length,3);
  assert.equal(themed.datasets.canvasFrame,'double');
  assert.equal(themed.datasets.canvasPattern,'true');
  assert.equal(buildRendererTheme(draft({canvasDesign:{frame:'double'}})).datasets.canvasLayers,undefined);
});
test('state-specific appearance is sparse, bounded and independent of active game state',()=>{
  const value=draft({sceneDesign:{warning:{tint:'#eecc33',strength:0,edge:'double'},otherTurn:{edge:'rule',edgeColor:'#33ccbb'}}});
  const theme=buildRendererTheme(value);
  assert.equal(theme.datasets.momentWarning,'true');assert.equal(theme.datasets.momentOtherTurn,'true');
  assert.equal(theme.datasets.momentOwnTurn,undefined);
  assert.equal(theme.variables['--moment-warning-wash'],'color-mix(in srgb,#eecc33 0%,transparent)');
  assert.equal(theme.variables['--moment-other-turn-edge'],'1px solid #33ccbb');
  assert.equal(theme.datasets.canvasPattern,undefined);
  assert.deepEqual(validateAppearanceSkin(value).errors,[]);
});
test('table layout ranges, renderer generation and original game behaviors stay outside authored settings',()=>{
  const bad=draft({tableDesign:{sideGutter:100,seatArrangement:'hidden'},canvasDesign:{pattern:'external'},sceneDesign:{warning:{trigger:'life'}}});
  const errors=validateAppearanceSkin(bad,{publish:true}).errors;
  for(const key of ['sideGutter','seatArrangement','pattern','warning']) assert.ok(errors.some(e=>e.path.includes(key)),key);
  assert.equal(publicAppearanceSkin(bad).sceneDesign.warning.trigger,undefined);
  assert.ok(validateAppearanceSkin(draft({rendererVersion:1,tableDesign:{rowGap:5}})).errors.length);
  assert.equal(needsGeometryPreflight(draft({tableDesign:{rowGap:5}})),true);
  assert.equal(needsGeometryPreflight(draft({canvasDesign:{pattern:'dots'}})),false);
});
test('section reset restores only the source fields belonging to the visible section',()=>{
  const previous=draft({canvasDesign:{fill:'solid'},tableDesign:{tableWidth:640},sceneDesign:{offline:{edge:'rule'}}});
  const changed=draft({canvasDesign:{pattern:'weave'},tableDesign:{rowGap:8},sceneDesign:{warning:{edge:'double'}},counterDesign:{navigationIcons:'native'}});
  const reset=resetAppearanceSection(changed,previous,'foundation');
  assert.deepEqual(reset.canvasDesign,previous.canvasDesign);assert.deepEqual(reset.sceneDesign,previous.sceneDesign);
  assert.deepEqual(reset.tableDesign,changed.tableDesign);assert.deepEqual(reset.counterDesign,changed.counterDesign);
  assert.deepEqual(resetAppearanceSection(changed,previous,'layout').tableDesign,previous.tableDesign);
});
test('table title and dial step inks are opt-in, validated and independent of the seat accents',()=>{
  const tableDesign = {titleInk:'#5a402b',stepInk:'#664528',turnAccent:'#010203',ownerAccent:'#040506'};
  const skin = draft({background:'#e5d9bc',tableDesign});
  assert.deepEqual(validateAppearanceSkin(skin,{publish:true}).errors,[]);
  assert.deepEqual(publicAppearanceSkin(skin).tableDesign,tableDesign);
  assert.equal(needsGeometryPreflight(skin),false);
  const theme = buildRendererTheme(skin);
  assert.equal(theme.variables['--design-title-ink'],tableDesign.titleInk);
  assert.equal(theme.variables['--design-step-ink'],tableDesign.stepInk);
  assert.equal(theme.variables['--design-turn-accent'],tableDesign.turnAccent);
  assert.equal(theme.variables['--design-owner-accent'],tableDesign.ownerAccent);
  assert.equal(theme.datasets.designTitleInk,'true');
  assert.equal(theme.datasets.designStepInk,'true');
  const invalid = draft({tableDesign:{titleInk:'transparent',stepInk:'currentColor'}});
  for (const key of ['titleInk','stepInk']) {
    assert.ok(validateAppearanceSkin(invalid).errors.some(error=>error.path === 'skin.tableDesign.' + key));
  }
  for (const untouched of [draft(),invalid,draft({rendererVersion:1,tableDesign}),draft({id:'__neutral_arc__',tableDesign})]) {
    const theme = buildRendererTheme(untouched);
    assert.equal(theme.datasets.designTitleInk,undefined);
    assert.equal(theme.datasets.designStepInk,undefined);
    assert.equal(theme.variables['--design-title-ink'],undefined);
    assert.equal(theme.variables['--design-step-ink'],undefined);
  }
});
test('design starters render different native-icon identities and fit the catalog schema',()=>{
  const seen=new Set();
  for(const {id} of designStarters) {
    const values=designStarterValues(id),skin=draft(values);
    assert.deepEqual(validateAppearanceSkin(skin,{publish:true}).errors,[],id);
    seen.add(buildRendererTheme(skin).variables['--design-canvas-images']);
    assert.equal(skin.counterDesign.navigationIcons,'native');
    for(const key of ['access','provenance','grants','achievement','invitation','id','selected','tableSkinId']) assert.equal(Object.hasOwn(values,key),false);
    values.surfaceDesign.surfaces.playerCards.ink='#000000';
    assert.notEqual(designStarterValues(id).surfaceDesign.surfaces.playerCards.ink,'#000000');
  }
  assert.equal(seen.size,designStarters.length);
});
test('authored title and step inks check their own contrast thresholds on both gradient stops',()=>{
  const review = skin => appearanceReadability(draft(skin)).filter(f=>f.path.startsWith('tableDesign.'));
  const tableDesign = {titleInk:'#888888',stepInk:'#888888'};
  assert.deepEqual(review({background:'#ffffff',tableDesign}).map(f=>f.path),['tableDesign.titleInk']);
  for (const fill of ['linear','radial']) {
    const canvasDesign = {fill,endColor:'#888888'};
    const findings = review({background:'#000000',canvasDesign,tableDesign});
    assert.deepEqual(findings.map(f=>f.path),['tableDesign.titleInk','tableDesign.stepInk']);
    assert.ok(findings.every(f=>f.severity==='error' && f.label.includes('other end')));
    assert.deepEqual(review({background:'#000000',canvasDesign}),[]);
    assert.deepEqual(review({background:'#000000',canvasDesign:{...canvasDesign,fill:'solid'},tableDesign}),[]);
  }
  const sample = designStarterValues('field-notes');
  assert.deepEqual(review({...sample,tableDesign:{...sample.tableDesign,titleInk:'#5a402b',stepInk:'#664528'}}),[]);
});
test('unreadable gradient end stops and counter labels produce specific review findings',()=>{
  const findings=appearanceReadability(draft({background:'#101010',surface:'#202020',text:'#ffffff',muted:'#eeeeee',
    canvasDesign:{fill:'linear',endColor:'#ffffff'},counterDesign:{modes:{radiation:{surface:'#eeeeee',accent:'#eeeeee'}}}}));
  const plate=appearanceReadability(draft({surface:'#cccccc',text:'#cecece',accent:'#cccccc',counterDesign:{modes:{life:{captionBacking:'surface'}}}}));
  assert.ok(plate.some(f=>f.path==='counterDesign.modes.life.text' && f.severity==='error'));
  assert.ok(plate.some(f=>f.path==='counterDesign.modes.life.accent' && f.severity==='error'));
  for(const path of ['canvasDesign.endColor','counterDesign.modes.radiation.accent']) assert.ok(findings.some(f=>f.path===path && f.severity==='error' && f.fix));
});
