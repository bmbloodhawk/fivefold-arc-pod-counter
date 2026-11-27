// Rehearse an already-authored premium skin through the same desktop controls a
// designer uses. Only the isolated local release registry is allowed to change.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [url, skinId, out, engine = 'chromium'] = process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1');
assert.match(skinId, /^skin-[a-zA-Z0-9_-]+$/);
assert.ok(['file', 'memory'].includes((await fetch(url)).headers.get('x-studio-fixture')));
await mkdir(out, { recursive: true });
const { chromium, webkit } = createRequire(
  process.env.PLAYWRIGHT_TOOLING || new URL('../package.json', import.meta.url)
)('playwright-core');
const browser = await (engine === 'webkit' ? webkit : chromium).launch(
  engine === 'chromium' && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);
const page = await browser.newPage({ viewport: { width: 1450, height: 940 }, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('dialog', (d) => (d.message().includes('rehearsal on this computer') ? d.accept() : d.dismiss()));
const ui = page.locator('#studioReleaseEditor'),
  button = (name) => ui.locator('[data-action="' + name + '"]');
const screen = (name) => page.screenshot({ path: join(out, engine + '-' + name + '.png') });
async function result(regexp, timeout = 60000) {
  await page.waitForFunction(
    (str) =>
      new RegExp(str, 'i').test(document.querySelector('#studioReleaseEditor [data-result]')?.textContent),
    regexp,
    { timeout }
  );
}
try {
  await page.goto(url);
  await page.locator('[data-skin="' + skinId + '"]').click();
  await page.locator('[aria-controls="edit-review"]').click();
  await button('prepare').click();
  await result('Version ready');
  assert.match(await ui.locator('[data-destination]').innerText(), /Local rehearsal/);
  const download = page.waitForEvent('download');
  await button('download').click();
  const item = await download,
    file = join(out, item.suggestedFilename());
  await item.saveAs(file);
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(envelope.body.skin.id, skinId);
  // Reopen the exact exported file, like the staging or public operator.
  await ui.locator('[data-file]').setInputFiles(file);
  await result('Version ready');
  await button('checks').click();
  await result('24 game screens passed', 120000);
  const checks = await ui.locator('[data-result]').innerText();
  await screen('release-checks');
  for (const lane of ['staging', 'public']) {
    // Another browser may already have staged this same immutable package.
    if (!(await button(lane).isDisabled())) {
      await button(lane).click();
      await result('Verified .* ' + lane + ' rehearsal');
    }
    assert.match(
      await ui.locator('[data-history]').innerText(),
      new RegExp(lane + ' .* ' + envelope.digest.slice(0, 10))
    );
  }
  await button('play').click();
  await result('practice table is ready');
  const address = await ui.locator('[data-link]').getAttribute('href'),
    phone = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  phone.on('pageerror', (err) => errors.push(err.message));
  await phone.goto(address);
  await phone.waitForFunction(
    () => document.querySelector('[data-preview-fixture]')?.dataset.previewFixture === 'turn'
  );
  await phone.screenshot({ path: join(out, engine + '-practice.png') });
  await button('stop').click();
  await result('Playtest ended');
  const t = new URL(address).searchParams.get('practice-release');
  assert.equal((await fetch(new URL('/api/studio-playtests/' + t, url))).status, 404);
  await phone.bringToFront();
  await phone.waitForFunction(() => document.documentElement.dataset.releasePractice === 'closed', null, {
    timeout: 25000,
  });
  assert.equal(await phone.locator('main').isHidden(), true);
  assert.deepEqual(errors, []);
  const report = {
    engine,
    digest: envelope.digest,
    skinId,
    images: envelope.body.assets.length,
    checks,
    localStaging: true,
    localPromotion: true,
    endedPractice: true,
    errors,
  };
  await writeFile(join(out, engine + '-release-checks.json'), JSON.stringify(report, null, 2));
  console.log(report);
} catch (error) {
  console.error(
    'Studio status:',
    await ui
      .locator('[data-result]')
      .textContent()
      .catch(() => '')
  );
  await screen('release-failure');
  throw error;
} finally {
  await browser.close();
}
