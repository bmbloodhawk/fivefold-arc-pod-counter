import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { settleDial } from './dial-layout.browser.mjs';

// Uses an existing disposable loopback table; never reads browser credentials.
export async function checkOfflineRecovery({ page, context }, base, output) {
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const code = (await page.locator('#podLabel').textContent()).replace('TABLE ', '').trim();
  const snapshot = async () => {
    const response = await fetch(`${base}/api/rooms/${code}`);
    assert.equal(response.ok, true);
    return (await response.json()).snapshot;
  };
  const life = async () => (await snapshot()).seats[0].counters.life;
  const plus = page.locator('[data-delta="1"]:visible');
  const report = { checks: [], states: [] };
  const readState = () => page.evaluate(() => ({
    label: document.querySelector('#connectionText').textContent,
    offline: !document.querySelector('#disconnectBanner').hidden,
    plusDisabled: document.querySelector('[data-delta="1"]').disabled,
    dialDisabled: document.querySelector('#dialGesture').getAttribute('aria-disabled'),
    endTurnDisabled: document.querySelector('#endTurnButton').disabled,
    changeVisible: !document.querySelector('#lifeChangeIndicator').hidden,
    syncVisible: !document.querySelector('#syncBanner').hidden,
    value: document.querySelector('#mainValue').value,
  }));
  const closeError = () => page.locator('#connectionDialog').getByRole('button', { name: 'Done', exact: true }).click();
  const recovered = async expected => {
    await context.setOffline(false);
    await page.locator('#disconnectBanner').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('[data-delta="1"]').disabled);
    assert.equal(await life(), expected, 'failed and offline input is not replayed');
    assert.equal((await readState()).label, 'Connected');
  };
  try {
    const initial = await life();
    // A dropped POST alone must not take a reachable table offline.
    await page.route('**/api/rooms/*/adjust', route => route.abort('internetdisconnected'));
    await plus.tap();
    await page.waitForFunction(expected => document.querySelector('#mainValue').value === String(expected), initial);
    assert.equal(await life(), initial);
    assert.equal((await readState()).offline, false);
    assert.equal(await plus.isEnabled(), true);
    await page.unroute('**/api/rooms/*/adjust');
    report.checks.push('Dropped life request with a successful confirmation stays connected and rolls back the unsaved change');

    await context.setOffline(true);
    await plus.tap();
    await page.locator('#connectionDialog').waitFor({ state: 'visible' });
    await closeError();
    await settleDial(page);
    report.states.push(await readState());
    await page.screenshot({ path: resolve(output, 'offline-paused.png') });
    assert.equal(report.states.at(-1).offline, true);
    assert.equal(report.states.at(-1).plusDisabled, true);
    assert.equal(report.states.at(-1).dialDisabled, 'true');
    assert.equal(report.states.at(-1).endTurnDisabled, true);
    assert.equal(report.states.at(-1).changeVisible, false, 'unsaved life feedback is removed');
    assert.equal(report.states.at(-1).syncVisible, false, 'offline must not retain a Synced notice');
    assert.equal(await life(), initial);
    for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
      await page.locator(`#modeNav [data-mode="${mode}"]`).click();
      assert.equal(await plus.isEnabled(), false, `${mode} remains paused`);
      assert.equal(await page.locator('#dialGesture').getAttribute('aria-disabled'), 'true');
    }
    await page.locator('#modeNav [data-mode="life"]').click();
    await page.locator('#dialGesture').press('ArrowUp');
    await page.locator('#commanderTaxQuickButton').click();
    assert.equal(await page.locator('[data-commander-cast]').first().isEnabled(), false);
    await page.locator('#commanderTaxDialog button[value="close"]').click();
    await recovered(initial);
    report.checks.push('Failed life request and confirmation pause every counter mode, dial input, turn handoff and commander casts');
    report.checks.push('Automatic reconnect clears the warning and restores controls without replaying offline input');
    await plus.tap();
    await page.waitForResponse(response => response.url().endsWith('/adjust') && response.ok());
    assert.equal(await life(), initial + 1);
    await settleDial(page);
    report.states.push(await readState());
    await page.screenshot({ path: resolve(output, 'online-recovered.png') });
    report.checks.push('One intentional life tap after recovery commits once');

    // Non-life counters use a different UI request path.
    await page.locator('#modeNav [data-mode="poison"]').click();
    await context.setOffline(true);
    await plus.tap();
    await page.locator('#connectionDialog').waitFor({ state: 'visible' });
    await closeError();
    assert.equal(await plus.isEnabled(), false);
    assert.equal((await readState()).syncVisible, false);
    await recovered(initial + 1);
    assert.equal((await snapshot()).seats[0].counters.poison, 0);
    await plus.tap();
    await page.waitForFunction(() => document.querySelector('#mainValue').value === '1');
    assert.equal((await snapshot()).seats[0].counters.poison, 1);
    report.checks.push('Non-life request failure pauses and recovers with no delayed poison change');

    // The server can save a change even when its response never reaches us.
    await page.locator('#modeNav [data-mode="life"]').click();
    await page.route('**/api/rooms/*/adjust', async route => {
      await route.fetch();
      await route.abort('failed');
    });
    const confirmation = page.waitForResponse(response => response.url() === `${base}/api/rooms/${code}` && response.ok());
    await plus.tap();
    await confirmation;
    await page.waitForFunction(expected => document.querySelector('#mainValue').value === String(expected), initial + 2);
    assert.equal(await life(), initial + 2, 'the retried operation saves exactly once');
    assert.equal((await readState()).offline, false);
    assert.equal(await plus.isEnabled(), true);
    await page.unroute('**/api/rooms/*/adjust');
    report.checks.push('Saved life change with both POST responses dropped is confirmed once and stays connected');

    await page.locator('#moreButton').click();
    await page.locator('#toggleInterfaceStyleButton').click();
    assert.equal(await page.locator('#gameView').getAttribute('data-interface-style'), 'button');
    await page.locator('#closeGameMenuButton').click();
    await context.setOffline(true);
    await plus.tap();
    await page.locator('#connectionDialog').waitFor({ state: 'visible' });
    await closeError();
    assert.equal(await plus.isEnabled(), false);
    assert.equal(await page.locator('#customLifeButton').isEnabled(), false);
    await settleDial(page);
    await page.screenshot({ path: resolve(output, 'button-offline-paused.png') });
    await recovered(initial + 2);
    assert.equal(await page.locator('#customLifeButton').isEnabled(), true);
    report.checks.push('Button mode pauses step and custom-life controls, then automatically restores them');
    report.pass = true;
    return report;
  } finally {
    await context.setOffline(false);
    await page.unroute('**/api/rooms/*/adjust');
    await writeFile(resolve(output, 'browser-results.json'), JSON.stringify(report, null, 2));
  }
}
