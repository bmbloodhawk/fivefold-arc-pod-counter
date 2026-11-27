import test from 'node:test';
import assert from 'node:assert/strict';
import { designArtworkReferences, resolveDesignArtwork, hydrateDesignArtwork } from './appearance-design-artwork.js';
import { appearanceAssetReferences, publicAppearanceSkin, validateAppearanceSkin } from './appearance-validation.js';
import { assetUsages } from './appearance-studio-assets.js';

const configured = () => ({ id: 'new-art', rendererVersion: 2, surfaceArt: { turnBar: { assetId: 'panel-one', fit: 'cover', opacity: 25 } }, counterDesign: { modes: { life: { artAsset: 'dial-one' } } } });
test('new artwork references use only named surfaces and modes with explicit role compatibility', () => {
  const refs = designArtworkReferences(configured());
  assert.deepEqual(refs.map(ref => [ref.id, ref.path, ref.roles]), [['panel-one', 'surfaceArt.turnBar.assetId', ['panel', 'overlay', 'background']], ['dial-one', 'counterDesign.modes.life.artAsset', ['dial', 'seal', 'overlay']]]);
  assert.deepEqual(designArtworkReferences({ surfaceArt: { arbitrary: { assetId: 'panel-one' } }, counterDesign: { modes: { arbitrary: { artAsset: 'dial-one' } } } }), []);
});
test('Studio and server resolve identical scoped artwork without changing saved JSON', async () => {
  const value = configured(), before = JSON.stringify(value);
  const resolver = id => id === 'panel-one' ? 'panel-data' : 'dial-data';
  assert.deepEqual(resolveDesignArtwork(value, resolver), { surfaceArtData: { turnBar: 'panel-data' }, counterArtData: { life: 'dial-data' } });
  assert.deepEqual(await hydrateDesignArtwork(value, async id => resolver(id)), resolveDesignArtwork(value, resolver));
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual(resolveDesignArtwork({}, resolver), {});
});
test('missing artwork falls back without leaking resolver errors or arbitrary objects', async () => {
  assert.deepEqual(await hydrateDesignArtwork(configured(), async () => { throw new Error('private store error'); }), { surfaceArtData: { turnBar: '' }, counterArtData: { life: '' } });
  assert.deepEqual(resolveDesignArtwork(configured(), () => ({ private: true })), { surfaceArtData: { turnBar: '' }, counterArtData: { life: '' } });
});
test('validation projection and saved history include scoped artwork without private nested metadata', () => {
  const value = configured();
  assert.deepEqual(validateAppearanceSkin(value, { assets: [{ id: 'panel-one', placement: 'panel' }, { id: 'dial-one', placement: 'dial' }] }).errors, []);
  assert.ok(validateAppearanceSkin(value, { assets: [{ id: 'panel-one', placement: 'symbol' }, { id: 'dial-one', placement: 'dial' }] }).errors.length);
  assert.ok(validateAppearanceSkin({ ...value, surfaceArt: { turnBar: { assetId: 'panel-one', opacity: 80 } } }).errors.length);
  const projected = publicAppearanceSkin({ ...value, surfaceArt: { turnBar: { ...value.surfaceArt.turnBar, callback: { secret: true } } } });
  assert.equal(JSON.stringify(projected).includes('secret'), false);
  assert.deepEqual(appearanceAssetReferences({ id: 'history', versions: [{ appearance: value }] }).map(ref => ref.path), ['versions.0.surfaceArt.turnBar.assetId', 'versions.0.counterDesign.modes.life.artAsset']);
});

test('independent face and ring assets survive projection and resolve by counter in exact and asynchronous previews', async () => {
  const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  const value = { id:'skin-ring', rendererVersion:2, counterDesign:{modes:{
    life:{artAsset:'face',ringArtAsset:'life-ring'}, commander:{ringArtAsset:'commander-ring'}, poison:{ringArtAsset:''},
  }}};
  const refs = designArtworkReferences(value);
  assert.deepEqual(refs.map(ref=>[ref.id,ref.dataKey,ref.slot]),[
    ['face','counterArtData','life'],['life-ring','counterRingArtData','life'],['commander-ring','counterRingArtData','commander'],
  ]);
  const assets = refs.map((ref,index)=>({id:ref.id,placement:['dial','overlay','seal'][index],status:'Approved'}));
  assert.deepEqual(validateAppearanceSkin(value,{assets,requireApprovedAssets:true}).errors,[]);
  assert.deepEqual(publicAppearanceSkin(value).counterDesign,value.counterDesign);
  const resolved = {counterArtData:{life:'face'},counterRingArtData:{life:'life-ring',commander:'commander-ring'}};
  assert.deepEqual(resolveDesignArtwork(value,id=>id),resolved);
  assert.deepEqual(await hydrateDesignArtwork(value,async id=>id),resolved);
  assert.deepEqual(assetUsages('life-ring',[],value),['Open draft · life dial ring']);
  assert.ok(appearanceAssetReferences({id:'history',versions:[{appearance:value}]}).some(ref=>ref.path==='versions.0.counterDesign.modes.life.ringArtAsset'));
  const preview = {...value,counterRingArtData:{life:raster}};
  assert.deepEqual(validateAppearanceSkin(preview,{preview:true}).errors,[]);
  assert.ok(validateAppearanceSkin(preview).errors.length);
  for(const bad of [{other:raster},{life:'https://invalid.invalid/ring.png'}]) {
    assert.ok(validateAppearanceSkin({...value,counterRingArtData:bad},{preview:true}).errors.length);
  }
  for(const changes of [{placement:'symbol'},{status:'Pending'}]) {
    const invalid = assets.map(asset=>asset.id==='life-ring'?{...asset,...changes}:asset);
    assert.ok(validateAppearanceSkin(value,{assets:invalid,requireApprovedAssets:true}).errors.some(issue=>issue.path==='counterDesign.modes.life.ringArtAsset'));
  }
});
