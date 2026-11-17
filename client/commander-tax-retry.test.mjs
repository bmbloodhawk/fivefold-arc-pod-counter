import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function renderCommanderTaxDialog()'), app.indexOf('async function adjust('))
  + app.slice(app.indexOf('async function updateCommanderCastCount('), app.indexOf('async function resetGame('));

test('a failed commander cast restores its controls and a retry saves the intended count once', async () => {
  const player = { id: 'P1', name: 'Alex' }, commander = { id: 'seat-0-commander-a', ownerPlayerId: 'P1' };
  const state = { ownerPlayerId: 'P1', commanderCastCounts: {} };
  let buttons = [], attempts = 0;
  const errors = [], values = [];
  const list = {
    set innerHTML(html) {
      buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => ({
        disabled: /\bdisabled\b/.test(attributes), dataset: {}, addEventListener() {},
      }));
    },
  };
  const api = runInNewContext(source + '\n({renderCommanderTaxDialog, updateCommanderCastCount})', {
    state, dom: { commanderTaxDetail: {}, commanderTaxList: list },
    commanderTaxPlayer: () => player, commanderTaxEnabled: () => true,
    ownCommanderSources: () => [commander], displayPlayer: () => 'Alex · P1',
    displayName: () => 'Alex', displaySource: () => 'Commander', sourceOwnerLabel: () => 'Alex',
    escapeHtml: value => value, $$: () => buttons,
    transport: { async setCommanderCastCount(id, value) {
      attempts++; values.push(value);
      if (attempts === 1) throw Object.assign(new Error('Try again'), { status: 503 });
      state.commanderCastCounts[id] = value;
      return {};
    } },
    showError: error => errors.push(error.message),
    reconcileTableWriteError() { throw new Error('A known HTTP failure does not require reconnecting'); },
    render() {},
  });
  api.renderCommanderTaxDialog();
  assert.equal(buttons[0].disabled, false);
  await api.updateCommanderCastCount(commander.id, 1);
  assert.deepEqual(errors, ['Try again']);
  assert.equal(state.commanderCastCounts[commander.id], undefined);
  assert.equal(buttons[0].disabled, false, 'Cast is available without closing and reopening');
  assert.equal(buttons[1].disabled, true, 'Undo stays disabled while no cast was saved');
  await api.updateCommanderCastCount(commander.id, 1);
  assert.deepEqual(values, [1, 1]);
  assert.equal(state.commanderCastCounts[commander.id], 1);
  assert.equal(buttons[1].disabled, false);
});
