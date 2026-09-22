import assert from 'node:assert/strict';
import test from 'node:test';
import { disposeTrayResources } from './dice-roll-3d.js';

test('disposing a prior d20 tray releases its meshes before removal', () => {
  const calls = [];
  const group = {
    traverse(visitor) {
      visitor({ geometry: { dispose: () => calls.push('geometry') }, material: { dispose: () => calls.push('material') } });
      visitor({ material: [{ dispose: () => calls.push('material-a') }, { dispose: () => calls.push('material-b') }] });
    },
    clear: () => calls.push('clear'),
  };

  disposeTrayResources(group);

  assert.deepEqual(calls, ['geometry', 'material', 'material-a', 'material-b', 'clear']);
});
