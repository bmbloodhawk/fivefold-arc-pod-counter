// Phone regressions for the approved Pod experience. Pass browserFixture().
// Use real loopback app/domain/storage handlers; only sharing APIs are simulated.
export async function openPodHome(page, podName) {
  // Stay within the Pod's real Back routes while its Table remains connected.
  for (let step = 0; step < 5 && await page.locator('#competitionDialog').isVisible(); step++) {
    if (await page.locator('#podPlay').isVisible() && await page.locator('#competitionTitle').innerText() === podName) return;
    const pod = page.locator('[data-open]').filter({ hasText: podName });
    if (await pod.isVisible()) { await pod.click(); break; }
    if (await page.locator('#openTableScope').isVisible()) await page.locator('#openTableScope').click();
    else if (await page.locator('#competitionBack').isVisible()) await page.locator('#competitionBack').click();
    else { await page.locator('#competitionClose').click(); break; }
    await page.locator('#competitionContent:not([aria-busy])').waitFor();
  }
  if (!await page.locator('#competitionDialog').isVisible()) {
    const fromTable = await page.locator('#gameView').isVisible()
      || await page.locator('#competitionIntermissionButton').isVisible()
      || await page.locator('#competitionLobbyButton').isVisible();
    if (await page.locator('#gameView').isVisible()) { await page.locator('#moreButton').click(); await page.locator('#competitionContextButton').click(); }
    else if (await page.locator('#competitionIntermissionButton').isVisible()) await page.locator('#competitionIntermissionButton').click();
    else if (await page.locator('#competitionLobbyButton').isVisible()) await page.locator('#competitionLobbyButton').click();
    else { await page.locator('#myPodsButton').click(); await page.locator('[data-open]').filter({ hasText: podName }).click(); }
    if (fromTable) { await page.locator('#openTableScope').waitFor(); await page.locator('#openTableScope').click(); }
  }
  await page.locator('#podPlay').waitFor();
}

export async function podExperienceEntryFlow(qa, { podName = 'Pod experience QA' } = {}) {
  const host = await qa.phone(), member = await qa.phone();
  await qa.signIn(host); await host.locator('#myPodsButton').click(); await host.locator('#hubCreate').click();
  await host.locator('#hubCreateForm [name=name]').fill(podName);
  await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await host.locator('#hubCreateForm button[type=submit]').click(); await host.locator('#podPlay').waitFor();
  qa.check('Pod home exposes inviting members without a menu detour', await host.locator('#podInviteMember').count() === 1);
  await qa.shot(host, 'pod-experience-home-390');
  await host.locator('#podInviteMember').click();
  const inviteLink = await host.locator('#inviteLink').inputValue();
  await member.goto(inviteLink, { waitUntil: 'domcontentloaded' });
  await member.locator('#hubJoinForm [name=displayName]').fill('Nico');
  qa.check('Pod preview remains available before sign-in', (await member.locator('#hubJoinForm button[type=submit]').innerText()).includes('Sign in'));
  await member.locator('#hubJoinForm button[type=submit]').click();
  await member.locator('#emailSignInButton').click(); await member.locator('#accountEmail').fill('member@fixture.invalid');
  await member.locator('#accountPassword').fill('fixture-only'); await member.locator('#emailSignInButton').click();
  await member.locator('#hubJoinForm button[type=submit]').filter({ hasText: 'Accept and join' }).waitFor();
  qa.check('Pod invite name survives sign-in', await member.locator('#hubJoinForm [name=displayName]').inputValue() === 'Nico');
  await member.locator('#hubJoinForm button[type=submit]').click(); await member.locator('#podPlay').waitFor();

  await host.locator('#competitionBack').click(); await host.locator('#podPlay').click();
  qa.check('Play distinguishes creating from joining a Table', await host.locator('#podCreateTable').count() === 1 && await host.locator('#podJoinTable').count() === 1);
  await host.locator('#podCreateTable').click(); await host.locator('#createView').waitFor({ state: 'visible' });
  const code = await qa.createTable(host);
  await host.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  await member.locator('#podPlay').click(); await member.locator('#podJoinTable').click();
  await member.locator('#podJoinTableForm [name=code]').fill(code);
  await member.locator('#podJoinTableForm button[type=submit]').click();
  await qa.joinTable(member, code, { fromEvent: true });
  await member.locator('#competitionSetupStatus').filter({ hasText: 'Your seat is linked' }).waitFor();
  qa.check('Joining from a Pod reaches the host Table and links the member', (await member.locator('#lobbyInviteCode').innerText()).trim() === code);

  for (const [name, page] of [['host', host], ['member', member]]) {
    await page.locator('#competitionLobbyButton').click(); await page.locator('#tableCreditSummary').waitFor();
    qa.check(`${name} sees pre-start Pod credit guidance`, (await page.locator('#tableCreditSummary').innerText()).length > 0);
    await page.locator('#openTableScope').click(); await page.locator('#podPlay').click();
    await page.locator('#returnCurrentTable').click(); await page.locator('#lobbyView').waitFor({ state: 'visible' });
    qa.check(`${name} returns to the same lobby seat without opening creation`, (await page.locator('#lobbyInviteCode').innerText()).trim() === code && !await page.locator('#createView').isVisible());
  }
  return { host, member, code, inviteLink, podName };
}

export async function podExperienceResultFlow(qa, flow) {
  const { host, member, podName } = flow;
  await host.locator('#startGameButton').click(); await member.locator('#gameView').waitFor({ state: 'visible' });
  await host.locator('#moreButton').click(); await host.locator('#competitionContextButton').click();
  qa.check('Pre-start credit guidance does not redefine a sealed playing game', !await host.locator('#tableCreditSummary').isVisible());
  await host.locator('#openTableScope').click();
  const requestsBefore = qa.competitionCount();
  await member.getByRole('button', { name: 'Decrease counter by one', exact: true }).tap();
  await member.locator('#mainValue').filter({ hasText: /^39$/ }).waitFor(); await host.locator('#podStrip').filter({ hasText: '39' }).waitFor();
  qa.check('An ordinary life change makes no competition request', qa.competitionCount() === requestsBefore);
  await qa.declareWinner(host); await qa.dismissFinish(host);
  await host.locator('#competitionIntermissionButton').click(); await host.locator('#openTableScope').click();
  await host.locator('#podPending').click(); await host.locator('[data-game]').first().waitFor();
  qa.check('Awaiting confirmation opens games directly without date buckets', await host.locator('[data-day]').count() === 0);
  await host.locator('[data-game]').first().click(); await host.locator('#confirmOrderForm').waitFor();
  await host.getByRole('combobox', { name: 'Finishing position for Nico', exact: true }).selectOption('2');
  await host.locator('#confirmOrderForm button[type=submit]').click(); await host.locator('#correctOrder').waitFor();
  qa.check('Confirmed result is a saved summary with correction entered explicitly', await host.locator('#confirmOrderForm').count() === 0);
  await qa.shot(host, 'pod-experience-confirmed-summary-390');
  await host.locator('#correctOrder').click(); await host.locator('#confirmOrderForm').waitFor();
  await host.getByRole('combobox', { name: 'Finishing position for Mira', exact: true }).selectOption('1');
  await host.getByRole('combobox', { name: 'Finishing position for Nico', exact: true }).selectOption('1');
  await host.locator('#confirmOrderForm [name=reasonCode]').selectOption('tie_correction');
  const confirmation = '**/api/competitions/pod/*/games/*/confirm';
  await host.route(confirmation, async route => { await route.fetch(); await route.abort('failed'); });
  try {
    await host.locator('#confirmOrderForm button[type=submit]').click();
    await host.locator('#competitionStatus').filter({ hasText: /Failed to fetch|NetworkError|Load failed/ }).waitFor();
    qa.check('Lost correction response retains the chosen order', await host.getByRole('combobox', { name: 'Finishing position for Nico', exact: true }).inputValue() === '1');
  } finally { await host.unroute(confirmation); }
  await host.locator('#confirmOrderForm button[type=submit]').click(); await host.locator('#correctOrder').waitFor();
  qa.check('Retried correction returns to the saved summary once', await host.locator('#confirmOrderForm').count() === 0 && await host.locator('#competitionContent h4').count() === 2);
  await host.getByText('Original app order and revisions', { exact: true }).click();
  qa.check('Correction retains the explicit reason and original revisions', (await host.locator('#competitionContent').innerText()).includes('tie correction'));
  await qa.shot(host, 'pod-experience-corrected-result-390');
  await openPodHome(host, podName);
  qa.check('Confirmed game no longer appears as pending on Pod home', await host.locator('#podPending').count() === 0);

  await qa.dismissFinish(member); await member.locator('#competitionIntermissionButton').click(); await member.locator('#openTableScope').click();
  qa.check('Both Pod members retain game credit after correction', (await member.locator('.competition-ranks').innerText()).includes('Nico · You') && (await member.locator('.competition-ranks').innerText()).includes('1/10 rated games'));
  await host.locator('#competitionClose').click(); await host.locator('#intermissionReadyButton').click();
  await host.locator('#intermissionDetail').filter({ hasText: '1/2' }).waitFor();
  await member.locator('#podPlay').click(); await member.locator('#returnCurrentTable').click();
  await member.locator('#intermissionView').waitFor({ state: 'visible' });
  qa.check('A non-host returns to intermission without a Create-screen detour', !await member.locator('#createView').isVisible());
  await member.locator('#intermissionReadyButton').click(); await host.locator('#intermissionStartButton').click();
  await host.locator('#confirmNextGameStart').click(); await member.locator('#gameView').waitFor({ state: 'visible' });
  qa.check('The next Pod game starts from the same Table', (await member.locator('#podLabel').innerText()).includes(flow.code));
  return flow;
}

export async function podExperienceManagementFlow(qa, flow) {
  const { host, member, podName } = flow;
  await openPodHome(host, podName); await host.locator('#podManage').click();
  const nico = () => host.locator('.competition-member').filter({ has: host.locator('strong', { hasText: /^Nico$/ }) });
  await nico().locator('[data-admin]').click(); await nico().locator('small').filter({ hasText: /^Admin$/ }).waitFor();
  qa.check('Role changes keep the refreshed Members view open', await nico().isVisible());
  qa.check('Role change finishes with visible feedback', !['', 'Working…'].includes(await host.locator('#competitionStatus').innerText()));
  await nico().locator('[data-remove]').click(); await host.locator('#hubConfirm').waitFor();
  qa.check('Member removal confirmation identifies its target', (await host.locator('#competitionDialog').innerText()).includes('Nico'));
  await qa.shot(host, 'pod-experience-named-removal-390');
  await host.locator('#hubConfirm').click();
  await host.locator('#competitionContent').getByRole('heading', { name: 'Members', exact: true }).waitFor();
  qa.check('Removal stays in Members and removes the selected row', await nico().count() === 0);
  await host.locator('#podInvite').click(); const replacementInvite = await host.locator('#inviteLink').inputValue();
  await member.goto(replacementInvite, { waitUntil: 'domcontentloaded' }); await member.locator('#hubJoinForm [name=displayName]').fill('Nico');
  await member.locator('#hubJoinForm button[type=submit]').click(); await member.locator('#podPlay').waitFor();
  qa.check('Fresh admin invite restores the returning member record', (await member.locator('.competition-ranks').innerText()).includes('1/10 rated games'));
  await host.locator('#inviteRevoke').click(); await host.locator('#podPlay').waitFor();
  await host.locator('#podInviteMember').click(); const validInvite = await host.locator('#inviteLink').inputValue();
  const outsider = await qa.phone();
  try {
    await outsider.goto(replacementInvite, { waitUntil: 'domcontentloaded' });
    await outsider.locator('#useAnotherInvite').click(); await outsider.locator('#hubInviteForm').waitFor();
    await outsider.locator('#hubInviteForm [name=invite]').fill(validInvite);
    await outsider.locator('#hubInviteForm button[type=submit]').click(); await outsider.locator('#hubJoinForm').waitFor();
    qa.check('Revoked invite recovers to a different valid unsigned preview', (await outsider.locator('#competitionTitle').innerText()).includes(podName));
    await outsider.setViewportSize({ width: 320, height: 700 }); await qa.shot(outsider, 'pod-experience-invite-recovery-320');
    const fit = await qa.fit(outsider); qa.check('Recovered invite fits 320px without small controls', !fit.horizontalOverflow && !fit.smallControls.length);
  } finally { await outsider.context().close(); }
  return flow;
}

export async function podInviteSharingFlow(qa, flow) {
  const { host, podName } = flow;
  await openPodHome(host, podName); await host.locator('#podInviteMember').click();
  // Simulate only browser/platform outcomes; app controls and handlers stay real.
  await host.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} }));
  await host.locator('#inviteShare').click(); await host.locator('#competitionContent:not([aria-busy])').waitFor();
  qa.check('Successful sharing clears the working status', !['', 'Working…'].includes(await host.locator('#competitionStatus').innerText()));
  await host.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } }));
  await host.locator('#inviteShare').click(); await host.locator('#competitionContent:not([aria-busy])').waitFor();
  qa.check('Share cancellation keeps an actionable invite screen', await host.locator('#inviteLink').isVisible() && !/Working|error|failed/i.test(await host.locator('#competitionStatus').innerText()));
  await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Fixture clipboard denied'); } } }));
  await host.locator('#inviteCopy').click(); await host.locator('#competitionContent:not([aria-busy])').waitFor();
  qa.check('Clipboard denial leaves the invite selected for manual copying', await host.locator('#inviteLink').evaluate(input => input.selectionStart === 0 && input.selectionEnd === input.value.length));
  await host.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise(resolve => { window.releasePodShareFixture = resolve; }) }));
  await host.locator('#inviteShare').click(); await host.locator('#competitionBack').click(); await host.locator('#podPlay').waitFor();
  const statusBefore = await host.locator('#competitionStatus').innerText();
  await host.evaluate(async () => { window.releasePodShareFixture(); await new Promise(requestAnimationFrame); });
  qa.check('Late sharing completion cannot overwrite a different screen', await host.locator('#competitionStatus').innerText() === statusBefore && await host.locator('#podPlay').isVisible());
  return flow;
}

export async function podUnlinkedTableReuseFlow(qa, { podName = 'Unlinked Table reuse QA' } = {}) {
  const host = await qa.phone();
  // The invite must be a same-document fragment transition, preserving the seat.
  await host.goto(qa.origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await qa.signIn(host); await host.locator('#myPodsButton').click(); await host.locator('#hubCreate').click();
  await host.locator('#hubCreateForm [name=name]').fill(podName);
  await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
  await host.locator('#hubCreateForm button[type=submit]').click(); await host.locator('#podInviteMember').click();
  const inviteLink = await host.locator('#inviteLink').inputValue();
  await host.locator('#competitionClose').click(); await host.locator('#createPodButton').click();
  const code = await qa.createTable(host);
  const before = (await (await host.request.get(qa.origin + '/api/rooms/' + code)).json()).snapshot;
  await host.goto(inviteLink, { waitUntil: 'domcontentloaded' });
  await host.locator('#hubJoinForm [name=displayName]').fill('Mira');
  await host.locator('#hubJoinForm button[type=submit]').click(); await host.locator('#podPlay').click();
  await host.locator('#podUseCurrentTable').waitFor();
  qa.check('An unlinked Table host can return or explicitly reuse the same Table', await host.locator('#returnCurrentTable').isVisible() && await host.locator('#podUseCurrentTable').isVisible());
  await host.locator('#podUseCurrentTable').click(); await host.locator('#hubConfirm').waitFor();
  qa.check('Reusing a current Table asks before linking the Pod', (await host.locator('#competitionContent').innerText()).includes(podName));
  await host.locator('#hubConfirm').click(); await host.locator('#competitionDialog').waitFor({ state: 'hidden' }); await host.locator('#lobbyView').waitFor({ state: 'visible' });
  await host.locator('#competitionSetupStatus').filter({ hasText: podName }).waitFor();
  const after = (await (await host.request.get(qa.origin + '/api/rooms/' + code)).json()).snapshot;
  const claimed = snapshot => snapshot.seats.filter(seat => seat.claimed).map(({ seatId, name }) => ({ seatId, name }));
  qa.check('Explicit Table reuse preserves its code, host and claimed seat', (await host.locator('#lobbyInviteCode').innerText()).trim() === code && after.hostSeatId === before.hostSeatId && JSON.stringify(claimed(after)) === JSON.stringify(claimed(before)));
  await qa.shot(host, 'pod-experience-existing-table-reused-390');
  return { host, code, podName, inviteLink };
}

export async function podPrivateActivityFlow(qa, flow, { expectedState = 'Setting up', memberNames = ['Mira', 'Nico'], expectJoinable = true } = {}) {
  const { host, code, podName } = flow;
  await openPodHome(host, podName); await host.locator('#podActivity').click();
  const table = () => host.locator('.competition-table-card').filter({ hasText: code });
  await table().waitFor();
  const activity = await host.locator('#competitionContent').innerText();
  qa.check('Activity is described as private recent app connections, not store attendance', activity.includes('Private to this Pod') && activity.includes('do not confirm that someone is at a store') && activity.includes('Checked'));
  qa.check('Pod activity shows the current Table state and claimed-seat counts', (await table().innerText()).includes(expectedState) && /\d+\/\d+ seats claimed/.test(await table().innerText()));
  qa.check('Pod activity shows linked member names with connection freshness', memberNames.every(name => activity.includes(name)) && activity.includes('recent connection'));
  const refreshesBefore = qa.requests.filter(row => row.method === 'GET' && row.path.endsWith('/activity')).length;
  await host.locator('#refreshPodActivity').click(); await host.locator('#competitionContent:not([aria-busy])').waitFor();
  qa.check('Activity Refresh requests a fresh private snapshot', qa.requests.filter(row => row.method === 'GET' && row.path.endsWith('/activity')).length === refreshesBefore + 1);
  if (expectJoinable) {
    await table().locator('[data-join-active]').waitFor(); await table().locator('[data-join-active]').click();
    await host.locator('#returnCurrentTable').waitFor();
    qa.check('A seated player choosing an open activity Table keeps their current seat', await host.locator('#podJoinTableForm').count() === 0 && (await host.locator('#competitionContent').innerText()).includes(code));
    await host.locator('#returnCurrentTable').click();
    await host.locator('#lobbyView:not([hidden]) #lobbyInviteCode, #intermissionView:not([hidden]) #intermissionInviteCode').filter({ hasText: code }).waitFor();
    await openPodHome(host, podName); await host.locator('#podActivity').click(); await table().waitFor();
  } else {
    qa.check('A playing Table does not advertise seats as open to join', await table().locator('[data-join-active]').count() === 0 && (await table().innerText()).includes('join between games'));
  }
  await host.setViewportSize({ width: 320, height: 700 }); await qa.shot(host, 'pod-experience-private-activity-320');
  const fit = await qa.fit(host); qa.check('Private activity fits a narrow phone', !fit.horizontalOverflow && !fit.smallControls.length);
  await host.setViewportSize({ width: 390, height: 844 }); await openPodHome(host, podName);
  return flow;
}

export async function podAbandonedCreationJoinFlow(qa, { podName = 'Abandoned creation QA' } = {}) {
  const host = await qa.phone(), tableHost = await qa.phone();
  try {
    await qa.signIn(host); await host.locator('#myPodsButton').click(); await host.locator('#hubCreate').click();
    await host.locator('#hubCreateForm [name=name]').fill(podName);
    await host.locator('#hubCreateForm [name=displayName]').fill('Mira');
    await host.locator('#hubCreateForm button[type=submit]').click(); await host.locator('#podPlay').click();
    await host.locator('#podCreateTable').click(); await host.locator('#createView').waitFor({ state: 'visible' });
    await host.locator('#createView [data-back]').click(); await host.locator('#landingView').waitFor({ state: 'visible' });
    await tableHost.locator('#createPodButton').click(); const code = await qa.createTable(tableHost, { name: 'Quinn' });
    await qa.joinTable(host, code, { name: 'Mira' });
    // Read only the noncredential navigation intent; normal controls perform all actions.
    const pending = await host.evaluate(() => sessionStorage.getItem('fivefold-arc:pending-competition'));
    qa.check('Home Join clears an abandoned Pod creation intent', pending === null);
    qa.check('Joining an unlinked Table does not claim the abandoned Pod', !await host.locator('#competitionSetupStatus').isVisible() && !await host.locator('#competitionLobbyButton').isVisible());
    await qa.shot(host, 'pod-experience-abandoned-create-home-join-390');
  } finally { await Promise.all([host.context().close(), tableHost.context().close()]); }
}
