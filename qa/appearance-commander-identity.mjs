// Exercise the real Studio and renderer against a disposable, loopback-only catalog.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
assert.equal((await fetch(url)).headers.get('x-studio-fixture'), 'memory');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const engine = process.env.STUDIO_BROWSER || 'chromium';
const browser = await require('playwright-core')[engine].launch({
  headless: true,
  ...(engine === 'chromium' ? {executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'} : {})
});
const page = await browser.newPage({ viewport: {width: 1600, height: 960}, serviceWorkers: 'block' });
const errors = [];
const saves = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/appearance-studio/catalog') saves.push(request.postDataJSON());
});

async function waitForIdentity(owner, viewed) {
  await page.waitForFunction(({owner, viewed}) => {
    const doc = document.querySelector('#exactPreview')?.contentDocument;
    if (doc?.querySelector('#gameView')?.dataset.commanderTreatment !== 'prismatic-glass') return false;
    const game = doc.querySelector('#gameView');
    return game.dataset.glassOwner === owner && game.dataset.glassViewed === viewed
      && game.dataset.glassHallReady === owner && game.dataset.glassDialReady === viewed;
  }, {owner, viewed});
}

try {
  await page.goto(url.href);
  await page.locator('[data-skin="harbor-study"]').click();
  await page.getByRole('button', {name: 'Colors & mood', exact: true}).click();
  const treatment = page.locator('#commanderTreatment');
  const strength = page.locator('[data-counter-field="artOpacity"]');
  const engraving = page.getByRole('checkbox', {name:'Keep center engraving upright'});
  assert.equal(await strength.getAttribute('max'), '55');
  assert.equal(await engraving.count(), 0);
  await treatment.selectOption('prismatic-glass');
  assert.equal(await strength.getAttribute('max'), '100');
  await waitForIdentity('UR', 'UR');
  const owner = page.getByRole('group', {name: 'Your commander', exact: true});
  for (const name of ['Blue', 'Red']) await owner.getByLabel(name).uncheck();
  await waitForIdentity('C', 'C');
  for (const name of ['White','Blue','Black','Red','Green']) await owner.getByLabel(name).check();
  const five = 'WUBRG';
  await waitForIdentity(five, five);
  for (const name of ['White', 'Black', 'Red', 'Green']) await owner.getByLabel(name).uncheck();
  await page.locator('#previewPartner').check();
  await waitForIdentity('UG', 'UG');
  await page.locator('#previewInspectPlayer').check();
  await waitForIdentity('UG', 'WB');
  assert.equal(saves.length, 0);

  await page.getByRole('button',{name:'Counter faces & icons',exact:true}).click();
  await engraving.check();
  await page.locator('#saveButton').click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Saved draft');
  assert.equal(saves.length, 1);
  const saved = saves[0].skins.find(skin => skin.id === 'harbor-study');
  assert.equal(saved.commanderTreatment, 'prismatic-glass');
  assert.equal(saved.counterDesign.modes.life.uprightCenter, true);
  assert.ok(!Object.keys(saved).some(key => key.startsWith('preview')), 'preview colors must stay out of saved skins');
  await page.getByRole('button',{name:'Colors & mood',exact:true}).click();
  await page.locator('#previewInspectPlayer').uncheck();
  await waitForIdentity('UG', 'UG');
  assert.equal(await page.locator('#saveState').innerText(), 'Saved draft');
  await page.reload();
  await page.locator('[data-skin="harbor-study"]').click();
  await waitForIdentity('UR', 'UR');
  await page.getByRole('button',{name:'Counter faces & icons',exact:true}).click();
  assert.equal(await engraving.isChecked(), true);
  await page.locator('[data-counter-reset="life"]').click();
  assert.equal(await engraving.isChecked(), false);
  await engraving.check();
  await page.getByRole('button',{name:'Colors & mood',exact:true}).click();
  await treatment.selectOption('');
  assert.equal(await strength.getAttribute('max'), '55');
  await page.waitForFunction(() => !document.querySelector('#exactPreview').contentDocument.querySelector('#gameView').dataset.commanderTreatment);
  assert.equal(await page.locator('.commander-preview-controls').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('Passed Studio authoring and exact renderer checks for colorless, five colors, partners, inspected seats, save, reload and reset.');
} finally {
  await browser.close();
}
