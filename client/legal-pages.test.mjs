import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const index = await readFile(new URL('index.html', root), 'utf8');
const privacy = await readFile(new URL('privacy.html', root), 'utf8');
const terms = await readFile(new URL('terms.html', root), 'utf8');
const serviceWorker = await readFile(new URL('sw.js', root), 'utf8');

test('public legal pages explain the current privacy boundary and independent game status', () => {
  assert.match(index, /href="privacy\.html">Privacy and data/);
  assert.match(index, /href="terms\.html">Terms of use/);
  assert.match(privacy, /Firebase Authentication/);
  assert.match(privacy, /Delete my account data/);
  assert.match(privacy, /not directed to children under 13/);
  assert.match(terms, /unofficial companion/);
  assert.match(terms, /not affiliated with, endorsed by, or sponsored by Wizards of the Coast LLC/);
  assert.match(terms, /does not make official game rulings/);
  assert.match(serviceWorker, /fivefold-arc-v311/);
  assert.match(serviceWorker, /'\.\/terms\.html'/);
});
