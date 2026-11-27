import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import { buildRendererTheme, materializeRendererSkin, rendererComponentDefaults } from './renderer-bridge.js';
import { publicAppearanceSkin } from './appearance-validation.js';
import { resolveDesignArtwork } from './appearance-design-artwork.js';
import { appearanceFontKeys } from './appearance-fonts.js';

const studio = (await readFile(new URL('./appearance-studio.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
function declaration(name, kind = 'const') {
  const start = studio.indexOf(`${kind} ${name}`); assert.ok(start >= 0,name);
  for (let end = studio.indexOf(kind === 'function' ? '}' : ';',start); end >= 0; end = studio.indexOf(kind === 'function' ? '}' : ';',end+1)) {
    const source = studio.slice(start,end+1);
    try { new Script(source); return source; } catch { /* Find the complete declaration. */ }
  }
  assert.fail(name);
}
function edited(raw) {
  const context = { skin:structuredClone(raw),materializeRendererSkin,rendererComponentDefaults,appearanceFontKeys,clone:structuredClone,APPEARANCE_TOKEN_SCHEMA_VERSION:1,
    neutral:{background:'#080808',surface:'#161616',accent:'#d8ae61',secondary:'#6e552a',text:'#f4ecd9',muted:'#afa590',atmosphereColor:'#70a97a',backgroundTreatment:'plain',buttonTreatment:'glass',seatTreatment:'raised'} };
  const source = ['tokenColorFields','tokenEffectFields','componentColorDefaults','layoutRegions'].map(name=>declaration(name)).join('\n') + '\n'
    + declaration('layoutRegionDefault') + '\n' + declaration('uxDefaults') + '\n' + declaration('modeLayoutKeys') + '\n'
    + ['tokenNumber','normalizeSkin','normalizeAppearanceTokens','normalizeComponentColors','normalizeUxSkin'].map(name=>declaration(name,'function')).join('\n')
    + '\nnormalizeSkin(skin); normalizeAppearanceTokens(skin); normalizeComponentColors(skin); normalizeUxSkin(skin);';
  runInNewContext(source,context);
  return structuredClone(context.skin);
}

test('an expanded palette compiles identically before and after editor normalization', () => {
  const skin={rendererVersion:2,id:'expanded',background:'#1c1015',surface:'#35202b',accent:'#ffb88a',secondary:'#ae6375',text:'#fff0e6',muted:'#dec7c6',backgroundTreatment:'grain'};
  for (const mode of ['button','dial']) assert.deepEqual(buildRendererTheme(edited(skin),mode),buildRendererTheme(skin,mode));
});

test('zero corners and disabled artwork rotation survive editor normalization', () => {
  const skin={rendererVersion:2,id:'explicit',seatRadius:0,buttonRadius:0,dialArtSpin:false,modeLayouts:{dial:{seatRadius:0,buttonRadius:0,dialArtSpin:false}}};
  const result=edited(skin);
  assert.equal(result.modeLayouts.dial.seatRadius,0);
  assert.equal(result.modeLayouts.dial.buttonRadius,0);
  assert.equal(result.modeLayouts.dial.dialArtSpin,false);
});

test('renderer-supported placement bounds survive expanded editor normalization', () => {
  const skin={rendererVersion:2,id:'saved-layout',modeLayouts:{dial:{componentLayout:{turnActions:{x:100,y:-140,scale:140}}}}};
  assert.deepEqual(buildRendererTheme(edited(skin),'dial'),buildRendererTheme(skin,'dial'));
});

test('legacy preview transports the raw saved row without injecting editor defaults', () => {
  const skin={id:'legacy',seatRadius:0,fontWeight:700,componentLayout:{counterReadout:{x:40}}};
  const context={skin,store:{assets:[]},CANONICAL_NEUTRAL_ID:'__neutral_arc__',publicAppearanceSkin,resolveDesignArtwork,showingBaseline:false,previewState:'turn',previewMode:'life',previewPlayers:4,icons:{life:'♥'},getPreviewSkin:()=>skin,activeModeLayout(){throw new Error('Legacy preview must not normalize editor layout.');}};
  runInNewContext(declaration('buildDevicePreviewSkin')+'\nresult=buildDevicePreviewSkin();',context);
  assert.equal(context.result.modeLayouts,undefined);
  assert.equal(context.result.seatRadius,0);
  assert.equal(context.result.previewReadOnly,true);
  assert.deepEqual(buildRendererTheme(context.result),buildRendererTheme(skin));
});
