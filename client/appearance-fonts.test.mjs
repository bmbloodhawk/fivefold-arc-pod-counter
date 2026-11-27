import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appearanceFonts, appearanceFontKeys, fontFamily, localFontKeys, prepareAppearanceFonts } from './appearance-fonts.js';
import { buildRendererTheme } from './renderer-bridge.js';
import { validateAppearanceSkin } from './appearance-validation.js';

test('font registry preserves existing mappings and allows exactly three distinct local variable families',()=>{
  assert.equal(fontFamily('serif'),'Georgia,serif');assert.equal(fontFamily('system'),'inherit');assert.equal(fontFamily('untrusted'),'inherit');
  assert.deepEqual(localFontKeys,['cinzel','robotoCondensed','literata']);
  assert.equal(new Set(localFontKeys.map(key=>appearanceFonts[key].family)).size,3);
  assert.equal(appearanceFontKeys.length,7);
});
test('global and surface type share the allowlist without changing legacy rendering',()=>{
  for(const key of localFontKeys){
    const skin={id:'font-test',name:'Font',status:'Draft',rendererVersion:2,fontFamily:key,surfaceDesign:{surfaces:{readout:{typography:{value:{family:key}}}}}};
    assert.deepEqual(validateAppearanceSkin(skin).errors,[]);
    const compiled=buildRendererTheme(skin);assert.equal(compiled.variables['--skin-font'],fontFamily(key));assert.equal(compiled.variables['--sd-readout-value-family'],fontFamily(key,'surface'));
    assert.equal(buildRendererTheme({...skin,rendererVersion:1}).variables['--skin-font'],undefined);
  }
});
test('every bundled face is real WOFF2 with an accompanying original open font license',async()=>{
  let total=0;
  for(const key of localFontKeys){
    const font=appearanceFonts[key],bytes=await readFile(new URL(font.file,import.meta.url));total+=bytes.length;
    assert.equal(bytes.subarray(0,4).toString(),'wOF2');assert.ok(bytes.length>1000);
    assert.match(await readFile(new URL(font.license,import.meta.url),'utf8'),/SIL OPEN FONT LICENSE Version 1.1/);
    assert.deepEqual(font.weights,[400,500,600,700]);
  }
  assert.ok(total<180000,'Latin font library stays below 180 KB');
});
test('font preparation loads only allowlisted used faces and keeps legacy/native records untouched',async()=>{
  const requests=[],document={fonts:{load:async value=>{requests.push(value);return [];}}};
  await prepareAppearanceFonts(document,{rendererVersion:2,id:'font-test',fontFamily:'cinzel',fontWeight:500,surfaceDesign:{surfaces:{readout:{typography:{value:{family:'literata',weight:700}}}}}});
  assert.deepEqual(requests,['500 1em "Cinzel"','700 1em "Literata"']);
  await prepareAppearanceFonts(document,{rendererVersion:1,fontFamily:'robotoCondensed'});
  await prepareAppearanceFonts(document,{rendererVersion:2,id:'__neutral_arc__',fontFamily:'cinzel'});
  await prepareAppearanceFonts(document,{rendererVersion:2,fontFamily:'url(https://evil.test)'});
  assert.equal(requests.length,2);
});
