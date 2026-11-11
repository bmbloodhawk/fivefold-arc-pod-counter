// Repeatable phone UI checks. Import from the persistent Playwright REPL.
// All signoff actions use visible controls; reads inspect results and layout.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function browserFixture(chromium, { origin = 'http://127.0.0.1:8793', executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe' } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Phone QA must target loopback.');
  const browser = await chromium.launch({ headless: true, executablePath });
  const auth = await readFile(new URL('./competition-auth-fixture.mjs', import.meta.url), 'utf8');
  const evidence = root + '.local/evidence/'; await mkdir(evidence, { recursive: true });
  const errors = [], requests = [], cases = [];
  async function phone(width = 390, height = 844, { enabled } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.route('https://**/*', route => route.abort());
    await context.route('**/account-auth.js*', route => route.fulfill({ contentType: 'text/javascript', body: auth }));
    if (enabled !== undefined) await context.route('**/api/competitions/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled }) }));
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/')) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    return page;
  }
  async function shot(page, name) { await page.screenshot({ path: evidence + name + '.png', scale: 'css' }); }
  async function signIn(page, user = 'host') {
    await page.locator('#signInButton').click();
    if (user === 'host') await page.locator('#myGamesSignInButton').click();
    else {
      await page.locator('#emailSignInButton').click(); await page.locator('#accountEmail').fill(`${user}@fixture.invalid`);
      await page.locator('#accountPassword').fill('fixture-only'); await page.locator('#emailSignInButton').click();
    }
    await page.locator('#myGamesDialog').waitFor({ state: 'hidden' });
  }
  async function createTable(page, { name = 'Mira', count = 2, capacity = 8 } = {}) {
    await page.locator('#createStepOneNext').click();
    await page.locator('#playerCountChoices label').filter({ hasText: new RegExp(`^${count}$`) }).click();
    await page.locator('#seatCapacity').selectOption(String(capacity)); await page.locator('#createStepTwoNext').click();
    await page.locator('#createName').fill(name); await page.locator('#createStepThreeNext').click(); await page.locator('#createStepFourSkip').click();
    await page.locator('#createForm button[type=submit]').click(); await page.locator('#lobbyInviteCode').waitFor();
    return (await page.locator('#lobbyInviteCode').innerText()).trim();
  }
  async function joinTable(page, code, { name = 'Nico', seat = 'P2', fromEvent = false } = {}) {
    if (!fromEvent) {
      if (await page.locator('#competitionDialog').isVisible()) await page.locator('#competitionClose').click();
      await page.locator('#joinPodButton').click(); await page.locator('#podCode').fill(code); await page.locator('#joinCodeForm button[type=submit]').click();
    }
    await page.locator('#joinSeat').selectOption(seat); await page.locator('#joinStepTwoNext').click();
    await page.locator('#joinName').fill(name); await page.locator('#joinStepThreeNext').click();
    await page.locator('#joinForm button[type=submit]').click(); await page.locator('#lobbyView').waitFor({ state: 'visible' });
  }
  async function dismissFinish(page) {
    if (await page.locator('#victoryDialog').isVisible()) {
      await page.locator('#victoryTapHint').filter({ hasText: 'Tap anywhere' }).waitFor();
      await page.locator('#victoryTitle').click(); await page.locator('#victoryDialog[data-stage=accolade]').waitFor();
      await page.locator('#personalMatchMomentTitle').click();
    }
    await page.waitForFunction(() => document.querySelector('#achievementDialog').open || !document.querySelector('#intermissionView').hidden);
    if (await page.locator('#achievementDialog').isVisible()) await page.locator('#achievementDialog').getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('#intermissionView').waitFor({ state: 'visible' });
  }
  async function declareWinner(page, seat = '0') {
    if (await page.locator('#competitionDialog').isVisible()) await page.locator('#competitionClose').click();
    await page.locator('#moreButton').click(); await page.locator('#declareWinnerButton').click();
    await page.locator('#winnerSeat').selectOption(seat);
    await page.locator('#winnerReason').fill('Local fixture table decision');
    await page.locator('#declareWinnerForm').getByRole('button', { name: 'Celebrate winner', exact: true }).click();
    await page.locator('#victoryDialog').waitFor({ state: 'visible' });
  }
  async function leaveTable(page) {
    if (await page.locator('#competitionDialog').isVisible()) await page.locator('#competitionClose').click();
    await page.waitForFunction(() => document.querySelector('#victoryDialog').open || document.querySelector('#achievementDialog').open || !document.querySelector('#intermissionView').hidden);
    await dismissFinish(page); await page.locator('#intermissionLeaveButton').click();
    await page.locator('#intermissionLeaveForm button[value=confirm]').click(); await page.locator('#landingView').waitFor({ state: 'visible' });
  }
  async function fit(page) {
    return page.evaluate(() => {
      const dialog = document.querySelector('#competitionDialog'), content = document.querySelector('#competitionContent');
      const header = document.querySelector('.competition-header').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, horizontalOverflow: content.scrollWidth > content.clientWidth,
        dialogWidth: dialog.getBoundingClientRect().width, headerBottom: header.bottom,
        smallControls: [...dialog.querySelectorAll('button,select,input:not([type=checkbox])')].filter(node => {
          const rect = node.getBoundingClientRect(); return rect.width && rect.height && rect.height < 44;
        }).map(node => ({ id: node.id, height: node.getBoundingClientRect().height })) };
    });
  }
  return { browser, origin, errors, requests, cases, phone, shot, signIn, createTable, joinTable, dismissFinish, declareWinner, leaveTable, fit,
    competitionCount: () => requests.filter(request => request.path.startsWith('/api/competitions')).length,
    check(name, condition) { assert.ok(condition, name); cases.push(name); } };
}

export async function podPhoneFlow(qa) {
  const host = await qa.phone(), member = await qa.phone();
  await qa.signIn(host);
  await host.locator('#myPodsButton').click(); await host.locator('#hubCreate').click();
  await host.locator('#hubCreateForm [name=name]').fill('Friday Night QA'); await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await host.locator('#hubCreateForm button[type=submit]').click(); await host.locator('#podManage').click(); await host.locator('#podInvite').click();
  const inviteLink = await host.locator('#inviteLink').inputValue();
  await member.goto(inviteLink, { waitUntil: 'domcontentloaded' }); await member.locator('#hubJoinForm [name=displayName]').fill('Nico');
  await member.locator('#hubJoinForm button[type=submit]').click();
  await member.locator('#emailSignInButton').click(); await member.locator('#accountEmail').fill('member@fixture.invalid'); await member.locator('#accountPassword').fill('fixture-only'); await member.locator('#emailSignInButton').click();
  await member.locator('#hubJoinForm button[type=submit]').filter({ hasText: 'Accept and join' }).waitFor();
  qa.check('invite sign-in preserves entered name', await member.locator('#hubJoinForm [name=displayName]').inputValue() === 'Nico');
  await member.locator('#hubJoinForm button[type=submit]').click(); await member.locator('#podPlay').waitFor();
  await host.locator('#competitionBack').click(); await host.locator('#podPlay').click();
  const code = await qa.createTable(host); await host.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  await qa.joinTable(member, code); await member.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  await host.locator('#startGameButton').click(); await member.locator('#gameView').waitFor({ state: 'visible' });
  await host.locator('#moreButton').click(); await host.locator('#competitionContextButton').click(); await host.locator('#openTableScope').click(); await host.locator('#podPlay').waitFor();
  const before = qa.competitionCount();
  for (let i = 0; i < 10; i++) await member.getByRole('button', { name: 'Decrease counter by one', exact: true }).tap();
  for (let i = 0; i < 3; i++) await member.getByRole('button', { name: 'Increase counter by one', exact: true }).tap();
  await member.locator('#mainValue').filter({ hasText: /^33$/ }).waitFor(); await host.locator('#podStrip').filter({ hasText: '33' }).waitFor();
  qa.check('no competition client request during 13 life taps', qa.competitionCount() === before);
  qa.check('Pod stays open while other phone updates life', await host.locator('#competitionDialog').isVisible());
  await qa.shot(host, 'pod-open-during-live-updates-390');
  await qa.declareWinner(host); await qa.dismissFinish(host); await host.locator('#competitionIntermissionButton').click(); await host.locator('#reviewTableFinish').click();
  await host.getByRole('combobox', { name: 'Finishing position for Nico', exact: true }).selectOption('2');
  await qa.shot(host, 'finishing-order-review-390'); await host.locator('#confirmOrderForm button[type=submit]').click();
  await host.locator('#competitionStatus').filter({ hasText: 'Finishing order saved' }).waitFor();
  await host.locator('#competitionBack').click(); await host.locator('#openTableScope').click();
  await host.locator('.competition-ranks').filter({ hasText: '1012' }).waitFor();
  qa.check('host order updates both Pod ratings', (await host.locator('.competition-ranks').innerText()).includes('988'));
  await qa.shot(host, 'pod-confirmed-ratings-390');
  await qa.dismissFinish(member); await member.locator('#competitionIntermissionButton').click(); await member.locator('#openTableScope').click();
  qa.check('member receives their own standing automatically', (await member.locator('.competition-ranks').innerText()).includes('Nico · You'));
  await member.setViewportSize({ width: 320, height: 700 }); await qa.shot(member, 'pod-standings-320');
  const fit = await qa.fit(member); qa.check('Pod fits 320px with 44px controls', !fit.horizontalOverflow && !fit.smallControls.length && fit.dialogWidth <= 320);
  await member.setViewportSize({ width: 390, height: 844 });
  return { host, member, code, inviteLink };
}

export async function podRecoveryAndFatalFlow(qa, flow) {
  const { host, member } = flow;
  await host.locator('#competitionClose').click(); await member.locator('#competitionClose').click();
  await host.locator('#intermissionReadyButton').click(); await member.locator('#intermissionReadyButton').click();
  await host.locator('#intermissionStartButton').click(); await host.locator('#confirmNextGameStart').click();
  await host.locator('#gameView').waitFor({ state: 'visible' });
  await host.reload({ waitUntil: 'domcontentloaded' }); await host.locator('#savedTablesList .saved-table-button').first().click();
  await host.locator('#gameView').waitFor({ state: 'visible' }); await host.locator('#moreButton').click();
  await host.locator('#competitionContextButton').filter({ hasText: 'Return to Pod' }).waitFor();
  qa.check('reloaded playing Table retains Pod context access', await host.locator('#competitionContextButton').isVisible());
  await host.locator('#competitionContextButton').click(); await host.locator('#openTableScope').click(); await host.locator('#podPlay').waitFor();
  const before = qa.competitionCount();
  for (let i = 0; i < 40; i++) await member.getByRole('button', { name: 'Decrease counter by one', exact: true }).tap();
  await member.locator('#victoryDialog').waitFor({ state: 'visible' });
  qa.check('lethal counter completion makes no competition client request', qa.competitionCount() === before);
  qa.check('completion does not interrupt an open Pod screen', await host.locator('#competitionDialog').isVisible() && !await host.locator('#victoryDialog').isVisible());
  await host.locator('#competitionClose').click(); await host.locator('#victoryDialog').waitFor({ state: 'visible' }); await qa.dismissFinish(host);
  await host.locator('#competitionIntermissionButton').click(); await host.locator('#reviewTableFinish').click();
  await host.locator('#confirmOrderForm button[type=submit]').click(); await host.locator('#competitionStatus').filter({ hasText: 'Finishing order saved' }).waitFor();
  await host.locator('#competitionBack').click(); await host.locator('#openTableScope').click();
  qa.check('normal intermission records the second game exactly once', (await host.locator('.competition-ranks').innerText()).includes('2/10 rated games'));
  await qa.dismissFinish(member);
  // Finish both Table sessions before creating a separate event.
  await qa.leaveTable(host); await qa.leaveTable(member);
  return flow;
}

export async function navigationFaultChecks(qa, flow) {
  const { host, inviteLink } = flow;
  await host.route('**/api/competitions/mine', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fixture storage temporarily unavailable.' } }) }));
  await host.locator('#myPodsButton').click(); await host.locator('#competitionStatus').filter({ hasText: 'Fixture storage temporarily unavailable' }).waitFor();
  qa.check('initial storage failure stays visible with a retry', await host.locator('#competitionDialog').isVisible() && await host.locator('#hubRetry').isVisible());
  await host.unroute('**/api/competitions/mine'); await host.locator('#hubRetry').click(); await host.locator('#hubJoin').click();
  await host.locator('#hubInviteForm textarea').fill(inviteLink);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { entered = resolve; });
  await host.route('**/api/competitions/invite-preview', async route => { entered(); await gate; await route.continue(); });
  await host.locator('#hubInviteForm button[type=submit]').click(); await pending;
  await host.locator('#competitionClose').click(); const response = host.waitForResponse('**/api/competitions/invite-preview'); release();
  await (await response).finished(); await host.waitForTimeout(100);
  qa.check('delayed invite response cannot reopen a closed screen', !await host.locator('#competitionDialog').isVisible());
  await host.unroute('**/api/competitions/invite-preview');
  const invalid = await qa.phone();
  await invalid.goto(qa.origin + '/index.html#invite=pod.pod_missing.invalid_secret', { waitUntil: 'domcontentloaded' });
  await invalid.locator('#competitionTitle').filter({ hasText: 'Invite unavailable' }).waitFor();
  qa.check('invalid deep invite shows an error after removing its URL fragment', await invalid.locator('#retryInvite').isVisible());
  await qa.shot(invalid, 'invalid-invite-390'); await invalid.context().close();
}

export async function tournamentRegistrationFlow(qa, podFlow) {
  const { host, member } = podFlow;
  await host.locator('#tournamentsButton').click(); await host.locator('#hubCreate').click();
  await host.locator('#hubCreateForm [name=name]').fill('Saturday Open QA');
  await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await host.locator('#hubCreateForm [name=rounds]').fill('1'); await host.locator('#hubCreateForm [name=minutes]').fill('1');
  qa.check('new opponents first is the default', await host.locator('#hubCreateForm [name=priority]').inputValue() === 'new_opponents');
  await host.locator('#hubCreateForm button[type=submit]').click(); await host.locator('#eventEnter').click(); await host.locator('#eventLeave').waitFor();
  await host.locator('#eventManage').click(); await host.locator('#eventInvite').click();
  const inviteLink = await host.locator('#inviteLink').inputValue();
  await member.goto(inviteLink, { waitUntil: 'domcontentloaded' }); await member.locator('#hubJoinForm [name=displayName]').fill('Nico');
  await member.locator('#hubJoinForm button[type=submit]').click(); await member.locator('#eventLeave').waitFor();
  const guest = await qa.phone(), attested = await qa.phone();
  await guest.goto(inviteLink, { waitUntil: 'domcontentloaded' }); await guest.locator('#hubJoinForm [name=displayName]').fill('Sam');
  await guest.locator('#hubJoinForm button[type=submit]').click(); await guest.locator('#eventLeave').waitFor();
  qa.check('guest enters event without an account', !await guest.locator('#eventManage').isVisible());
  await host.locator('#competitionBack').click(); await host.locator('#eventManage').click(); await host.locator('#eventAddGuest').click();
  await host.locator('#addEventGuest [name=displayName]').fill('Rowan'); await host.locator('#addEventGuest button[type=submit]').click();
  await host.locator('#eventManage').click();
  const nico = host.locator('.competition-member').filter({ has: host.locator('strong', { hasText: /^Nico$/ }) });
  await nico.locator('[data-cohost]').click(); await host.locator('#eventManage').click();
  qa.check('host can appoint optional signed-in co-host', (await host.locator('.competition-member').filter({ hasText: 'Nico' }).innerText()).includes('Co-host'));
  await host.locator('#competitionBack').click(); await host.locator('#prepareRound').click(); await host.locator('#editSeating').click();
  for (const box of await host.locator('#seatingForm input[type=checkbox]').all()) await box.uncheck();
  await host.locator('#seatingForm fieldset').filter({ has: host.locator('legend', { hasText: /^Mira$/ }) }).locator('input[type=checkbox]').check();
  await host.locator('#seatingForm button[type=submit]').click(); await host.locator('[data-create-table]').click();
  const code = await qa.createTable(host, { count: 4 });
  await host.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  for (const [page, name, seat] of [[member, 'Nico', 'P2'], [guest, 'Sam', 'P3']]) {
    await page.locator('#eventRefresh').click(); await page.locator('[data-join-table]').click();
    await qa.joinTable(page, code, { name, seat, fromEvent: true }); await page.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  }
  await qa.joinTable(attested, code, { name: 'Rowan', seat: 'P4' });
  await host.locator('#competitionLobbyButton').click(); await host.locator('#attestEventGuest').locator('xpath=..').locator('summary').click();
  await host.locator('#attestEventGuest [name=participantId]').selectOption({ label: 'Rowan' });
  await host.locator('#attestEventGuest [name=seatId]').selectOption({ label: 'P4 · Rowan' });
  await host.locator('#attestEventGuest button[type=submit]').click(); await host.locator('#openTableScope').click();
  await host.locator('#startRound').click(); await host.locator('#hubConfirm').click();
  await host.locator('[data-clock]').waitFor(); await qa.shot(host, 'tournament-round-started-390');
  qa.check('Table lobby returns to event for manual round start', (await host.locator('#competitionContent').innerText()).includes('Round 1 of 1 · playing'));
  await host.locator('[data-join-table]').click(); await host.locator('#startGameButton').click();
  await Promise.all([host, member, guest, attested].map(page => page.locator('#gameView').waitFor({ state: 'visible' })));
  qa.check('four phones start with signed-in, self-named and attested guests', true);
  return { host, member, guest, attested, code, inviteLink };
}

export async function openTournamentClocks(qa, flow) {
  const { host, guest } = flow;
  for (const page of [guest, host]) {
    await page.locator('#moreButton').click(); await page.locator('#competitionContextButton').click();
    await page.locator('#openTableScope').click(); await page.locator('[data-clock]').click(); await page.locator('#eventRoundCountdown').waitFor();
  }
  qa.check('guest sees clock without host turn controls', !await guest.locator('#callRoundTime').isVisible() && !await guest.locator('#recordFinalTurn').isVisible());
  if (!(await host.locator('#eventRoundCountdown').innerText()).includes('ended')) {
    await host.locator('#callRoundTime').click(); await host.locator('#competitionStatus').filter({ hasText: 'Round time has not ended' }).waitFor();
    qa.check('time cannot be called before configured duration', true);
  }
}

export async function finishTimedTournament(qa, flow) {
  const { host, member, guest } = flow;
  await host.locator('#eventRoundCountdown').filter({ hasText: 'Round time has ended' }).waitFor({ timeout: 65000 });
  await host.locator('#callRoundTime').click(); await host.locator('#recordFinalTurn').filter({ hasText: 'Current turn finished' }).waitFor();
  await host.locator('#recordFinalTurn').click();
  for (let turn = 1; turn <= 5; turn++) {
    await host.locator('#recordFinalTurn').filter({ hasText: `Additional turn ${turn} finished` }).waitFor(); await host.locator('#recordFinalTurn').click();
  }
  await host.locator('#recordTimedDraw').waitFor(); await qa.shot(host, 'tournament-five-turns-390');
  qa.check('timer records current turn then five total additional turns', true); await host.locator('#recordTimedDraw').click();
  await host.locator('#confirmOrderForm').waitFor(); await qa.shot(host, 'tournament-tied-order-390');
  qa.check('finish editor labels self-entered and organizer-attested guests', (await host.locator('#confirmOrderForm').innerText()).includes('Guest · self-entered name') && (await host.locator('#confirmOrderForm').innerText()).includes('Organizer-attested guest'));
  await host.locator('#confirmOrderForm button[type=submit]').click(); await host.locator('#competitionStatus').filter({ hasText: 'Finishing order saved' }).waitFor();
  await host.locator('#competitionBack').click(); await host.locator('#eventStandings').click(); await host.locator('.competition-ranks li').first().waitFor();
  qa.check('all four tied players receive 1.5 event points', await host.locator('.competition-ranks li').filter({ hasText: '1.5' }).count() === 4);
  qa.check('joint winners share final placing one', (await host.locator('.competition-rank').allTextContents()).every(value => value.trim() === '1'));
  await host.setViewportSize({ width: 320, height: 700 }); await qa.shot(host, 'tournament-standings-320');
  const fit = await qa.fit(host); qa.check('tournament standings fit 320px controls', !fit.horizontalOverflow && !fit.smallControls.length);
  await host.setViewportSize({ width: 390, height: 844 }); await member.locator('#victoryDialog').waitFor({ state: 'visible' });
  qa.check('timed draw presents no invented winner', await member.locator('#victoryTitle').innerText() === 'Timed draw'); await qa.shot(member, 'tournament-draw-390');
  await guest.locator('#competitionBack').click(); await guest.locator('#eventRefresh').click(); await guest.locator('#eventStandings').click();
  await guest.locator('.competition-ranks li').filter({ hasText: 'Sam · You' }).waitFor(); qa.check('guest can view their own equal event points', true);
  await qa.leaveTable(host); await qa.leaveTable(member);
  await host.locator('#myPodsButton').click(); await host.locator('[data-open]').filter({ hasText: 'Friday Night QA' }).click();
  await host.locator('.competition-ranks').filter({ hasText: '2/10 rated games' }).waitFor();
  qa.check('standalone tournament leaves Pod game count unchanged', true);
  await qa.leaveTable(guest); await qa.leaveTable(flow.attested);
}

export async function podCorrectionFlow(qa, { host }) {
  await host.locator('#podHistory').click(); await host.locator('[data-day]').click(); await host.locator('[data-game]').first().click();
  await host.locator('#confirmOrderForm').waitFor();
  await host.getByRole('combobox', { name: 'Finishing position for Mira', exact: true }).selectOption('1');
  await host.getByRole('combobox', { name: 'Finishing position for Nico', exact: true }).selectOption('1');
  await host.locator('#confirmOrderForm [name=reasonCode]').selectOption('tie_correction');
  const pattern = '**/api/competitions/pod/*/games/*/confirm';
  await host.route(pattern, async route => { await route.fetch(); await route.abort('failed'); });
  await host.locator('#confirmOrderForm button[type=submit]').click();
  await host.locator('#competitionStatus').filter({ hasText: /Failed to fetch|NetworkError|Load failed/ }).waitFor();
  qa.check('lost confirmation response retains the editable order', await host.getByRole('combobox', { name: 'Finishing position for Nico', exact: true }).inputValue() === '1');
  await host.unroute(pattern); await host.locator('#confirmOrderForm button[type=submit]').click();
  await host.locator('#competitionStatus').filter({ hasText: 'Finishing order saved' }).waitFor();
  await host.getByText('Original app order and revisions', { exact: true }).click();
  await host.locator('#competitionContent h4').filter({ hasText: 'Revision 2' }).waitFor();
  qa.check('retried correction creates exactly one immutable revision', await host.locator('#competitionContent h4').count() === 2);
  qa.check('correction preserves original result and explicit reason', (await host.locator('#competitionContent').innerText()).includes('tie correction'));
  await qa.shot(host, 'pod-correction-history-390');
  await host.locator('#competitionClose').click(); await host.locator('#myPodsButton').click();
  await host.locator('[data-open]').filter({ hasText: 'Friday Night QA' }).click(); await host.locator('#podPlay').waitFor();
}

export async function podMembershipFlow(qa, flow) {
  const { host, member, inviteLink } = flow;
  await host.locator('#podManage').click();
  const nico = () => host.locator('.competition-member').filter({ has: host.locator('strong', { hasText: /^Nico$/ }) });
  await nico().locator('[data-admin]').click(); await host.locator('#podManage').click();
  qa.check('Pod optional admin role is visible', (await nico().innerText()).includes('Admin'));
  await nico().locator('[data-admin]').click(); await host.locator('#podManage').click();
  await nico().locator('[data-remove]').click(); await host.locator('#hubConfirm').click(); await host.locator('#podPlay').waitFor();
  await member.goto(inviteLink, { waitUntil: 'domcontentloaded' }); await member.locator('#hubJoinForm').waitFor();
  await member.locator('#hubJoinForm [name=displayName]').fill('Nico');
  await member.locator('#hubJoinForm button[type=submit]').click(); await member.locator('#competitionStatus').filter({ hasText: 'admin must send' }).waitFor();
  qa.check('removed member cannot return with the old invite', true);
  await host.locator('#podManage').click(); await host.locator('#podInvite').click(); const fresh = await host.locator('#inviteLink').inputValue();
  await member.goto(fresh, { waitUntil: 'domcontentloaded' }); await member.locator('#hubJoinForm [name=displayName]').fill('Nico');
  await member.locator('#hubJoinForm button[type=submit]').click(); await member.locator('.competition-ranks').filter({ hasText: '2/10 rated games' }).waitFor();
  qa.check('fresh admin invitation restores the same member history', true);
  await host.locator('#competitionBack').click(); await host.locator('#podManage').click(); await host.locator('#podLeave').click();
  await host.locator('#hubConfirm').click(); await host.locator('#hubCreate').waitFor();
  await member.locator('#competitionClose').click(); await member.locator('#myPodsButton').click();
  await member.locator('[data-open]').filter({ hasText: 'Friday Night QA' }).click(); await member.locator('#podManage').click();
  await member.locator('#podTakeover').click(); await member.locator('#podManage').click();
  qa.check('remaining member can take over a genuine admin vacancy', await member.locator('[data-admin]').isVisible());
  await member.getByText('Recent membership changes', { exact: true }).click();
  qa.check('admin takeover is visible in the membership audit', (await member.locator('#competitionContent').innerText()).includes('admin takeover'));
  await member.locator('#podInvite').click(); const returning = await member.locator('#inviteLink').inputValue();
  await host.locator('#competitionClose').click(); await host.goto(returning, { waitUntil: 'domcontentloaded' });
  await host.locator('#hubJoinForm [name=displayName]').fill('Mira'); await host.locator('#hubJoinForm button[type=submit]').click();
  await host.locator('.competition-ranks').filter({ hasText: '2/10 rated games' }).waitFor();
  qa.check('voluntarily returning member resumes previous rating and count', true);
  await member.locator('#inviteRevoke').click(); await member.locator('#competitionStatus').filter({ hasText: 'Invite revoked' }).waitFor();
  const outsider = await qa.phone(); await outsider.goto(returning, { waitUntil: 'domcontentloaded' });
  await outsider.locator('#competitionTitle').filter({ hasText: 'Invite unavailable' }).waitFor();
  qa.check('revoked invitation cannot be previewed', true); await outsider.context().close();
}

export async function guestNavigationFlow(qa, host) {
  if (await host.locator('#competitionDialog').isVisible()) await host.locator('#competitionClose').click();
  await host.locator('#tournamentsButton').click(); await host.locator('#hubCreate').click();
  await host.locator('#hubCreateForm [name=name]').fill('Navigation QA'); await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await host.locator('#hubCreateForm [name=rounds]').fill('2'); await host.locator('#hubCreateForm button[type=submit]').click();
  await host.locator('#eventManage').click(); await host.locator('#eventInvite').click(); const invite = await host.locator('#inviteLink').inputValue();
  const guest = await qa.phone(); await guest.goto(invite, { waitUntil: 'domcontentloaded' });
  await guest.locator('#hubJoinForm [name=displayName]').fill('Quinn');
  let entered, release; const pending = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  await guest.route('**/api/competitions/join', async route => { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); });
  await guest.locator('#hubJoinForm button[type=submit]').click(); await pending; await guest.locator('#competitionClose').click();
  const response = guest.waitForResponse('**/api/competitions/join'); release(); await (await response).finished();
  await guest.unroute('**/api/competitions/join'); await guest.locator('#tournamentsButton').click();
  await guest.locator('[data-open]').filter({ hasText: 'Navigation QA' }).click(); await guest.locator('#eventStandings').click();
  await guest.locator('.competition-ranks li').filter({ hasText: 'Quinn · You' }).waitFor();
  qa.check('closing an in-flight guest join preserves private event access', true);
  await guest.goto(invite, { waitUntil: 'domcontentloaded' }); await guest.locator('#hubJoinForm [name=displayName]').fill('Quinn');
  await guest.locator('#hubJoinForm button[type=submit]').click(); await guest.locator('#eventStandings').click();
  await guest.locator('.competition-ranks li').filter({ hasText: 'Quinn · You' }).waitFor();
  qa.check('reopening the same guest invite resumes one entrant', await guest.locator('.competition-ranks li').count() === 1);
  await guest.locator('#competitionClose').click(); await qa.signIn(guest, 'quinn');
  await guest.goto(invite, { waitUntil: 'domcontentloaded' }); await guest.locator('#hubJoinForm [name=displayName]').fill('Quinn account');
  await guest.locator('#hubJoinForm [name=entry]').selectOption('account'); await guest.locator('#hubJoinForm button[type=submit]').click();
  await guest.locator('#eventStandings').click(); await guest.locator('.competition-ranks li').filter({ hasText: 'Quinn account · You' }).waitFor();
  const own = guest.locator('.competition-ranks li').filter({ hasText: 'Quinn account · You' });
  qa.check('explicit account entry replaces this phone’s old guest capability', !(await own.innerText()).includes('Guest'));
  await guest.locator('#competitionBack').click(); await guest.locator('#eventLeave').click(); await guest.locator('#hubConfirm').click();
  await guest.locator('#competitionClose').click(); await guest.locator('#tournamentsButton').click();
  await guest.locator('[data-open]').filter({ hasText: 'Navigation QA' }).click(); await guest.locator('#eventStandings').waitFor();
  qa.check('signed-in early leaver can resume their event', true);
  await guest.context().close();
  const overlap = await qa.phone(); await overlap.goto(invite, { waitUntil: 'domcontentloaded' });
  await overlap.locator('#hubJoinForm [name=displayName]').fill('Taylor guest');
  let guestEntered, releaseGuest; const joined = new Promise(resolve => { guestEntered = resolve; }), held = new Promise(resolve => { releaseGuest = resolve; });
  await overlap.route('**/api/competitions/join', async route => {
    if (route.request().headers().authorization) return route.continue();
    const response = await route.fetch(); guestEntered(); await held; await route.fulfill({ response });
  });
  await overlap.locator('#hubJoinForm button[type=submit]').click(); await joined; await overlap.locator('#competitionClose').click();
  await qa.signIn(overlap, 'taylor'); await overlap.goto(invite, { waitUntil: 'domcontentloaded' });
  await overlap.locator('#hubJoinForm [name=displayName]').fill('Taylor account'); await overlap.locator('#hubJoinForm [name=entry]').selectOption('account');
  await overlap.locator('#hubJoinForm button[type=submit]').click(); await overlap.locator('#eventStandings').waitFor();
  const late = overlap.waitForResponse(response => response.url().endsWith('/api/competitions/join') && !response.request().headers().authorization);
  releaseGuest(); await (await late).finished(); await overlap.unroute('**/api/competitions/join');
  await overlap.locator('#eventRefresh').click(); await overlap.locator('#eventStandings').click();
  await overlap.locator('.competition-ranks li').filter({ hasText: 'Taylor account · You' }).waitFor();
  qa.check('older guest response cannot overwrite a newer account entry', true); await overlap.context().close();
}

export async function crossPodTableFlow(qa, { host, member }) {
  if (await host.locator('#competitionDialog').isVisible()) await host.locator('#competitionClose').click();
  await host.locator('#myPodsButton').click(); await host.locator('[data-open]').filter({ hasText: 'Friday Night QA' }).click();
  await host.locator('#podPlay').click(); const code = await qa.createTable(host); await host.locator('#competitionLobbyButton').click();
  await host.locator('#competitionBack').click(); await host.locator('#hubCreate').click();
  await host.locator('#hubCreateForm [name=name]').fill('Independent QA'); await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await host.locator('#hubCreateForm button[type=submit]').click(); await host.locator('.competition-ranks').filter({ hasText: '1000' }).waitFor();
  qa.check('second Pod starts with independent ratings', true); await host.locator('#podPlay').click();
  await host.locator('#competitionTitle').filter({ hasText: 'Your Table is already linked' }).waitFor();
  qa.check('another Pod cannot replace an existing Table link', true); await host.locator('#returnCurrentTable').click();
  await qa.joinTable(member, code); await member.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  await host.locator('#startGameButton').click(); await host.locator('#gameView').waitFor({ state: 'visible' });
  qa.check('rejected cross-Pod reuse leaves the original Table playable', true);
  await qa.declareWinner(host); await qa.dismissFinish(host); await qa.leaveTable(host); await qa.leaveTable(member);
}

export async function optionalAndRenameFlow(qa) {
  const host = await qa.phone(390, 844, { enabled: false }), member = await qa.phone(390, 844, { enabled: false });
  qa.check('disabled competition UI preserves casual home', !await host.locator('#myPodsButton').isVisible() && await host.locator('#createPodButton').isVisible());
  await host.locator('#createPodButton').click(); const code = await qa.createTable(host);
  await qa.joinTable(member, code); await host.locator('#startGameButton').click(); await member.locator('#gameView').waitFor({ state: 'visible' });
  await member.getByRole('button', { name: 'Decrease counter by one', exact: true }).tap(); await member.locator('#mainValue').filter({ hasText: /^39$/ }).waitFor();
  await host.locator('#podStrip').filter({ hasText: '39' }).waitFor(); qa.check('account-free casual Table still plays across two phones', true);
  await qa.declareWinner(host); await qa.dismissFinish(host); await qa.leaveTable(host); await qa.leaveTable(member);
  await host.context().close(); await member.context().close();
  const organizer = await qa.phone(); await qa.signIn(organizer);
  await organizer.locator('#myPodsButton').click(); await organizer.locator('#hubCreate').click();
  await organizer.locator('#hubCreateForm [name=name]').fill('Rename QA'); await organizer.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await organizer.locator('#hubCreateForm button[type=submit]').click(); await organizer.locator('#podManage').click(); await organizer.locator('#podRename').click();
  await organizer.locator('#renamePodForm [name=name]').fill('Friday friends'); await organizer.locator('#renamePodForm button[type=submit]').click();
  await organizer.locator('#competitionTitle').filter({ hasText: 'Friday friends' }).waitFor();
  qa.check('Pod admin can save its name from the menu', true); await qa.shot(organizer, 'pod-renamed-390');
  return organizer;
}

export async function issuedInvitesFlow(qa) {
  const host = await qa.phone(); await qa.signIn(host);
  for (const kind of ['pod', 'tournament']) {
    await host.locator(kind === 'pod' ? '#myPodsButton' : '#tournamentsButton').click(); await host.locator('#hubCreate').click();
    const name = kind === 'pod' ? 'Invite control Pod' : 'Invite control event';
    await host.locator('#hubCreateForm [name=name]').fill(name); await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
    await host.locator('#hubCreateForm button[type=submit]').click();
    await host.locator(kind === 'pod' ? '#podManage' : '#eventManage').click(); await host.locator(kind === 'pod' ? '#podInvite' : '#eventInvite').click();
    const link = await host.locator('#inviteLink').inputValue(); await host.reload({ waitUntil: 'domcontentloaded' });
    await host.locator(kind === 'pod' ? '#myPodsButton' : '#tournamentsButton').click();
    await host.locator('[data-open]').filter({ hasText: name }).click(); await host.locator(kind === 'pod' ? '#podManage' : '#eventManage').click();
    await host.locator(kind === 'pod' ? '#podInvites' : '#eventInvites').click(); await host.locator('[data-revoke-invite]').click();
    await host.locator('#competitionStatus').filter({ hasText: 'Invite revoked' }).waitFor();
    const outsider = await qa.phone(); await outsider.goto(link, { waitUntil: 'domcontentloaded' });
    await outsider.locator('#competitionTitle').filter({ hasText: 'Invite unavailable' }).waitFor();
    qa.check(`${kind} invite can be revoked after closing and reloading`, true); await outsider.context().close();
    await qa.shot(host, `${kind}-issued-invites-390`); await host.locator('#competitionClose').click();
  }
  return host;
}
