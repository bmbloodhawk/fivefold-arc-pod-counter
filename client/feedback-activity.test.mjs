import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the private feedback inbox shows aggregate live activity only in Diagnostics', async () => {
  const page = await readFile(new URL('./feedback.html', import.meta.url), 'utf8');
  assert.match(page, /id="activeActivityButton"/);
  assert.match(page, /\/api\/feedback\/activity/);
  assert.match(page, /Connected players/);
  assert.match(page, /Playing tables/);
});
