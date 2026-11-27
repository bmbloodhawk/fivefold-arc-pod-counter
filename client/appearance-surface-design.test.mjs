import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSurfaceDesign, surfaceReadability, surfaceDesignSpec, surfaceDefinitions } from './appearance-surface-design.js';
import { setSurfaceField, mergeSurfaceOverrides } from './appearance-surface-editor.js';
import { validateAppearanceSkin, publicAppearanceSkin } from './appearance-validation.js';

const theme = () => ({version:2,native:false,variables:{},datasets:{}});
const skin = surfaces => ({rendererVersion:2,background:'#080808',surface:'#161616',text:'#ffffff',muted:'#bbbbbb',accent:'#eecc88',surfaceDesign:{surfaces}});

test('surface overrides are sparse and do not affect native, legacy, or existing v2 skins', () => {
  for (const value of [{},skin({}),skin({playerCards:{}})]) {
    const result = theme(); compileSurfaceDesign(value,result);
    assert.deepEqual(result,theme());
  }
  for (const result of [{...theme(),native:true},{...theme(),version:1}]) {
    const before=structuredClone(result); compileSurfaceDesign(skin({playerCards:{ink:'#ffffff'}}),result);
    assert.deepEqual(result,before);
  }
});

test('surfaces compile independently, with bounded application-owned CSS and no input mutation', () => {
  const value=skin({playerCards:{fill:{kind:'linear',color:'#102030',color2:'#304050',angle:125},ink:'#ffffff',border:{width:2,color:'#aabbcc'},texture:{kind:'grid',strength:8}},dialogs:{ink:'#eeeeee'}});
  const before=JSON.stringify(value),result=theme(); compileSurfaceDesign(value,result);
  assert.match(result.variables['--sd-player-cards-fill'],/linear-gradient\(125deg in srgb/);
  assert.equal(result.datasets.surfacePlayerCardsFill,'true');
  assert.equal(result.datasets.surfaceDialogsInk,'true');
  assert.equal(result.variables['--sd-dialogs-fill'],undefined);
  assert.equal(result.variables['--sd-player-cards-border-width'],'2px');
  assert.equal(JSON.stringify(value),before);
  const unsafe=theme(); compileSurfaceDesign(skin({playerCards:{ink:'url(https://evil.test)',shadow:'url(x)',fill:{kind:'evil',color:'red'},typography:{label:{family:'url(x)',scale:99999}}}}),unsafe);
  assert.equal(Object.values(unsafe.variables).some(value=>/url\(/.test(value)),false);
  assert.equal(unsafe.variables['--sd-player-cards-label-scale'],'1.15');
});

test('typography permits independent actual roles, keeping the fitted life value size untouched', () => {
  const result=theme(); compileSurfaceDesign(skin({playerCards:{typography:{label:{family:'mono',weight:700,scale:110},value:{family:'serif'}}},readout:{typography:{value:{family:'rounded',scale:115}}}}),result);
  assert.match(result.variables['--sd-player-cards-label-family'],/monospace/);
  assert.equal(result.variables['--sd-player-cards-label-scale'],'1.1');
  assert.equal(result.variables['--sd-readout-value-scale'],undefined);
  assert.equal(surfaceDesignSpec.fields.surfaces.fields.readout.fields.typography.fields.value.fields.scale,undefined);
  assert.ok(surfaceDefinitions.length>=10);
});

test('corner radii and role style/shadow are independent and explicit native shadow inherits', () => {
  const result=theme();compileSurfaceDesign(skin({readout:{radii:{topLeft:0,bottomRight:18},typography:{value:{style:'italic',shadow:'none'},label:{shadow:'native'}}}}),result);
  assert.equal(result.variables['--sd-readout-radius-top-left'],'0px');
  assert.equal(result.variables['--sd-readout-radius-bottom-right'],'18px');
  assert.equal(result.variables['--sd-readout-radius-top-right'],undefined);
  assert.equal(result.variables['--sd-readout-value-style'],'italic');
  assert.equal(result.variables['--sd-readout-value-shadow'],'none');
  assert.equal(result.variables['--sd-readout-label-shadow'],undefined);
});

test('gradient readability checks interior colors and relevant text roles', () => {
  const findings=surfaceReadability(skin({turnBar:{fill:{kind:'linear',color:'#000000',color2:'#ffffff'},ink:'#777777'}}));
  assert.ok(findings.some(row=>row.path==='surfaceDesign.surfaces.turnBar.ink'&&row.severity==='error'&&/worst/.test(row.label)));
  assert.deepEqual(surfaceReadability(skin({turnBar:{fill:{kind:'solid',color:'#101010'},ink:'#ffffff',muted:'#cccccc'}})),[]);
});

test('readability accounts for texture and alpha rather than claiming certainty over art', () => {
  const findings=surfaceReadability({...skin({dialogs:{fill:{kind:'solid',color:'#101010',opacity:50},ink:'#ffffff',texture:{kind:'dots',strength:12}}}),backgroundAsset:'art'});
  assert.ok(findings.some(row=>row.severity==='warning'&&/translucent/i.test(row.label)));
  assert.deepEqual(surfaceReadability({...skin({turnBar:{ink:'#111111'}}),rendererVersion:1}),[]);
});

test('field and surface reset prune only their own overrides and retain exact unrelated source data', () => {
  const value=skin({playerCards:{ink:'#ffffff',typography:{label:{weight:700}}},dialogs:{ink:'#eeeeee'}}),other=JSON.stringify(value.surfaceDesign.surfaces.dialogs);
  setSurfaceField(value,'playerCards',['typography','label','weight'],undefined);
  assert.deepEqual(value.surfaceDesign.surfaces.playerCards,{ink:'#ffffff'});
  setSurfaceField(value,'playerCards',[],undefined);
  assert.equal(JSON.stringify(value.surfaceDesign.surfaces.dialogs),other);
  setSurfaceField(value,'dialogs',[],undefined);
  assert.equal(value.surfaceDesign,undefined);
  const source={fill:{kind:'solid',color:'#102030'},typography:{label:{family:'serif'}}};
  setSurfaceField(value,'playerCards',[],source);
  assert.deepEqual(value.surfaceDesign.surfaces.playerCards,source);
  source.fill.color='#ffffff';
  assert.equal(value.surfaceDesign.surfaces.playerCards.fill.color,'#102030');
});

test('copying a surface merges only supported roles and explicit fields without overwriting unrelated target choices', () => {
  const value=skin({readout:{muted:'#aabbcc',radii:{bottomRight:14},typography:{body:{weight:500},value:{family:'serif'}}}});
  const copied={ink:'#112233',radii:{topLeft:0},typography:{label:{weight:700},heading:{family:'mono'},value:{family:'mono',scale:115}},unknown:'do not copy'};
  const before=JSON.stringify(copied);
  mergeSurfaceOverrides(value,'readout',copied);
  assert.deepEqual(value.surfaceDesign.surfaces.readout,{muted:'#aabbcc',ink:'#112233',radii:{bottomRight:14,topLeft:0},typography:{body:{weight:500},label:{weight:700},value:{family:'mono'}}});
  assert.equal(JSON.stringify(copied),before);
  mergeSurfaceOverrides(value,'gameMenu',{muted:'#cccccc',accent:'#eeeeee',typography:{heading:{family:'serif'}}});
  assert.equal(value.surfaceDesign.surfaces.gameMenu,undefined);
});

test('shared catalog projection accepts supported sparse surfaces and rejects unknown or unsafe design fields', () => {
  const value={id:'surface-test',name:'Surface test',status:'Draft',...skin({readout:{typography:{value:{family:'mono',style:'italic',shadow:'none'}},radii:{topLeft:0}},dialogs:{ink:'#ffffff'}})};
  assert.deepEqual(validateAppearanceSkin(value).errors,[]);
  assert.deepEqual(publicAppearanceSkin(value).surfaceDesign,value.surfaceDesign);
  for(const surface of [{unknown:{}},{readout:{selector:'body'}},{readout:{radii:{topLeft:500}}},{readout:{typography:{value:{scale:115}}}},{gameMenu:{muted:'#ffffff'}},{readout:{ink:'url(https://example.test)'}}])
    assert.ok(validateAppearanceSkin({...value,surfaceDesign:{surfaces:surface}}).errors.length,JSON.stringify(surface));
});

test('malformed imported surface numbers and inherited colors report errors without throwing',()=>{
  const value={id:'bad-surface',name:'Bad surface',status:'Draft',rendererVersion:2,surface:{toString:{}},background:{toString:{}},text:{toString:{}},surfaceDesign:{surfaces:{playerCards:{fill:{kind:'solid',color:'#ffffff',opacity:{toString:{}}},border:{width:{toString:{}},color:'#111111'}}}}};
  assert.doesNotThrow(()=>surfaceReadability(value));assert.doesNotThrow(()=>validateAppearanceSkin(value));assert.ok(validateAppearanceSkin(value).errors.length);
});
