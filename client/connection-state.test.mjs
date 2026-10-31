import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { connectionPresentation } from './connection-state.js';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

test('offline wording makes confirmed-state and no-queue safety explicit', () => {
  const presentation = connectionPresentation({ status: 'disconnected' });
  assert.equal(presentation.showOffline, true);
  assert.match(presentation.detail, /confirmed table state/i);
  assert.match(presentation.detail, /nothing entered here will be queued/i);
});

test('a received snapshot after reconnect gets an explicit resync acknowledgement', () => {
  const presentation = connectionPresentation({ status: 'connected', resynced: true });
  assert.equal(presentation.showOffline, false);
  assert.match(presentation.syncMessage, /Synced.*just now/i);
});

test('an ambiguous life-write response rechecks the table before showing offline', () => {
  assert.match(app, /async function reconcileLifeWriteError\(error\)/);
  assert.match(app, /await transport\.refreshRoom\(\);/);
  assert.match(app, /renderConnection\('connected'\);/);
  assert.match(app, /renderConnection\('disconnected'\); showError\(error\);/);
});
