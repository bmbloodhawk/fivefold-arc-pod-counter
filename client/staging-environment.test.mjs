import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const app = await readFile(new URL('app.js', root), 'utf8');
const styles = await readFile(new URL('styles.css', root), 'utf8');
const stagingConfig = await readFile(new URL('../render.staging.yaml', root), 'utf8');

test('the staging deployment is isolated, free-tier, and visibly marked', () => {
  assert.match(stagingConfig, /name: fivefold-arc-pod-counter-staging/);
  assert.match(stagingConfig, /plan: free/);
  assert.match(stagingConfig, /branch: staging/);
  assert.match(stagingConfig, /APP_ENV\n\s+value: staging/);
  assert.match(app, /fivefold-arc-pod-counter-staging/);
  assert.match(app, /TEST ENVIRONMENT/);
  assert.match(styles, /\.staging-environment-banner/);
});
