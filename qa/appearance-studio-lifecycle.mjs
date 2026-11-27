// Browser regression against qa/appearance-studio-local.mjs only; never a live catalog.
// PLAYWRIGHT_TOOLING points to a package.json with playwright-core installed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:8788/review');
assert.equal(origin.hostname, '127.0.0.1', 'This regression only runs against the disposable loopback fixture.');
assert.equal((await fetch(origin)).headers.get('x-studio-fixture'),'memory','Use a disposable in-memory Studio for this regression.');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const { chromium } = require('playwright-core');
const directory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(), 'appearance-studio-lifecycle-20261123'));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const checks = [], errors = [], requests = [], dialogs = [], measurements = [];
let page, latestCatalog, nextDialog = true;
const record = name => checks.push(name);
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  page.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); const accept = nextDialog; nextDialog = true; await (accept ? dialog.accept() : dialog.dismiss()); });
  page.on('response', async response => { if (new URL(response.url()).pathname === '/api/appearance-studio/catalog' && response.ok()) latestCatalog = (await response.json()).catalog; });
  await page.goto(origin.href);
  await page.waitForSelector('body.studio-workspace');
  await page.waitForSelector('[data-skin="ember-library"]');
  const initialApproved = structuredClone(latestCatalog.skins.find(skin => skin.id === 'ember-library'));
  const selectedId = () => page.locator('#skinLibrary .skin-card.selected').getAttribute('data-skin');
  async function catalogAction(button) {
    const waiting = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog' && response.request().method() === 'PUT');
    await button.click();
    const response = await waiting, result = await response.json();
    assert.equal(response.ok(), true, JSON.stringify(result));
    await page.waitForFunction(() => !document.querySelector('#saveButton').disabled);
    return result.catalog;
  }
  async function background(value) { await page.locator('#background').fill(value); }
  async function previewBackground(value) {
    await page.waitForFunction(expected => {
      const root = document.querySelector('#exactPreview')?.contentDocument?.documentElement;
      return root && getComputedStyle(root).getPropertyValue('--bg').trim() === expected;
    }, value);
  }
  async function rendererVersion(value) { await page.waitForFunction(version => document.querySelector('#exactPreview')?.contentDocument?.documentElement.dataset.rendererVersion === String(version), value); }
  async function rendererSignature() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.locator('#exactPreview').evaluate(frame => {
      const nav = frame.contentDocument.querySelector('.mode-nav'), button = nav.querySelector('button');
      return { height: nav.getBoundingClientRect().height, color: getComputedStyle(button).color, weight: getComputedStyle(button).fontWeight, fontSize: getComputedStyle(button).fontSize, background: getComputedStyle(nav).backgroundColor };
    });
  }

  await page.locator('[data-skin="__neutral_arc__"]').click();
  assert.equal(await page.locator('#saveButton').isDisabled(), true);
  assert.equal(await page.locator('#publishButton').isDisabled(), true);
  assert.equal(await page.locator('#duplicateButton').innerText(), 'Start editable neutral draft');
  const beforeStartingDraft = requests.length;
  await page.locator('#duplicateButton').click();
  assert.notEqual(await selectedId(), '__neutral_arc__');
  assert.equal(await page.locator('#saveButton').isEnabled(), true);
  assert.equal(requests.length, beforeStartingDraft);
  await page.locator('.skin-management>summary').click();
  assert.equal(await page.locator('#skinName').inputValue(), 'Neutral Studio draft');
  assert.match(await page.locator('#neutralRecipeNote').innerText(), /editable Neutral palette/);
  await page.locator('.skin-management>summary').click();
  await page.locator('[data-skin="__neutral_arc__"]').click();
  record('built-in reference blocks Save and Publish; its start action creates an unsaved editable recipe without writes');
  const initialAccent = await page.locator('#accent').inputValue();
  await page.locator('#accent').fill('#99aa00');
  const automaticId = await selectedId();
  assert.notEqual(automaticId, '__neutral_arc__');
  await page.locator('#undoButton').click();
  assert.equal(await selectedId(), '__neutral_arc__');
  assert.equal(await page.locator('#accent').inputValue(), initialAccent);
  assert.match(await page.locator('#saveState').innerText(), /Game default reference/);
  assert.equal(await page.locator('#saveButton').isDisabled(), true);
  await page.locator('#redoButton').click();
  assert.equal(await selectedId(), automaticId);
  assert.equal(await page.locator('#accent').inputValue(), '#99aa00');
  assert.equal(await page.locator('#saveButton').isEnabled(), true);
  await page.locator('#undoButton').click();
  record('Undo returned the automatic Neutral fork to a clean canonical baseline and Redo recreated it');

  await page.locator('[data-skin="ember-library"]').click();
  await rendererVersion(1);
  assert.equal(await page.locator('#background').isDisabled(), true);
  const originalSignature = await rendererSignature();
  measurements.push({ state: 'Original legacy source', ...originalSignature });
  await page.screenshot({ path: resolve(directory, 'legacy-original.png'), fullPage: false });
  await page.locator('.skin-management>summary').click();
  await page.locator('#skinName').fill('Ember archive renamed');
  const renamedLegacy = await catalogAction(page.locator('#saveButton'));
  const renamedLegacyId = await selectedId();
  assert.equal(Object.hasOwn(renamedLegacy.skins.find(skin => skin.id === renamedLegacyId), 'rendererVersion'), false);
  assert.equal(Object.hasOwn(renamedLegacy.skins.find(skin => skin.id === renamedLegacyId), 'componentColors'), false);
  await rendererVersion(1);
  assert.deepEqual(await rendererSignature(), originalSignature);
  measurements.push({ state: 'Renamed legacy copy', ...await rendererSignature() });
  const copiedLegacy = await catalogAction(page.locator('#duplicateButton'));
  const copiedLegacyId = await selectedId();
  assert.equal(Object.hasOwn(copiedLegacy.skins.find(skin => skin.id === copiedLegacyId), 'rendererVersion'), false);
  await rendererVersion(1);
  assert.deepEqual(await rendererSignature(), originalSignature);
  measurements.push({ state: 'Unchanged legacy duplicate', ...await rendererSignature() });
  record('legacy rename and unchanged duplicate preserved raw version absence and actual navigation geometry/colors');
  const beforeExpansion = requests.length;
  await page.locator('#expandAppearanceControls').click();
  const expandedId = await selectedId();
  await rendererVersion(2);
  measurements.push({ state: 'Explicit expanded preview', ...await rendererSignature() });
  await page.screenshot({ path: resolve(directory, 'expanded-draft.png'), fullPage: false });
  assert.equal(requests.length, beforeExpansion);
  assert.equal(await page.locator('#background').isEnabled(), true);
  await page.locator('#undoButton').click();
  assert.equal(await selectedId(), copiedLegacyId);
  await rendererVersion(1);
  assert.deepEqual(await rendererSignature(), originalSignature);
  await page.locator('#redoButton').click();
  assert.equal(await selectedId(), expandedId);
  await rendererVersion(2);
  await page.locator('#compareTarget').selectOption('saved');
  await rendererVersion(1);
  assert.deepEqual(await rendererSignature(), originalSignature);
  await page.locator('#previewButton').click();
  await rendererVersion(2);
  record('explicit expansion staged a separate unsaved version two with original comparison and version-aware Undo/Redo');
  await page.locator('.skin-management>summary').click();
  await background('#102f2a');
  const saved = await catalogAction(page.locator('#saveButton'));
  const savedId = await selectedId();
  assert.notEqual(savedId, 'ember-library');
  assert.equal(saved.skins.find(skin => skin.id === savedId).status, 'Draft');
  assert.equal(saved.skins.find(skin => skin.id === savedId).rendererVersion, 2);
  assert.deepEqual(saved.skins.find(skin => skin.id === 'ember-library'), initialApproved);
  record('approved source forked into a separate Draft and remained exact');

  for (let count = 0; count < 4; count++) {
    const version = await page.locator('#exactPreview').evaluate(frame => frame.contentDocument.documentElement.dataset.rendererVersion);
    if (version === '1') break;
    await page.locator('#undoButton').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await rendererVersion(1);
  const savedLegacyVersion = await catalogAction(page.locator('#saveButton'));
  assert.equal(Object.hasOwn(savedLegacyVersion.skins.find(skin => skin.id === savedId), 'rendererVersion'), false);
  await page.getByRole('button', { name: 'History & backups', exact: true }).click();
  await page.locator('[data-restore-skin-version="0"]').click();
  await rendererVersion(2);
  const savedExpandedVersion = await catalogAction(page.locator('#saveButton'));
  assert.equal(savedExpandedVersion.skins.find(skin => skin.id === savedId).rendererVersion, 2);
  await page.locator('[data-restore-skin-version="1"]').click();
  await rendererVersion(1);
  await page.locator('#undoButton').click();
  await rendererVersion(2);
  assert.equal(await page.locator('#saveState').innerText(), 'Saved draft');
  await page.getByRole('button', { name: 'Colors & mood', exact: true }).click();
  record('saved-version restore respected original and expanded renderer generations; Undo returned to the clean saved appearance');

  const duplicated = await catalogAction(page.locator('#duplicateButton'));
  const duplicateId = await selectedId();
  assert.notEqual(duplicateId, savedId);
  assert.equal(duplicated.skins.find(skin => skin.id === duplicateId).status, 'Draft');
  record('duplicate saved a separate Draft without replacing the source');

  await background('#26414a');
  await page.locator('#compareTarget').selectOption('saved');
  await previewBackground('#102f2a');
  await page.locator('#compareTarget').selectOption('skin:ember-library');
  await previewBackground(initialApproved.background);
  await page.locator('#previewButton').click();
  await previewBackground('#26414a');
  record('saved and other-skin comparison used the real renderer without changing the draft');

  nextDialog = false;
  await page.locator('[data-skin="__neutral_arc__"]').click();
  assert.equal(await selectedId(), duplicateId);
  record('canceling a skin switch retained unsaved work');

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#saveState')?.textContent.includes('Recovered unsaved draft'));
  assert.equal(await page.locator('#background').inputValue(), '#26414a');
  assert.equal(await selectedId(), duplicateId);
  record('reload recovered the unsaved draft from this isolated tab');

  await background('#334455');
  await page.locator('#undoButton').click();
  assert.equal(await page.locator('#background').inputValue(), '#26414a');
  await page.locator('#redoButton').click();
  assert.equal(await page.locator('#background').inputValue(), '#334455');
  await page.locator('#sectionReset').click();
  assert.equal(await page.locator('#background').inputValue(), '#102f2a');
  await page.locator('#undoButton').click();
  assert.equal(await page.locator('#background').inputValue(), '#334455');
  record('Undo, Redo, and section reset preserved recoverable edits');

  const downloadEvent = page.waitForEvent('download');
  await page.locator('#exportCatalogButton').click();
  const download = await downloadEvent;
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.deepEqual(backup.skins.find(skin => skin.id === 'ember-library'), initialApproved);
  assert.equal(backup.skins.find(skin => skin.id === duplicateId).background, '#102f2a');
  record('portable export included saved catalog and exact approved source');

  await page.getByRole('button', { name: 'History & backups', exact: true }).click();
  await page.locator('#catalogBackupFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 99, skins: [], assets: [] })) });
  const beforeInvalid = requests.length;
  await page.locator('#validateCatalogButton').click();
  await page.waitForFunction(() => document.querySelector('#catalogRestoreStatus')?.textContent.includes('unsupported schema'));
  await page.locator('#restoreCatalogButton').click();
  assert.equal(requests.length, beforeInvalid);
  record('invalid future backup was rejected before any write');

  await page.locator('#catalogBackupFile').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  const restoreResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog/restore');
  await page.locator('#restoreCatalogButton').click();
  const restoredResponse = await restoreResponse, restored = await restoredResponse.json();
  assert.equal(restoredResponse.ok(), true, JSON.stringify(restored));
  assert.deepEqual(restored.catalog.skins.find(skin => skin.id === 'ember-library'), initialApproved);
  record('explicit restore retained approved source and protected default layout');

  await page.locator('[data-skin="' + duplicateId + '"]').click();
  await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
  const publishResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/publish'));
  await page.locator('#publishButton').click();
  const approvedResponse = await publishResponse, approved = await approvedResponse.json();
  assert.equal(approvedResponse.ok(), true, JSON.stringify(approved));
  assert.equal(approved.skin.status, 'Approved');
  assert.deepEqual(approved.catalog.skins.find(skin => skin.id === 'ember-library'), initialApproved);
  assert.equal(approved.catalog.gameDefaultLayout, null);
  record('explicit local publication approved only the Draft and retained protected source/default');

  await page.locator('[data-skin="__neutral_arc__"]').click();
  assert.equal(await selectedId(), '__neutral_arc__');
  await page.getByRole('button', { name: 'Colors & mood', exact: true }).click();

  await page.locator('[data-skin="' + savedId + '"]').click();
  await background('#183847');
  const other = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  other.on('pageerror', error => errors.push(error.message));
  other.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  await other.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort());
  await other.goto(origin.href);
  await other.waitForSelector('[data-skin="harbor-study"]');
  await other.locator('[data-skin="harbor-study"]').click();
  await other.locator('.skin-management>summary').click();
  const concurrentName = 'Harbor update ' + Date.now().toString(36);
  await other.locator('#skinName').fill(concurrentName);
  const concurrentResponse = other.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog' && response.request().method() === 'PUT');
  await other.locator('#saveButton').click();
  assert.equal((await concurrentResponse).ok(), true);
  await other.close();
  const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog' && response.request().method() === 'PUT');
  await page.locator('#saveButton').click();
  assert.equal((await staleResponse).status(), 409);
  assert.equal(await page.locator('#background').inputValue(), '#183847');
  const refreshedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog' && response.request().method() === 'GET');
  await page.locator('#refreshCatalogButton').click(); await refreshedResponse;
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('Catalog refreshed'));
  const retried = await catalogAction(page.locator('#saveButton'));
  assert.notEqual(await selectedId(), savedId);
  assert.equal(retried.skins.find(skin => skin.id === savedId).background, '#102f2a');
  assert.equal(retried.skins.find(skin => skin.id === 'harbor-study').name, concurrentName);
  record('stale revision kept unsaved work and safely retried as a separate copy after refresh');

  await page.locator('[data-skin="__neutral_arc__"]').click();
  await page.locator('.skin-management>summary').click();
  await page.locator('.appearance-presets-panel>summary').click();
  assert.equal(await page.locator('[data-appearance-preset="neutral"]').innerText(), 'Neutral Studio');
  await page.locator('[data-appearance-preset="seasonalEmber"]').click();
  await page.locator('#skinName').fill('Harbor prototype');
  const custom = await catalogAction(page.locator('#saveButton'));
  const customId = await selectedId();
  assert.equal(custom.skins.find(skin => skin.id === customId).name, 'Harbor prototype');
  await page.locator('[data-appearance-preset="premiumCandidate"]').click();
  await previewBackground('#130c22');
  await page.locator('#undoButton').click();
  await previewBackground('#180d09');
  assert.equal(await page.locator('#saveState').innerText(), 'Saved draft');
  await page.locator('#redoButton').click();
  await previewBackground('#130c22');
  await page.locator('#sectionReset').click();
  await previewBackground('#180d09');
  await page.locator('#undoButton').click();
  await previewBackground('#130c22');
  const info = await page.locator('.skin-source-info').innerText();
  assert.ok(!/unlocked|purchased|premium owned|host offered/i.test(info));
  record('named starter presets, custom rename, scoped reset and Undo remained cosmetic without implied entitlements');
  await page.locator('[data-skin="__neutral_arc__"]').click();

  await page.getByRole('button', { name: 'History & backups', exact: true }).click();
  const incoming = structuredClone(latestCatalog);
  const portableSkinId = 'portable-candidate-' + Date.now(), portableAssetId = 'portable-art-' + Date.now();
  incoming.skins.push({ id: portableSkinId, name: 'Portable candidate', status: 'Approved', rendererVersion: 2, backgroundAsset: portableAssetId });
  incoming.assets.push({ id: portableAssetId, name: 'Portable original', source: 'Original QA fixture', placement: 'background', status: 'Approved', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=' });
  const expectedPending = incoming.assets.filter(asset => asset.status === 'Pending').length + 1;
  await page.locator('#catalogBackupFile').setInputFiles({ name: 'portable-approved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await page.locator('#validateCatalogButton').click();
  await page.waitForFunction(pending => document.querySelector('#catalogRestoreStatus').textContent.includes(`1 imported skins restore as Draft; ${pending} artwork files remain Pending`), expectedPending);
  const portableRestore = page.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog/restore');
  await page.locator('#restoreCatalogButton').click();
  const portableResponse = await portableRestore, portable = await portableResponse.json();
  assert.equal(portableResponse.ok(), true, JSON.stringify(portable));
  assert.equal(portable.catalog.skins.find(skin => skin.id === portableSkinId).status, 'Draft');
  assert.equal(portable.catalog.assets.find(asset => asset.id === portableAssetId).status, 'Pending');
  assert.deepEqual(portable.catalog.skins.find(skin => skin.id === 'ember-library'), initialApproved);
  record('backup dry-run and restore agreed: imported approvals became Draft/Pending without publishing or access writes');
  await page.locator('[data-skin="__neutral_arc__"]').click();
  await page.getByRole('button', { name: 'Colors & mood', exact: true }).click();
  await page.screenshot({ path: resolve(directory, 'neutral-baseline.png'), fullPage: false });
  assert.ok(requests.every(request => request.path.startsWith('/api/appearance-studio/')), 'Only Studio authoring endpoints may receive writes.');
  assert.equal(errors.length, 0, errors.join('\n'));
  record('canonical baseline remained selectable; zero page errors and zero gameplay writes');
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ passed: true, checks, errors, requests, dialogs, measurements }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, report: resolve(directory, 'report.json') }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: false }).catch(() => {});
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ passed: false, checks, errors, requests, dialogs, measurements, failure: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }
