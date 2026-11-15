import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { settleDial } from './dial-layout.browser.mjs';

export async function checkActiveTableRecovery({ page, context }, base, output) {
  assert.equal(new URL(base).hostname, '127.0.0.1', 'disposable loopback tables only');
  const code = (await page.locator('#podLabel').textContent()).replace('TABLE ', '').trim();
  const snapshot = async () => (await (await fetch(`${base}/api/rooms/${code}`)).json()).snapshot;
  const plus = page.getByRole('button', { name: 'Increase counter by one', exact: true });
  const minus = page.getByRole('button', { name: 'Decrease counter by one', exact: true });
  const report = { checks: [], diameter: [] };
  let reclaimRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/reclaim')) reclaimRequests++; });
  const before = (await snapshot()).seats[0].counters.life;
  for (let index = 0; index < 3; index++) await minus.tap();
  await page.waitForResponse(response => response.url().endsWith('/adjust') && response.ok());
  assert.equal((await snapshot()).seats[0].counters.life, before - 3);
  await page.reload();
  await page.locator('#gameView').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-delta="1"]').disabled);
  await settleDial(page);
  assert.equal(await page.locator('#mainValue').textContent(), String(before - 3));
  assert.equal(await plus.isEnabled(), true);
  const measure = async () => report.diameter.push(await page.locator('.dial-assembly').evaluate(node => node.getBoundingClientRect().width));
  await measure();
  await page.waitForTimeout(2100); await measure();
  await page.waitForTimeout(4100); await measure();
  assert.ok(Math.max(...report.diameter) - Math.min(...report.diameter) < 1, 'auto-return does not produce a delayed Dial resize');
  await page.screenshot({ path: resolve(output, 'restored-seat.png') });
  report.checks.push('Reload restores the same owner and confirmed life; Dial diameter stays stable for 6.2 seconds');
  await plus.tap();
  await page.waitForResponse(response => response.url().endsWith('/adjust') && response.ok());
  const after = await snapshot();
  assert.equal(after.seats[0].counters.life, before - 2);
  assert.equal(after.seats[1].counters.life, 40);
  report.checks.push('The restored owner can change only its own counter');

  await page.locator('#moreButton').click();
  await page.locator('#leaveTableButton').click();
  await page.locator('#confirmLeaveTableButton').click();
  await page.locator('#landingView').waitFor({ state: 'visible' });
  const previousRequests = reclaimRequests;
  await page.reload();
  await page.locator('#landingView').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  assert.equal(reclaimRequests, previousRequests, 'deliberate leave prevents automatic return');
  report.checks.push('Leaving deliberately, then reloading, stays Home despite saved history');
  await page.locator(`#savedTablesList button[data-saved-code="${code}"]`).click();
  await page.locator('#gameView').waitFor({ state: 'visible' });
  await page.reload();
  await page.locator('#gameView').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#mainValue').textContent(), String(before - 2));
  report.checks.push('Returning to a saved table once establishes the active marker for future reloads');

  let entered, release;
  const seen = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/rooms/*/reclaim', async route => { entered(); await gate; await route.continue(); });
  try {
    await page.reload();
    await seen;
    await page.locator('#createPodButton').click();
    const response = page.waitForResponse(result => result.url().endsWith('/reclaim'));
    release();
    await response;
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#createView').isVisible(), true);
    report.checks.push('A delayed automatic reclaim cannot replace deliberate Create navigation');
  } finally { release(); await page.unroute('**/api/rooms/*/reclaim'); }
  report.pass = true;
  await writeFile(resolve(output, 'browser-results.json'), JSON.stringify(report, null, 2));
  return report;
}
