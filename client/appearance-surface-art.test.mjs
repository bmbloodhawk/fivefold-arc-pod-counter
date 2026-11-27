import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceArtSpec, surfaceArtDataSpec, SURFACE_ART_SLOTS, compileSurfaceArtwork, updateSurfaceArtwork, createSurfaceArtRenderer } from './appearance-surface-art.js';
import { rendererDocument } from './test-support/renderer-document.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const safeImage = data => data === png ? data : '';
const skin = () => ({ rendererVersion: 2, surfaceArt: { turnBar: { assetId: 'art-one', opacity: 20 } }, surfaceArtData: { turnBar: png } });

test('surface artwork has only named bounded fields and separate hydrated image data', () => {
  assert.deepEqual(Object.keys(surfaceArtSpec.fields), Object.keys(SURFACE_ART_SLOTS));
  assert.deepEqual(Object.keys(surfaceArtDataSpec.fields), Object.keys(SURFACE_ART_SLOTS));
  assert.deepEqual(surfaceArtSpec.fields.turnBar.fields.opacity, { type: 'number', min: 0, max: 35 });
  assert.equal(Object.hasOwn(surfaceArtSpec.fields.turnBar.fields, 'selector'), false);
});

test('surface art is opt-in and leaves every released skin and empty expanded skin untouched', () => {
  assert.deepEqual(compileSurfaceArtwork({ ...skin(), rendererVersion: 1 }, { safeImage }), {});
  assert.deepEqual(compileSurfaceArtwork({ ...skin(), rendererVersion: undefined }, { safeImage }), {});
  assert.deepEqual(compileSurfaceArtwork({ rendererVersion: 2 }, { safeImage }), {});
});

test('surface artwork compiles safe defaults and rejects unknown surfaces or active images', () => {
  const compiled = compileSurfaceArtwork(skin(), { safeImage });
  assert.deepEqual(compiled.turnBar, { data: png, fit: 'cover', scale: 1, position: '50% 50%', opacity: .2 });
  assert.deepEqual(compileSurfaceArtwork({ ...skin(), surfaceArtData: { turnBar: 'https://example.test/art.png' } }, { safeImage }), {});
  const malicious = { ...skin(), surfaceArt: { '#resetDialog': { assetId: 'art-one' }, turnBar: { assetId: 'art-one', scale: 999, opacity: 99, fit: 'url(evil)', positionX: -100, positionY: 1000 } } };
  const result = compileSurfaceArtwork(malicious, { safeImage });
  assert.equal(Object.hasOwn(result, '#resetDialog'), false);
  assert.deepEqual([result.turnBar.scale, result.turnBar.opacity, result.turnBar.fit, result.turnBar.position], [1.6, .35, 'cover', '0% 100%']);
});

test('editing or clearing one surface preserves unrelated areas and legacy renderer identity', () => {
  const original = { rendererVersion: 1, surfaceArt: { navigation: { assetId: 'nav-art' } }, life: 40 };
  const edited = updateSurfaceArtwork(original, 'turnBar', { assetId: 'turn-art', scale: 120 });
  assert.equal(original.surfaceArt.turnBar, undefined);
  assert.equal(edited.rendererVersion, 1);
  assert.equal(edited.life, 40);
  assert.deepEqual(edited.surfaceArt.navigation, original.surfaceArt.navigation);
  const cleared = updateSurfaceArtwork(edited, 'turnBar', { assetId: '' });
  assert.deepEqual(cleared.surfaceArt, original.surfaceArt);
  assert.throws(() => updateSurfaceArtwork(original, '#resetDialog', { assetId: 'art-one' }), /named|surface/i);
});

test('decorative surface layers stay inert, refresh replaced cards, and clear without changing content', () => {
  const fixture = rendererDocument(), target = fixture.document.createElement('section');
  const label = fixture.document.createElement('strong'); label.textContent = 'YOUR TURN'; target.append(label); fixture.game.append(target);
  const originalQuery = fixture.document.querySelector.bind(fixture.document);
  fixture.document.querySelector = selector => selector === 'link[data-surface-art-css]' ? fixture.document.head.childNodes.find(node => node.hasAttribute('data-surface-art-css')) || null : originalQuery(selector);
  const originalAll = fixture.document.querySelectorAll.bind(fixture.document);
  let current = target;
  fixture.document.querySelectorAll = selector => selector === SURFACE_ART_SLOTS.turnBar.selector ? [current] : originalAll(selector);
  const renderer = createSurfaceArtRenderer(fixture.document, { safeImage });
  renderer.apply(skin());
  assert.equal(target.childNodes.length, 2);
  const decoration = target.childNodes[1];
  assert.equal(decoration.getAttribute('aria-hidden'), 'true');
  assert.equal(label.textContent, 'YOUR TURN');
  renderer.refresh(); assert.equal(target.childNodes[1], decoration);
  current = fixture.document.createElement('section'); fixture.game.append(current); target.remove();
  renderer.refresh(); assert.equal(current.childNodes.length, 1); assert.equal(target.hasAttribute('data-surface-art'), false);
  renderer.clear(); assert.equal(current.childNodes.length, 0); assert.equal(current.hasAttribute('data-surface-art'), false);
});
