import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommanderGlass, glassIdentity } from './commander-glass.js';
import { publicAppearanceSkin, validateAppearanceSkin } from './appearance-validation.js';
import { buildRendererTheme, createRendererBridge } from './renderer-bridge.js';
import { rendererDocument } from './test-support/renderer-document.mjs';
import { counterDesignFor } from './counter-design.js';

const skin = { id: 'glass', rendererVersion: 2, commanderTreatment: 'prismatic-glass' };

test('solid material art is allowed only on expanded prismatic faces, including preview and saved versions', () => {
  const face = artOpacity => ({modes: {life: {face: 'rings', artOpacity}}});
  const opaque = {...skin,counterDesign:face(100)};
  const ordinary = {...opaque}; delete ordinary.commanderTreatment;
  for (const preview of [false,true]) {
    assert.deepEqual(validateAppearanceSkin(opaque,{preview}).errors, []);
    assert.ok(validateAppearanceSkin(ordinary,{preview}).errors.length);
    assert.ok(validateAppearanceSkin({...opaque,counterDesign:face(101)},{preview}).errors.length);
    assert.ok(validateAppearanceSkin({...opaque,rendererVersion:1},{preview}).errors.length);
  }
  assert.equal(counterDesignFor(opaque,'life').artOpacity, 1);
  assert.equal(counterDesignFor(ordinary,'life').artOpacity, .55);
  const version = appearance => ({ id:'v1',label:'Saved',savedAt:'now',appearance });
  assert.deepEqual(validateAppearanceSkin({...skin,versions:[version(opaque)]}).errors,[]);
  assert.ok(validateAppearanceSkin({...skin,versions:[version(ordinary)]}).errors.length);
});

test('upright centers require per-face opt-in, prismatic glass, and safe artwork', () => {
  const skin = {id:'engraving',rendererVersion:2,commanderTreatment:'prismatic-glass',counterArtData:{life:'approved'},
    counterDesign:{modes:{life:{uprightCenter:true},poison:{uprightCenter:true}}}};
  const accept = value => value === 'approved' ? value : '';
  assert.equal(counterDesignFor(skin,'life',accept).uprightCenter,true);
  assert.equal(counterDesignFor(skin,'poison',accept),null);
  const {counterArtData, ...draft} = skin;
  assert.deepEqual(validateAppearanceSkin(draft).errors,[]);
  assert.equal(publicAppearanceSkin(draft).counterDesign.modes.life.uprightCenter,true);
  const {commanderTreatment, ...ordinary} = draft;
  for (const other of [ordinary,{...draft,rendererVersion:1}]) {
    assert.ok(validateAppearanceSkin(other).errors.some(issue=>issue.path.endsWith('.modes.life') && issue.message.includes('uprightCenter')));
    assert.equal(counterDesignFor({...other,counterArtData},'life',accept)?.uprightCenter,undefined);
    assert.equal(publicAppearanceSkin(other).counterDesign.modes.life.uprightCenter,undefined);
  }
  assert.ok(validateAppearanceSkin({...draft,counterDesign:{modes:{life:{uprightCenter:'true'}}}}).errors.length);
});

test('every commander identity including colorless has distinct panes, independent of partner order or duplicates', () => {
  const colors = [...'WUBRG'];
  const identities = new Set();
  for (let mask = 0; mask < 32; mask++) {
    const selected = colors.filter((_, i) => mask & (1 << i));
    const key = glassIdentity(selected);
    assert.equal(glassIdentity([...selected, ...selected].reverse()), key);
    identities.add(key);
  }
  assert.equal(identities.size, 32);
  assert.equal(glassIdentity(['?', 'url(foo)']), 'C');
});

test('sample identities are validated and excluded from stored and public skins', () => {
  const fixture = { ...skin, previewCommanderColors: [], previewPartnerColors: ['G','U'], previewInspectedColors: ['R'] };
  assert.deepEqual(validateAppearanceSkin(fixture,{preview:true}).errors, []);
  assert.deepEqual(publicAppearanceSkin(fixture), skin);
  assert.ok(validateAppearanceSkin(fixture).errors.length);
  assert.deepEqual(validateAppearanceSkin(skin).errors, []);
  assert.ok(validateAppearanceSkin({ ...skin, rendererVersion: 1 }).errors.length);
  for (const input of ['W', null, [['W']], ['WR'], ['W','W'], ['X'], ['W','U','B','R','G','G']]) {
    assert.ok(validateAppearanceSkin({ ...skin, previewCommanderColors: input },{preview:true}).errors.length);
  }
  for (const field of [{ commanderTreatment: false }, { commanderTreatment: 'other' }, { rendererVersion: 1 }]) {
    assert.equal(buildRendererTheme({ ...skin, ...field }).datasets.commanderTreatment, undefined);
  }
});

test('the table owner paints the canvas, an inspected seat paints the readout, and every visible seat paints its own card', () => {
  const { document, game } = rendererDocument();
  const first = document.createElement('button'), second = document.createElement('button');
  first.className = second.className = 'pod-seat';
  first.dataset.seat = 'P1'; second.dataset.seat = 'P2';
  const rails = [first, second].map(card => {
    const rail = document.createElement('span');
    card.append(rail);
    card.querySelector = selector => selector === '.identity-rail' ? rail : null;
    return rail;
  });
  game.append(first, second);
  const table = { owner: 'P1', viewed: 'P1', seats: { P1: ['U','R'], P2: ['G'] } };
  let reads = 0;
  const bridge = createRendererBridge(document, { getCommanderTable: () => { reads++; return table; } });
  bridge.apply({ id: 'night-watch', rendererVersion: 2 }, 'dial');
  bridge.refreshArt();
  assert.equal(reads, 0);
  bridge.apply(skin, 'dial');
  assert.equal(game.dataset.glassOwner, 'UR');
  assert.equal(game.dataset.glassViewed, 'UR');
  assert.deepEqual(rails.map(rail => rail.childNodes.map(gem => gem.dataset.mana)), [['U','R'], ['G']]);
  table.viewed = 'P2';
  bridge.refreshArt('button');
  assert.equal(game.dataset.glassOwner, 'UR');
  assert.equal(game.dataset.glassViewed, 'G');
  table.seats.P1 = [];
  bridge.refreshArt();
  assert.equal(game.dataset.glassOwner, 'C');
  assert.equal(game.dataset.glassViewed, 'G');
  assert.deepEqual(rails[0].childNodes.map(gem => gem.dataset.mana), ['C']);
  bridge.apply({ id: '__neutral_arc__' }, 'button');
  assert.equal(game.dataset.glassViewed, undefined);
  assert.equal(game.dataset.glassOwner, undefined);
  assert.equal(first.dataset.glassIdentity, undefined);
  assert.equal(rails[0].childNodes.length, 0);
  assert.equal(game.dataset.commanderTreatment, undefined);
});

const settle = () => new Promise(done => setImmediate(done));
test('the normal renderer withholds both keyed masters from the first and failed five-color paints', async () => {
  const { document, game, root } = rendererDocument();
  const dial = document.createElement('div');
  game.append(dial);
  const query = document.querySelector;
  document.querySelector = selector => selector === '.dial-face' ? dial : query(selector);
  game.dataset.counterMode = 'life';
  const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  const fixture = {...skin, backgroundData:raster, counterArtData:{life:raster}, counterDesign:{modes:{life:{uprightCenter:true}}}};
  const table = {owner:'P1', viewed:'P1', seats:{P1:[...'WUBRG']}};
  const renderer = createRendererBridge(document, {getCommanderTable: () => table});
  renderer.apply(fixture, 'dial');
  const images = dial.childNodes.filter(node => node.classList.contains('counter-design-ring') || node.classList.contains('counter-design-engraving')).map(node => node.childNodes[0]);
  assert.equal(images.length, 2);
  for (const phase of ['initial','decode failure']) {
    if (phase === 'decode failure') await settle(); // Test document has no image decoder.
    assert.equal(document.body.style.backgroundImage, '');
    assert.ok(!root.style.getPropertyValue('--design-canvas-images').includes(raster));
    assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), '');
    for (const image of images) {
      assert.equal(image.getAttribute('src'), null);
      assert.equal(image.src, undefined);
      assert.equal(image.hidden, true);
    }
  }
});

test('clearing during decode cancels both sources before either full-size pigment map is allocated', async () => {
  const { document, game } = rendererDocument();
  const decodes = [], cancelled = [];
  let canvases = 0;
  const create = document.createElement;
  document.createElement = tag => {
    if (tag === 'canvas') canvases++;
    if (tag !== 'img') return create(tag);
    return {
      decode: () => new Promise(done => decodes.push(done)),
      removeAttribute(name) { if (name === 'src') cancelled.push(this.src); },
    };
  };
  const table = { owner: 'P1', viewed: 'P1', seats: { P1: ['R'] } };
  const glass = createCommanderGlass(document, () => table);
  const hall = 'data:image/webp;base64,AAAA', seal = 'data:image/webp;base64,BBBB';
  const artwork = { source: seal, node: create('img') };
  glass.refresh(hall, artwork);
  table.seats.P1 = ['G'];
  glass.refresh(hall, artwork);
  assert.equal(decodes.length, 2);
  assert.deepEqual(cancelled, []);
  glass.clear();
  assert.deepEqual(cancelled, [hall,seal]);
  decodes.forEach(finish => finish());
  await settle();
  assert.equal(canvases, 0);
  assert.equal(game.dataset.glassHallReady, undefined);
});

test('reuses decoded art, coalesces requests, and never installs a stale medallion or next-skin URL', async () => {
  const { document, game, root } = rendererDocument();
  const calls = [], pending = new Map(), revoked = [];
  document.defaultView = { URL: { createObjectURL: blob => 'blob:' + blob, revokeObjectURL: url => revoked.push(url) } };
  const table = { owner: 'P1', viewed: 'P1', seats: { P1: ['U'], P2: ['B','G'] } };
  const makeArtwork = async (_, source) => {
    calls.push(source);
    return { render: colors => new Promise(done => pending.set(source + '/' + colors.join(''), done)) };
  };
  const glass = createCommanderGlass(document, () => table, makeArtwork);
  const counter = { node: document.createElement('img'), source: 'seal' };
  glass.refresh('hall', counter);
  await settle();
  table.viewed = 'P2';
  glass.refresh('hall', counter);
  pending.get('seal/U')('old-blue');
  pending.get('hall/U')('blue-hall');
  await settle();
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), 'url("blob:blue-hall")');
  assert.equal(counter.node.getAttribute('src'), null);
  assert.equal(counter.node.hidden, true);
  assert.equal(game.dataset.glassDialReady, undefined);
  pending.get('seal/BG')('opal-seal');
  await settle();
  assert.equal(counter.node.getAttribute('src'), 'blob:opal-seal');
  assert.equal(game.dataset.glassDialReady, 'BG');
  const nextMode = { node: document.createElement('img'), engraving: document.createElement('img'), source: 'seal' };
  glass.refresh('hall', nextMode);
  assert.equal(nextMode.node.getAttribute('src'), 'blob:opal-seal');
  assert.equal(nextMode.engraving.getAttribute('src'), 'blob:opal-seal');
  table.seats.P1 = [...'WUBRG']; table.viewed = 'P1';
  glass.refresh('hall', nextMode);
  assert.equal(nextMode.node.getAttribute('src'), 'blob:opal-seal');
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), 'url("blob:blue-hall")');
  assert.equal(game.dataset.glassDialReady, undefined);
  assert.equal(game.dataset.glassHallReady, undefined);
  pending.get('seal/WUBRG')('five-seal');
  pending.get('hall/WUBRG')('five-hall');
  await settle();
  assert.equal(nextMode.node.getAttribute('src'), 'blob:five-seal');
  assert.equal(nextMode.engraving.getAttribute('src'), 'blob:five-seal');
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), 'url("blob:five-hall")');
  assert.equal(game.dataset.glassHallReady, 'WUBRG');
  assert.deepEqual(calls, ['hall', 'seal']);
  table.seats.P1 = ['R'];
  glass.refresh('hall', nextMode);
  glass.clear();
  pending.get('seal/R')('stale-seal');
  pending.get('hall/R')('stale-hall');
  await settle();
  assert.equal(game.dataset.glassHallReady, undefined);
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), '');
  assert.deepEqual(new Set(revoked), new Set(['blob:old-blue','blob:opal-seal','blob:blue-hall','blob:five-seal','blob:five-hall']));
});

test('failed materialization shows a neutral surface; only verified unpigmented art can pass through', async () => {
  const { document, root, game } = rendererDocument();
  const revoked = [];
  document.defaultView = { URL: { createObjectURL: key => 'blob:' + key, revokeObjectURL: url => revoked.push(url) } };
  const table = { owner: 'P1', viewed: 'P1', seats: { P1: [] } };
  const glass = createCommanderGlass(document, () => table, async (_, source) => {
    if (source === 'unavailable') throw Error('Image decoder unavailable');
    if (source === 'unpigmented') return { original: true };
    return { render: async colors => colors.join('') || 'silver' };
  });
  for (const color of ['W','U','B','W','G']) {
    table.seats.P1 = [color]; glass.refresh('hall');
    await settle();
  }
  assert.deepEqual(revoked, ['blob:U']);
  glass.refresh('unavailable');
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), '');
  await settle();
  assert.equal(game.dataset.glassHallReady, undefined);
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), '');
  assert.deepEqual(new Set(revoked), new Set(['blob:W','blob:U','blob:B','blob:G']));
  glass.refresh('unpigmented');
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), '');
  await settle();
  assert.equal(game.dataset.glassHallReady, 'G');
  assert.equal(root.style.getPropertyValue('--prism-rendered-hall'), 'url("unpigmented")');
  glass.clear();
});
