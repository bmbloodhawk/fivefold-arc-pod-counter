import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionPresentation } from './connection-state.js';

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
