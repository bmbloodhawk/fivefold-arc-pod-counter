import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('service worker keeps activation browser-managed and serves one complete release cache', async () => {
  const worker = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
  assert.match(worker, /const RELEASE_ID = '2026-10-30-safe-reclaim-3'/);
  assert.match(worker, /active-table-recovery\.js\?v=1/);
  assert.match(worker, /release-update\.js\?v=1/);
  assert.match(worker, /game-wake-lock\.js\?v=1/);
  assert.doesNotMatch(worker, /skipWaiting|clients\.claim|location\.reload/);
  assert.match(worker, /cache\.match\(event\.request\)/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request/);
});
