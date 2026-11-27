import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceReadability,contrastRatio } from './appearance-readability.js';
import { assetInspection,assetUsages,artworkFitNote } from './appearance-studio-assets.js';
import { parsePaletteColor } from './appearance-studio-palette.js';

test('the desktop palette accepts only complete opaque hex colors',()=>{
  for (const value of ['#aAbBcC','  AABBCC ']) assert.equal(parsePaletteColor(value),'#aabbcc');
  for (const value of ['#abc','#112233ff','blue','']) assert.equal(parsePaletteColor(value),null);
});
import { buildRendererTheme } from './renderer-bridge.js';
import { resetAppearanceSection } from './appearance-studio-drafts.js';

test('readability measures both surface and canvas, including small selected labels and feedback',()=>{
  assert.equal(contrastRatio('#ffffff','#000000'),21);
  assert.equal(contrastRatio('not a token','#fafafa'),null);
  const skin={rendererVersion:2,surface:'#ffffff',background:'#000000',text:'#ffffff',muted:'#777777',stateDanger:'#fafafa',componentColors:{navigation:{background:'#171717',selectedText:'#161616'}}};
  const findings=appearanceReadability(skin);
  for (const path of ['text','muted','stateDanger','componentColors.navigation.selectedText']) assert.ok(findings.some(x=>x.path===path && x.severity==='error' && x.fix));
  assert.ok(!findings.some(x=>x.path==='text' && x.label.includes('background')));
});
test('legacy previews do not report unused expanded-only colors as publication failures',()=>{
  const visual={id:'archive',surface:'#151515',text:'#ffffff',stateDanger:'#151515',componentColors:{navigation:{text:'#111111',background:'#111111'}}};
  assert.equal(appearanceReadability(visual).filter(item=>item.severity==='error').length,0);
  assert.equal(appearanceReadability({...visual,rendererVersion:2}).filter(item=>item.severity==='error').length,2);
});

test('frosted and outlined End Turn controls use the visible foreground and background',()=>{
  const skin={rendererVersion:2,text:'#666666',background:'#101010',surface:'#101010',accent:'#f0f0f0',componentColors:{endTurn:{background:'#ffffff',text:'#000000'}},buttonTreatment:'glass'};
  assert.ok(appearanceReadability(skin).some(x=>x.label.includes('frosted glass') && x.severity==='error'));
  skin.buttonTreatment='outline'; skin.accent=skin.background;
  assert.ok(appearanceReadability(skin).some(x=>x.label.includes('outline label')));
});

test('recoverable art, text size, and opacity advisories stay distinct from missing thumbnail polish',()=>{
  const findings=appearanceReadability({backgroundAsset:'a',buttonOpacity:45,modeLayouts:{button:{seatTextScale:85}}});
  assert.equal(findings.filter(x=>x.severity==='warning').length,3);
  assert.equal(findings.filter(x=>x.severity==='polish').length,1);
  assert.equal(findings.filter(x=>x.severity==='error').length,0);
});
test('usage includes current placements, saved versions, layouts, and the open draft',()=>{
  const skin={name:'Harbor',modeLayouts:{dial:{overlays:{dial:'a'}}},versions:[{appearance:{symbolAssets:{life:'a'}}}]};
  const locations=assetUsages('a',[skin],{thumbnailAsset:'a'});
  assert.equal(locations.length,3);
  for (const name of ['saved version 1','Open draft','overlay']) assert.ok(locations.some(x=>x.includes(name)));
  assert.ok(assetInspection({data:'missing'}).error);
  const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  assert.equal(assetInspection({data}).info.width,1);
  assert.match(assetInspection({data,width:72}).error,/width differs/);
  assert.ok(artworkFitNote('button',{width:80,height:80}).includes('wider'));
  assert.equal(artworkFitNote('background',{width:1920,height:700}),'');
});
test('named surface variants are optional and scoped; resetting one section preserves the others',()=>{
  const original={id:'fixture',rendererVersion:2,variants:{navigation:'underline',numerals:'tabular'}};
  const draft={...original,borderColor:'#223344',disabledColor:'#777777',variants:{navigation:'framed',numerals:'proportional',panels:'raised'},tokens:{color:{border:'#223344'}}};
  const theme=buildRendererTheme(draft);
  assert.equal(theme.datasets.variantPanels,'raised');
  assert.equal(theme.datasets.variantNavigation,'framed');
  assert.equal(theme.variables['--skin-border-color'],'#223344');
  assert.deepEqual(buildRendererTheme({id:'__neutral_arc__',...{variants:draft.variants}}).datasets,{});
  assert.deepEqual(resetAppearanceSection(draft,original,'components').variants,{navigation:'underline',numerals:'proportional'});
  const resetType=resetAppearanceSection(draft,original,'typography');
  assert.equal(resetType.variants.panels,'raised'); assert.equal(resetType.variants.numerals,'tabular'); assert.equal(resetType.borderColor,undefined);
});
