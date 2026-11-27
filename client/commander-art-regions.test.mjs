import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedRegionSurface, validCommanderRegions } from './commander-art-regions.js';
import { publicAppearanceSkin, validateAppearanceSkin } from './appearance-validation.js';
import { buildRendererTheme } from './renderer-bridge.js';

const shape = { slot: 1, points: [[0, 0], [90, 2], [50, 90]] };
const configuration = { assetId: 'art-101', source: 'owner', regions: [shape] };
const skin = { id: 'new-design', name: 'New design', rendererVersion: 2, commanderTreatment: 'art-regions', backgroundAsset: 'art-101', commanderRegions: { background: configuration } };

test('an editable region map round-trips as independent inert renderer data on existing artwork', () => {
  assert.deepEqual(validateAppearanceSkin(skin).errors, []);
  assert.deepEqual(publicAppearanceSkin(skin).commanderRegions, skin.commanderRegions);
  assert.notEqual(publicAppearanceSkin(skin).commanderRegions.background, configuration);
  assert.equal(assignedRegionSurface(skin, 'background'), configuration);
  assert.equal(buildRendererTheme(skin, 'button').datasets.commanderTreatment, 'art-regions');
  assert.equal(buildRendererTheme({ ...skin, rendererVersion: 1 }, 'button').datasets.commanderTreatment, undefined);
  const replaced = { ...skin, backgroundAsset: 'replacement' };
  assert.equal(assignedRegionSurface(replaced, 'background'), null);
  assert.ok(validateAppearanceSkin(replaced, { publish: true }).errors.some(item => item.path === 'skin.commanderRegions.background'));
});

test('region outlines are finite polygons of bounded size, closed to unknown fields and identities', () => {
  for (const bad of [
    { other: configuration },
    { life: { ...configuration, source: 'arbitrary' } },
    { life: { ...configuration, regions: new Array(13).fill(shape) } },
    { life: { ...configuration, regions: [{ ...shape, slot: 6 }] } },
    { life: { ...configuration, regions: [{ ...shape, points: [[0,0],[1,1],[2,2]] }] } },
    { life: { ...configuration, regions: [{ ...shape, points: [[0,0],[100,100],[Infinity,2]] }] } },
    { life: { ...configuration, regions: [{ ...shape, points: Array(33).fill([0,0]) }] } },
    { life: { ...configuration, regions: [{ ...shape, style: 'color:red' }] } },
  ]) {
    assert.equal(validCommanderRegions(bad), false);
    assert.equal(publicAppearanceSkin({ ...skin, commanderRegions: bad }).commanderRegions, undefined);
    assert.ok(validateAppearanceSkin({ ...skin, commanderRegions: bad }).errors.length);
  }
});
