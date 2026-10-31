import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('service worker serves one complete release cache and activates only after every game page confirms safety', async () => {
  const worker = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
  assert.match(worker, /const RELEASE_ID = '2026-10-30-safe-reclaim-11'/);
  assert.match(worker, /active-table-recovery\.js\?v=1/);
  assert.match(worker, /release-update\.js\?v=2/);
  assert.match(worker, /game-wake-lock\.js\?v=1/);
  assert.match(worker, /ACTIVATE_WHEN_SAFE/);
  assert.match(worker, /clients\.matchAll\(\{ type: 'window', includeUncontrolled: true \}\)/);
  assert.match(worker, /if \(safe\) await self\.skipWaiting\(\)/);
  assert.doesNotMatch(worker, /clients\.claim|location\.reload/);
  assert.match(worker, /cache\.match\(event\.request\)/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request/);
});
