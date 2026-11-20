import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function checkLifePreview(fixture, base, output, style = 'dial') {
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const { page } = fixture;
  if (style === 'button') {
    await page.locator('#moreButton').click();
    await page.locator('#toggleInterfaceStyleButton').click();
    await page.locator('#closeGameMenuButton').click();
  }
  const code = (await page.locator('#podLabel').textContent()).replace('TABLE ', '').trim();
  const indicator = page.locator('#lifeChangeIndicator');
  const adjust = async (delta, count = 1) => {
    for (let i = 0; i < count; i++) {
      const button = page.locator(`[data-delta="${delta}"]:visible`);
      if (style === 'button') await button.click();
      else await button.tap();
    }
  };
  const confirmedLife = async expected => {
    for (let i = 0; i < 80; i++) {
      const response = await fetch(`${base}/api/rooms/${code}`);
      assert.equal(response.ok, true);
      if ((await response.json()).snapshot.seats[0].counters.life === expected) return;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.fail(`server did not confirm ${expected} life`);
  };
  await adjust(-1, 13);
  await confirmedLife(27); // The correction must cross an actual HTTP flush.
  assert.match(await indicator.textContent(), /−13 LIFE · 40 → 27/);
  await adjust(1, 3);
  assert.match(await indicator.textContent(), /−10 LIFE · 40 → 30/);
  await confirmedLife(30);
  await page.screenshot({ path: resolve(output, `preview-${style}-minus-ten.png`) });

  await adjust(1);
  await adjust(-1);
  assert.match(await indicator.textContent(), /−10 LIFE · 40 → 30/);
  await adjust(1, 10);
  assert.equal(await indicator.isVisible(), true);
  assert.match(await indicator.textContent(), /^0 LIFE · 40 → 40$/);
  await confirmedLife(40);
  await indicator.waitFor({ state: 'hidden' });
  await adjust(-1);
  assert.match(await indicator.textContent(), /−1 LIFE · 40 → 39/);
  await confirmedLife(39);

  await page.locator('#modeNav [data-mode="poison"]').click();
  await page.locator('#modeNav [data-mode="life"]').click();
  assert.match(await indicator.textContent(), /−1 LIFE · 40 → 39/);
  await page.locator('#podStrip button').nth(1).click();
  assert.equal(await indicator.isVisible(), false);
  await page.locator('#podStrip button').first().click();
  await adjust(1);
  assert.match(await indicator.textContent(), /\+1 LIFE · 39 → 40/);
  await adjust(1, 12);
  await confirmedLife(52);
  await adjust(-1, 3);
  assert.match(await indicator.textContent(), /\+10 LIFE · 39 → 49/);
  await confirmedLife(49);
  assert.deepEqual(fixture.errors, []);
  return { style, lossCorrection: -10, gainCorrection: 10, zeroKeptVisible: true,
    expiryReset: true, seatReset: true, modeRetained: true, finalServerLife: 49 };
}
