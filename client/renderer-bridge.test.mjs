import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRendererBridge } from './renderer-bridge.js';
import { rendererDocument } from './test-support/renderer-document.mjs';
import { appearanceFingerprint, needsGeometryPreflight, preflightProofMatches } from './renderer-bridge.js';
import { buildRendererTheme, normalizePreviewFixture, previewMessageAllowed, previewViewportChecks, fitPreviewScale, phoneLayoutChanges, rendererComponentDefaults, materializeRendererSkin } from './renderer-bridge.js';

test('the normal game and preview compile the same cosmetic theme', () => {
  const skin = { rendererVersion:2, id: 'ember', background: '#101010', text: '#ffffff', accent: '#d8ae61', fontFamily: 'serif', componentColors: { endTurn: { background: '#aabbcc', text: '#000000' } }, modeLayouts: { dial: { centerSealScale: 120, lifeNumberScale: 110, componentLayout: { turnActions: { x: 8, y: 4, scale: 105 } } } } };
  assert.deepEqual(buildRendererTheme({ ...skin, useGameBase: false, previewPlayers: 8 }, 'dial'), buildRendererTheme(skin, 'dial'));
  const theme = buildRendererTheme(skin, 'dial');
  assert.equal(theme.variables['--skin-font'], 'Georgia,serif');
  assert.equal(theme.variables['--skin-seal-scale'], '1.2');
  assert.equal(theme.variables['--skin-end-turn-background'], '#aabbcc');
});

test('untrusted messages cannot supply CSS, callbacks, game values, selectors or external images', () => {
  const theme = buildRendererTheme({ rendererVersion:2, id: 'unsafe', background: 'url(https://evil.invalid)', fontFamily: 'url(evil)', ring: 'javascript:x', sourceId: 'P8', life: 999, css: '*{display:none}', backgroundData: 'https://evil.invalid/a.png', symbolData: { life: 'data:image/svg+xml;base64,PHN2Zz4=' }, modeLayouts: { button: { componentLayout: { turnActions: { x: Infinity, y: -10000, scale: 0 }, arbitrarySelector: { x: 4 } } } } }, 'button');
  assert.equal(theme.variables['--bg'], '#080808');
  assert.equal(theme.variables['--skin-font'], 'inherit');
  assert.equal(theme.assets.background, '');
  assert.equal(theme.assets.symbols.life, '');
  assert.equal(theme.datasets.appearanceRing, 'arc');
  assert.equal(JSON.stringify(theme).includes('evil'), false);
  assert.equal(JSON.stringify(theme).includes('999'), false);
  assert.equal(theme.variables['--skin-turn-actions-y'], '-140px');
  assert.equal(theme.variables['--skin-turn-actions-scale'], '0.7');
});

test('native Neutral Arc does not acquire cosmetic variables or layout transforms', () => {
  assert.equal(buildRendererTheme({ id: '__neutral_arc__', background: '#ff0000' }).native, true);
  assert.deepEqual(buildRendererTheme({ id: '__neutral_arc__' }).variables, {});
  assert.equal(buildRendererTheme({ id: 'neutral' }).native, false);
});

test('preview fixtures admit only named isolated examples', () => {
  assert.deepEqual(normalizePreviewFixture({ previewState: 'dialog', previewMode: 'energy', previewPlayers: 8, life: 999, ownerPlayerId: 'P8' }), { state: 'dialog', mode: 'energy', players: 8 });
  assert.deepEqual(normalizePreviewFixture({ previewState: 'arbitrary', previewMode: 'tax', previewPlayers: 99 }), { state: 'turn', mode: 'life', players: 4 });
  for (const state of ['lobby','turn','other','damage','offline','status','error','dialog','end']) assert.equal(normalizePreviewFixture({ previewState: state }).state, state);
});

test('preview messages require the expected window and a nonopaque same origin', () => {
  const source = {};
  assert.equal(previewMessageAllowed({ origin: 'https://arc.example', source }, 'https://arc.example', source), true);
  for (const origin of ['null','https://arc.example.evil','http://arc.example']) assert.equal(previewMessageAllowed({ origin, source }, 'https://arc.example', source), false);
  assert.equal(previewMessageAllowed({ origin: 'https://arc.example', source: {} }, 'https://arc.example', source), false);
});

test('geometric preflight verifies actual dimensions and minimum essential targets', () => {
  const expected = { width: 320, height: 700 };
  const good = { width: 320, height: 700, scrollWidth: 320, targets: [{ label: 'End turn', x: 4, y: 500, width: 312, height: 44 }] };
  assert.equal(previewViewportChecks(good, expected).every(check => check.pass), true);
  assert.equal(previewViewportChecks({ ...good, width: 393 }, expected)[0].pass, false);
  assert.equal(previewViewportChecks({ ...good, targets: [{ label: 'Life plus', x: 3, y: 4, width: 24, height: 24 }] }, expected).some(check => !check.pass), true);
});

test('Fit uses both available width and height without scaling the real document', () => {
  assert.equal(fitPreviewScale(393,852,900,500), 500 / 900);
  assert.equal(fitPreviewScale(393,852,220,1000), 220 / 413);
});

test('phone layout replies cannot overwrite draft identity, approval, assets or comparison state', () => {
  const reply = { id:'other',status:'Approved',name:'Overwrite',previewPlayers:8,backgroundData:'bad',modeLayouts:{ dial:{lifeNumberScale:110,overlayData:{dial:'bad'},componentLayout:{counterReadout:{x:4}}} },interfaceStyle:'dial' };
  const change = phoneLayoutChanges(reply);
  assert.deepEqual(Object.keys(change),['interfaceStyle','modeLayouts']);
  assert.equal(change.modeLayouts.dial.lifeNumberScale,110);
  assert.equal(change.modeLayouts.dial.overlayData,undefined);
  assert.equal(phoneLayoutChanges({...reply,previewReadOnly:true}),null);
  assert.equal(phoneLayoutChanges({...reply,id:'__neutral_arc__'}),null);
});

test('semantic-only records render identically to equivalent legacy fields', () => {
  const flat = {rendererVersion:2,id:'review',background:'#102030',accent:'#abcdef',fontFamily:'mono',fontWeight:500,buttonOpacity:50,buttonTreatment:'outline'};
  const token = {rendererVersion:2,id:'review',tokens:{schemaVersion:1,color:{canvas:'#102030',accentPrimary:'#abcdef'},typography:{family:'mono',weight:500},components:{button:{opacity:50}},effects:{buttonTreatment:'outline'}}};
  assert.deepEqual(buildRendererTheme(token),buildRendererTheme(flat));
  assert.equal(materializeRendererSkin({...token,accent:'#112233'}).accent,'#112233');
});

test('component defaults follow each palette and explicit legacy overrides remain authoritative', () => {
  const skin = {rendererVersion:2,id:'review',surface:'#112233',text:'#ffffff',muted:'#aabbcc',accent:'#ffeeaa'};
  const defaults = rendererComponentDefaults(skin);
  assert.equal(defaults.endTurn.background,'#ffeeaa');
  assert.equal(defaults.lifeButtons.background,'#112233');
  assert.equal(defaults.navigation.text,'#aabbcc');
  const theme = buildRendererTheme(skin);
  assert.equal(theme.variables['--skin-life-buttons-border'],'#62583f');
  assert.equal(theme.variables['--focus-ring'],'0 0 0 3px #fff,0 0 0 6px #ffeeaa');
  assert.equal(buildRendererTheme({...skin,componentColors:{endTurn:{background:'#123456'}}}).variables['--skin-end-turn-background'],'#123456');
});

test('only changed geometry requires measured publication proof, including a saved unsafe layout', () => {
  assert.equal(needsGeometryPreflight({id:'palette',accent:'#abcdef',surface:'#102030'}),false);
  assert.equal(needsGeometryPreflight({id:'saved',status:'Draft',modeLayouts:{dial:{componentLayout:{modeNav:{y:100}}}}}),true);
  assert.equal(needsGeometryPreflight({rendererVersion:2,id:'type',fontFamily:'serif'}),true);
  assert.equal(needsGeometryPreflight({id:'__neutral_arc__'}),false);
});

test('failed, stale or in-flight draft measurements never authorize publication', () => {
  const skin={id:'draft',lifeNumberScale:110}, revision=4;
  const proof={fingerprint:appearanceFingerprint(skin),revision,pass:true};
  assert.equal(preflightProofMatches(proof,skin,revision),true);
  assert.equal(preflightProofMatches({...proof,pass:false},skin,revision),false);
  assert.equal(preflightProofMatches(proof,{...skin,lifeNumberScale:120},revision),false);
  assert.equal(preflightProofMatches(proof,skin,revision+1),false);
  assert.equal(preflightProofMatches(null,skin,revision),false);
});

test('legacy records keep the released cosmetic support until renderer version 2 is explicit', () => {
  const legacy={id:'legacy',fontFamily:'serif',fontWeight:700,componentColors:{endTurn:{background:'#ff0000'}},seatRadius:0};
  const theme=buildRendererTheme(legacy);
  assert.equal(theme.version,1);
  assert.equal(theme.variables['--skin-font'],undefined);
  assert.equal(theme.variables['--skin-end-turn-background'],undefined);
  assert.equal(theme.variables['--skin-seat-radius'],'8px');
  assert.equal(buildRendererTheme({...legacy,rendererVersion:2}).version,2);
  assert.equal(buildRendererTheme({...legacy,rendererVersion:2}).variables['--skin-font'],'Georgia,serif');
});

test('a legacy built-in icon retains its released SVG markup and accessible label', () => {
  const fixture=rendererDocument(readFileSync(new URL('./index.html',import.meta.url),'utf8'));
  const bridge=createRendererBridge(fixture.document,{modeLabel:mode=>mode==='radiation'?'Rad':mode});
  bridge.apply({id:'legacy',symbols:{life:'♥'}},'dial');bridge.refreshArt('dial');
  assert.match(fixture.buttons.get('life').innerHTML,/<svg/);
  assert.equal(fixture.buttons.get('radiation').querySelector('small').textContent,'Rad');
});

test('an editable native-icon draft retains original SVGs and fixed labels until explicit glyph opt-in', () => {
  const fixture=rendererDocument(readFileSync(new URL('./index.html',import.meta.url),'utf8'));
  const bridge=createRendererBridge(fixture.document,{modeLabel:mode=>mode==='radiation'?'Rad':mode});
  const skin={rendererVersion:2,id:'native-draft',symbols:{radiation:'☢'},counterDesign:{navigationIcons:'native'}};
  bridge.apply(skin,'dial');bridge.refreshArt('dial');
  assert.match(fixture.buttons.get('radiation').innerHTML,/<svg/);
  assert.equal(fixture.buttons.get('radiation').querySelector('small').textContent,'Rad');
  bridge.apply({...skin,counterDesign:{navigationIcons:'native',modes:{radiation:{icon:'configured'}}}},'dial');bridge.refreshArt('dial');
  assert.doesNotMatch(fixture.buttons.get('radiation').innerHTML,/<svg/);
  assert.match(fixture.buttons.get('radiation').innerHTML,/☢/);
  bridge.apply({...skin,counterDesign:undefined},'dial');bridge.refreshArt('dial');
  assert.doesNotMatch(fixture.buttons.get('radiation').innerHTML,/<svg/,'Existing saved v2 keeps its previous glyph fallback.');
});

test('legacy mode switches retain released placement until the skin is selected again', () => {
  const fixture = rendererDocument();
  const bridge = createRendererBridge(fixture.document);
  const skin = { id:'legacy', modeLayouts:{
    button:{ componentLayout:{ counterReadout:{ scale:105 } } },
    dial:{ componentLayout:{ counterReadout:{ scale:95 } } },
  } };
  bridge.apply(skin, 'button');
  bridge.refreshArt('dial');
  assert.equal(fixture.properties.get('--skin-counter-readout-scale'), '1.05');
  bridge.apply(skin, 'dial');
  assert.equal(fixture.properties.get('--skin-counter-readout-scale'), '0.95');
  bridge.apply({ ...skin, rendererVersion:2 }, 'button');
  bridge.refreshArt('dial');
  assert.equal(fixture.properties.get('--skin-counter-readout-scale'), '0.95');
});

test('compact counter captions and independent table inks survive the v2 renderer projection', async () => {
  const {counterDesignFor, counterArtStrengthLimit} = await import('./counter-design.js');
  const {validateAppearanceSkin,publicAppearanceSkin} = await import('./appearance-validation.js');
  const skin = {rendererVersion:2,id:'test-paper',name:'Paper',text:'#30251b',surface:'#efe4d1',
    tableDesign:{titleInk:'#5a402b',stepInk:'#664528'},counterDesign:{modes:{life:{captionBacking:'compact'}}}};
  assert.deepEqual(validateAppearanceSkin(skin,{preview:true}).errors,[]);
  const projected=publicAppearanceSkin(skin);
  const rendered=buildRendererTheme(projected);
  assert.equal(rendered.variables['--design-title-ink'],skin.tableDesign.titleInk);
  assert.equal(rendered.variables['--design-step-ink'],skin.tableDesign.stepInk);
  assert.equal(counterDesignFor(projected,'life').captionSurface,skin.surface);
  assert.equal(counterArtStrengthLimit(projected),55);
  assert.equal(buildRendererTheme({rendererVersion:2}).datasets.designTitleInk,undefined);
  assert.equal(counterDesignFor({...skin,rendererVersion:1},'life'),null);
  assert.notEqual(validateAppearanceSkin({...skin,rendererVersion:1},{preview:true}).errors.length,0);
});
