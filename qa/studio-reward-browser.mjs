import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
assert.equal((await fetch(url)).headers.get('x-studio-fixture'), 'memory');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const engine = process.env.STUDIO_BROWSER || 'chromium';
const browser = await require('playwright-core')[engine].launch({
  headless:true, ...(engine === 'chromium' ? {executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'} : {}),
});
try {
  const page = await browser.newPage({viewport:{width:1600,height:960},serviceWorkers:'block'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-skin="__neutral_arc__"]').click();
  await page.locator('#workspaceReview').click();
  const choose = async (id,title) => {
    await page.locator('#rewardSearch').fill(title);
    await page.locator('#rewardAchievement').selectOption(id);
    await page.locator('#addRewardAchievement').click();
  };
  await choose('settling-in','Settling In');
  await choose('first-crown','First Crown');
  const editor = page.locator('#studioRewardEditor');
  await editor.locator('summary').click();
  const preview = editor.locator('[data-player-preview]');
  assert.match(await preview.textContent(), /0 of 2 achievements earned · Locked/);
  await editor.getByRole('checkbox',{name:'First Crown'}).check();
  assert.match(await preview.textContent(), /1 of 2 achievements earned · Locked/);
  await editor.getByRole('checkbox',{name:'Settling In'}).check();
  assert.match(await preview.textContent(), /2 of 2 achievements earned · Unlocked/);
  assert.equal(await page.locator('#publicationControls').isVisible(),false);
  const saved = page.waitForResponse(res => new URL(res.url()).pathname === '/api/appearance-studio/catalog' && res.request().method() === 'PUT');
  await page.locator('#saveButton').click();
  const response = await saved;
  const payload = await response.json();
  assert.equal(response.status(),200,JSON.stringify(payload));
  const draft = payload.catalog.skins.find(skin => skin.id === payload.catalog.selected);
  assert.deepEqual(draft.rewardRule.allOf,['settling-in','first-crown']);
  await page.reload();
  await page.locator('[data-skin="' + draft.id + '"]').click();
  await page.locator('#workspaceReview').click();
  await editor.locator('[data-reward-steps]').getByText('First Crown').waitFor();
  await editor.getByRole('button',{name:'Remove First Crown'}).click();
  await editor.getByRole('button',{name:'Remove Settling In'}).click();
  assert.equal(await page.locator('#publicationControls').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log(engine,'passed Studio unlock editing, simulated progress, saving and reloading a fresh skin');
} finally {await browser.close();}
