import { orderFromChoices, finishingChoices, localDateKey, parseCompetitionFragment, setupObservationKey, contextObservationKey } from './competition-model.mjs?v=1';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const button = (id, label, primary = false) => `<button type="button" id="${id}" class="${primary ? 'primary-action' : 'secondary-action'}">${escape(label)}</button>`;
const field = (name, label, options = '') => `<label class="select-field">${escape(label)}<input name="${name}" ${options}></label>`;
const readLocal = (key, storage = localStorage) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
const writeLocal = (key, value, storage = localStorage) => { try { if (value) storage.setItem(key, JSON.stringify(value)); else storage.removeItem(key); } catch { /* The interface still works without browser storage. */ } };
const dateLabel = timestamp => new Date(timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const statusLabel = status => ({ left: 'Left early', removed: 'Removed', deleted: 'Deleted member', pending: 'Awaiting host approval', active: '', declined: 'Not entering' })[status] || status;

export function createCompetitionHub(adapter) {
  const dialog = document.querySelector('#competitionDialog'), content = document.querySelector('#competitionContent');
  const heading = document.querySelector('#competitionTitle'), status = document.querySelector('#competitionStatus');
  const backButton = document.querySelector('#competitionBack'), closeButton = document.querySelector('#competitionClose');
  const contextButton = document.querySelector('#competitionContextButton'), setupStatus = document.querySelector('#competitionSetupStatus');
  const intermissionButton = document.querySelector('#competitionIntermissionButton');
  const lobbyButton = document.querySelector('#competitionLobbyButton');
  const guestsKey = 'fivefold-arc:event-access', pendingKey = 'fivefold-arc:pending-competition', roomScopesKey = 'fivefold-arc:competition-tables';
  const joinIdsKey = 'fivefold-arc:invite-join-ids';
  const joinIds = readLocal(joinIdsKey, sessionStorage) || {};
  const entryGenerations = new Map();
  const beginEntry = id => { const generation = (entryGenerations.get(id) || 0) + 1; entryGenerations.set(id, generation); return generation; };
  let guests = readLocal(guestsKey) || {}, pending = readLocal(pendingKey, sessionStorage);
  let enabled = false, podDeletionEnabled = false, back = null, afterSignIn = null, authEpoch = 0, observation = null, syncing = null;
  let context = null, latestSnapshot = null, retrySetup = null, currentInvite = null, retryFragment = null;
  let navigationEpoch = 0, contextAttempt = null;
  const roomScopes = new Map(Object.entries(readLocal(roomScopesKey, sessionStorage) || {}));
  const rememberRoom = (code, scopeId) => { roomScopes.set(code, scopeId); writeLocal(roomScopesKey, Object.fromEntries(roomScopes), sessionStorage); };
  const session = () => adapter.getSession();
  const message = text => { status.textContent = text; };
  const open = () => { if (!dialog.open) dialog.showModal(); };
  const close = () => { navigationEpoch++; dialog.close(); };
  const draw = (title, html, previous = null) => {
    currentInvite = null;
    content.removeAttribute('aria-busy');
    heading.textContent = title; content.innerHTML = html; message(''); back = previous;
    backButton.hidden = !back; open(); heading.focus(); content.scrollTop = 0;
  };
  const run = async (action, target) => {
    if (target?.disabled) return;
    const navigation = ++navigationEpoch;
    const initiallyClosed = !dialog.open;
    if (initiallyClosed) draw('Loading…', '<p>Opening your groups and events…</p>');
    if (target) target.disabled = true;
    content.setAttribute('aria-busy', 'true'); message('Working…');
    try { await action(); }
    catch (error) {
      if (navigation !== navigationEpoch) return;
      message(error.message || 'That did not finish. Try again.');
      if (initiallyClosed) { content.innerHTML = button('hubRetry', 'Try again'); bind('#hubRetry', action); }
    }
    finally { if (target?.isConnected) target.disabled = false; if (navigation === navigationEpoch) content.removeAttribute('aria-busy'); }
  };
  const bind = (selector, action) => content.querySelector(selector)?.addEventListener('click', event => { void run(() => action(event), event.currentTarget); });
  const submit = (selector, action) => content.querySelector(selector)?.addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(() => action(form, event.currentTarget), event.submitter);
  });
  async function token() { try { return await adapter.getAccountToken(); } catch { return null; } }
  async function request(path, { body, method = body !== undefined ? 'POST' : 'GET', scopeId, guestToken, noAccount = false, connectionId, viewAware = true } = {}) {
    const epoch = authEpoch;
    const navigation = navigationEpoch;
    const capability = guestToken || (scopeId && guests[scopeId]?.guestToken);
    const accountToken = !capability && !noAccount ? await token() : null;
    const response = await fetch(`/api/competitions/${path}`, { method, cache: 'no-store', headers: {
      ...(accountToken ? { authorization: `Bearer ${accountToken}` } : {}), ...(capability ? { 'x-event-token': capability } : {}),
      ...(connectionId ? { 'x-connection-id': connectionId } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (viewAware && navigation !== navigationEpoch) throw Object.assign(new Error('This screen was closed or changed.'), { code: 'HUB_NAVIGATION_CHANGED' });
    if (!noAccount && !capability && epoch !== authEpoch) throw new Error('Account changed. Open this screen again.');
    if (!response.ok) throw Object.assign(new Error(data.message || data.error?.message || data.error || 'That request did not finish.'), { status: response.status, code: data.code });
    return data;
  }
  function signInThen(resume) { afterSignIn = resume; close(); adapter.openSignIn(); }
  async function needAccount(resume) {
    const navigation = navigationEpoch; const signedIn = await token();
    if (navigation !== navigationEpoch) return false;
    if (signedIn) return true;
    draw('Sign in for Pods', `<p>Pods keep private memberships and ratings. Sign in, then choose whether to join.</p>${button('hubSignIn', 'Sign in', true)}`);
    bind('#hubSignIn', () => signInThen(resume)); return false;
  }
  function rememberGuest(event) {
    if (event.guestToken) {
      guests[event.id] = { id: event.id, name: event.name, guestToken: event.guestToken };
      writeLocal(guestsKey, guests);
    } else if (event.kind === 'tournament' && guests[event.id]) {
      // An explicit account entry uses that account's permissions and statistics.
      // Previous guest results remain a separate host-managed entrant.
      delete guests[event.id]; writeLocal(guestsKey, guests);
    }
  }
  const route = (kind, id, suffix = '') => `${kind}/${encodeURIComponent(id)}${suffix ? '/' + suffix : ''}`;

  async function home(kind = 'pod') {
    const navigation = navigationEpoch;
    const signedIn = Boolean(await token());
    if (navigation !== navigationEpoch) return;
    const mine = signedIn ? await request('mine') : { pods: [], tournaments: [] };
    const entries = kind === 'pod' ? mine.pods : [...mine.tournaments,
      ...Object.values(guests).filter(row => !mine.tournaments.some(event => event.id === row.id))];
    draw(kind === 'pod' ? 'My Pods' : 'Tournaments', `
      <p>${kind === 'pod' ? 'Your recurring groups. Each Pod has its own rating.' : 'Standalone events. Results never change Pod ratings.'}</p>
      <div class="competition-actions">${button('hubCreate', kind === 'pod' ? 'Create a Pod' : 'Create tournament', true)}${button('hubJoin', 'Use an invite')}</div>
      ${!signedIn && kind === 'pod' ? `<p>Sign in to create or join a private Pod.</p>${button('hubAccount', 'Sign in')}` : ''}
      <div class="competition-list">${entries.map(row => `<button class="competition-row" data-open="${escape(row.id)}" type="button"><strong>${escape(row.name)}</strong><span>${escape(row.status || 'Guest access on this phone')} <b aria-hidden="true">›</b></span></button>`).join('') || '<p class="competition-empty">Nothing here yet. Use an invite or create your first one.</p>'}</div>`);
    bind('#hubCreate', () => createForm(kind)); bind('#hubJoin', () => inviteForm()); bind('#hubAccount', () => signInThen(() => home(kind)));
    content.querySelectorAll('[data-open]').forEach(node => node.addEventListener('click', () => void run(() => scopeScreen(kind, node.dataset.open), node)));
  }
  async function createForm(kind) {
    if (!await needAccount(() => createForm(kind))) return;
    const requestId = crypto.randomUUID();
    draw(kind === 'pod' ? 'Create a Pod' : 'Create tournament', `<form id="hubCreateForm">
      ${field('name', kind === 'pod' ? 'Pod name' : 'Tournament name', 'required maxlength="80" autocomplete="off"')}
      ${field('displayName', 'Your name in this group', `required maxlength="80" autocomplete="nickname" value="${escape(adapter.getPreferredName())}"`)}
      ${kind === 'tournament' ? `<div class="competition-form-grid">${field('rounds', 'Number of rounds', 'type="number" required min="1" max="20" value="3" inputmode="numeric"')}
        <label class="select-field">Preferred Table size<select name="preferredSize">${Array.from({ length: 7 }, (_, i) => `<option ${i === 2 ? 'selected' : ''}>${i + 2}</option>`).join('')}</select></label></div>
        <label class="select-field">Later-round seating<select name="priority"><option value="new_opponents">New opponents first</option><option value="standings">Standings first</option></select></label>
        ${field('minutes', 'Round minutes (optional)', 'type="number" min="1" max="240" inputmode="numeric" placeholder="Untimed"')}
        <p class="competition-help">Round one is random. Later rounds use combined points and your seating priority. Ties share placement points. Timed rounds finish the current turn, then five additional turns total.</p>` : '<p class="competition-help">Private invites, ongoing ratings, no attendance penalty. Any active member can host.</p>'}
      <button class="primary-action" type="submit">${kind === 'pod' ? 'Create Pod' : 'Create tournament'}</button></form>`, () => home(kind));
    submit('#hubCreateForm', async form => {
      const body = Object.fromEntries(form); body.requestId = requestId;
      if (kind === 'tournament') { body.rounds = Number(body.rounds); body.preferredSize = Number(body.preferredSize); body.minutes = body.minutes ? Number(body.minutes) : null; }
      const result = await request(kind === 'pod' ? 'pods' : 'tournaments', { body });
      await scopeScreen(kind, result.id);
    });
  }
  function inviteForm() {
    draw('Use an invite', `<form id="hubInviteForm"><label class="select-field">Invite link or code<textarea name="invite" required rows="3" autocomplete="off" spellcheck="false"></textarea></label><button class="primary-action" type="submit">Preview invite</button></form><p class="competition-help">Get a private link or QR from a member or event host. There is no public directory.</p>`, () => home());
    submit('#hubInviteForm', form => {
      let value = String(form.get('invite')).trim();
      if (value.includes('#')) value = parseCompetitionFragment(value.slice(value.indexOf('#')))?.invite || '';
      return invitePreview(value);
    });
  }
  async function invitePreview(invite, enteredName = '') {
    const navigation = navigationEpoch;
    const preview = await request('invite-preview', { body: { token: invite }, noAccount: true });
    const signedIn = Boolean(await token());
    const joinKey = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invite)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const requestId = joinIds[joinKey] ||= crypto.randomUUID();
    writeLocal(joinIdsKey, Object.fromEntries(Object.entries(joinIds).slice(-100)), sessionStorage);
    if (navigation !== navigationEpoch) return;
    // Account restoration can refresh this preview while the user edits it.
    const draft = currentInvite === invite ? content.querySelector('#hubJoinForm') : null;
    const displayName = draft?.querySelector('[name=displayName]')?.value ?? (enteredName || adapter.getPreferredName());
    const entry = draft?.querySelector('[name=entry]')?.value;
    draw(`Join ${preview.name}`, `<p>Invited by ${escape(preview.inviter)}. ${preview.kind === 'pod' ? 'Joining shares your Pod games and rating with active members.' : 'This is a standalone tournament; guests can enter without an account.'}</p>
      <form id="hubJoinForm">${field('displayName', 'Your name', `required maxlength="80" autocomplete="nickname" value="${escape(displayName)}"`)}
      ${preview.kind === 'tournament' && signedIn ? `<label class="select-field">Enter as<select name="entry"><option value="account">My signed-in account</option><option value="guest"${entry === 'guest' ? ' selected' : ''}>Guest for this event</option></select></label>` : ''}
      ${preview.kind === 'tournament' && signedIn && guests[preview.id] ? '<p class="competition-help">Your previous guest entry stays separate. An account entry starts or resumes that account’s points. The host can withdraw an unused guest entry.</p>' : ''}
      <button class="primary-action" type="submit">${preview.kind === 'pod' && !signedIn ? 'Sign in to join' : 'Accept and join'}</button></form>
      <p class="competition-help">${preview.kind === 'pod' ? 'You can leave later. Previous rating and game count are kept for your return.' : 'Points use the full finishing order: four players score 3, 2, 1, 0. Ties share points. If timed: finish this turn plus five total additional turns, then shared top places.'}</p>`, () => inviteForm());
    currentInvite = invite;
    submit('#hubJoinForm', async form => {
      if (preview.kind === 'pod' && !await token()) { signInThen(() => invitePreview(invite, String(form.get('displayName')))); return; }
      const navigation = navigationEpoch;
      const generation = beginEntry(preview.id);
      const asGuest = preview.kind === 'tournament' && (form.get('entry') === 'guest' || !await token());
      const result = await request('join', { body: { token: invite, displayName: form.get('displayName'), requestId }, noAccount: asGuest, viewAware: false });
      // Successful entry credentials must survive Close/Back or a lost UI transition.
      if (generation !== entryGenerations.get(preview.id)) return;
      rememberGuest(result);
      if (navigation === navigationEpoch) await scopeScreen(preview.kind, preview.id);
    });
  }
  async function scopeScreen(kind, id) { return kind === 'pod' ? podScreen(id) : eventScreen(id); }
  async function podScreen(id) {
    const pod = await request(route('pod', id));
    const ranked = pod.members.filter(row => row.status === 'active');
    draw(pod.name, `<div class="competition-actions">${button('podPlay', 'Play', true)}${button('podHistory', 'History')}${button('podManage', 'Pod menu')}</div>
      <ol class="competition-ranks">${ranked.map((row, i) => `<li><span class="competition-rank">${i + 1}</span><span><strong>${escape(row.name)}${row.id === pod.me ? ' · You' : ''}</strong><small>${row.provisional ? `Provisional · ${row.ratedGames}/10 rated games` : `${row.gamesPlayed} games · ${row.wins} wins`}</small></span><b>${Math.round(row.rating)}</b></li>`).join('')}</ol>
      ${pod.pendingGames ? `<button type="button" id="podPending" class="text-action">${pod.pendingGames} result${pod.pendingGames === 1 ? '' : 's'} awaiting confirmation</button>` : ''}
      <p class="competition-help">Ratings change with results and opponent strength. Missing a night does not change your rating.</p>`, () => home('pod'));
    bind('#podPlay', () => launchTable({ kind: 'pod', id, name: pod.name }));
    bind('#podHistory', () => historyScreen('pod', id)); bind('#podPending', () => historyScreen('pod', id)); bind('#podManage', () => podMenu(pod));
  }
  function podMenu(pod) {
    const ownerRules = Object.hasOwn(pod, 'ownerId');
    const canManageAdmins = ownerRules ? pod.canManageAdmins : pod.role === 'admin';
    const owner = pod.members.find(row => row.id === pod.ownerId), successor = pod.members.find(row => row.id === pod.nextOwnerId);
    const noAdmins = !ownerRules && !pod.members.some(row => row.status === 'active' && row.role === 'admin');
    draw('Pod menu', `${ownerRules ? `<p>${owner ? `Owner: <strong>${escape(owner.name)}</strong>. Only the owner can appoint admins or delete this Pod.` : 'Pod ownership needs review before admin changes or deletion. Your games and results remain available.'}</p>` : ''}
      <div class="competition-actions">${button('podInvite', 'Invite someone')}${button('podLeave', 'Leave Pod')}${noAdmins ? button('podTakeover', 'Become an admin') : ''}</div>
      ${pod.role === 'admin' ? `<h3>Members</h3><div class="competition-list">${pod.members.filter(row => row.status === 'active').map(row => `<div class="competition-member"><strong>${escape(row.name)}</strong><small>${row.id === pod.ownerId ? 'Owner' : row.role === 'admin' ? 'Admin' : 'Member'}</small><div class="competition-actions">${canManageAdmins && row.id !== pod.ownerId ? `<button type="button" data-admin="${escape(row.id)}" data-enabled="${row.role !== 'admin'}" class="secondary-action">${row.role === 'admin' ? 'Remove admin role' : 'Make admin'}</button>` : ''}${row.id !== pod.me && (!ownerRules || canManageAdmins || row.role !== 'admin') ? `<button type="button" data-remove="${escape(row.id)}" class="text-action">Remove member</button>` : ""}</div></div>`).join('')}</div>` : ''}
      <details><summary>Recent membership changes</summary>${pod.audit.map(item => `<p>${escape(item.actor)} · ${escape(item.action.replaceAll('_', ' '))} · ${dateLabel(item.at)}</p>`).join('') || '<p>No membership changes.</p>'}</details>`, () => podScreen(pod.id));
    if (pod.role === 'admin') {
      content.querySelector('.competition-actions').insertAdjacentHTML('beforeend', button('podRename', 'Rename Pod'));
      bind('#podRename', () => {
        draw('Rename Pod', `<form id="renamePodForm">${field('name', 'Pod name', `required maxlength="80" value="${escape(pod.name)}"`)}<button type="submit" class="primary-action">Save name</button></form>`, () => podMenu(pod));
        submit('#renamePodForm', async form => { await request(route('pod', pod.id, 'members'), { body: { action: 'rename', name: form.get('name') } }); await podScreen(pod.id); });
      });
      if (podDeletionEnabled && (!ownerRules || pod.canDelete)) {
        content.querySelector('.competition-actions').insertAdjacentHTML('beforeend', '<button type="button" id="podDelete" class="danger-action">Delete Pod</button>');
        bind('#podDelete', async () => {
          await request(route('pod', pod.id, 'reconcile'), { body: {} });
          deletePodForm(pod);
        });
      }
    }
    content.querySelector('.competition-actions').insertAdjacentHTML('beforeend', button('podInvites', 'Manage invites'));
    bind('#podInvite', () => inviteScreen('pod', pod.id)); bind('#podInvites', () => issuedInvitesScreen('pod', pod.id));
    bind('#podLeave', () => {
      if (ownerRules && pod.ownerId === pod.me && !successor) { message('Appoint another admin before leaving, or delete the Pod if it is no longer needed.'); return; }
      const transfer = ownerRules && pod.ownerId === pod.me ? `Ownership will pass to ${successor.name}, the current admin appointed earliest. ` : '';
      return confirmScreen('Leave this Pod?', transfer + 'You lose access to the member list and history. Your results and rating are kept; an invite lets you resume later.', async () => {
        await request(route('pod', pod.id, 'members'), { body: { action: 'leave' } }); context = null; await home('pod');
      }, () => podMenu(pod));
    });
    bind('#podTakeover', async () => { await request(route('pod', pod.id, 'members'), { body: { action: 'takeover' } }); await podScreen(pod.id); });
    content.querySelectorAll('[data-admin]').forEach(node => node.addEventListener('click', () => void run(async () => {
      await request(route('pod', pod.id, 'members'), { body: { action: 'admin', targetId: node.dataset.admin, enabled: node.dataset.enabled === 'true' } }); await podScreen(pod.id);
    }, node)));
    content.querySelectorAll('[data-remove]').forEach(node => node.addEventListener('click', () => void run(() => confirmScreen('Remove member?', 'They will lose Pod access and need a new admin invite to return. Recorded results stay.', async () => {
      await request(route('pod', pod.id, 'members'), { body: { action: 'remove', targetId: node.dataset.remove } }); await podScreen(pod.id);
    }, () => podMenu(pod)), node)));
  }
  function deletePodForm(pod) {
    draw('Delete Pod?', `<p>Permanently delete <strong>${escape(pod.name)}</strong> for everyone?</p>
      <p>This removes its memberships, invites, shared game history and ratings. Personal game history stays. This cannot be undone.</p>
      <form id="deletePodForm">${field('confirmationName', 'Type the Pod name to confirm', 'required maxlength="80" autocomplete="off" spellcheck="false"')}
      <button type="submit" id="confirmPodDelete" class="danger-action" disabled>Delete Pod</button></form>`, () => podScreen(pod.id));
    const input = content.querySelector('[name="confirmationName"]'), confirm = content.querySelector('#confirmPodDelete');
    input.addEventListener('input', () => { confirm.disabled = input.value.trim() !== pod.name; });
    submit('#deletePodForm', async form => {
      input.disabled = true;
      try {
        await request(route('pod', pod.id), { method: 'DELETE', body: { confirmationName: form.get('confirmationName') } });
        context = null; observation = null;
        await home('pod'); message('Pod deleted.');
      } finally { input.disabled = false; }
    });
  }
  function confirmScreen(title, explanation, action, previous) {
    draw(title, `<p>${escape(explanation)}</p>${button('hubConfirm', 'Confirm', true)}`, previous); bind('#hubConfirm', action);
  }
  async function inviteScreen(kind, id) {
    const invite = await request(route(kind, id, 'invites'), { body: {}, scopeId: id });
    const qr = await request('invite-qr', { body: { token: invite.token }, noAccount: true });
    draw('Private invite', `<p>Share this with the people you want to invite. It expires in seven days.</p><img class="competition-qr" src="${escape(qr.data)}" alt="QR code for this private invitation">
      <label class="select-field">Invite link<input id="inviteLink" readonly value="${escape(qr.link)}"></label><div class="competition-actions">${button('inviteCopy', 'Copy link')}${button('inviteShare', 'Share link')}${button('inviteRevoke', 'Revoke this invite')}</div>`, () => scopeScreen(kind, id));
    bind('#inviteCopy', async () => { await navigator.clipboard.writeText(qr.link); message('Invite link copied.'); });
    bind('#inviteShare', async () => { if (navigator.share) await navigator.share({ title: 'Fivefold Arc invite', url: qr.link }); else { content.querySelector('#inviteLink').select(); message('Copy this link to share it.'); } });
    bind('#inviteRevoke', async () => { await request(route(kind, id, `invites/${invite.id}/revoke`), { body: {}, scopeId: id }); await scopeScreen(kind, id); message('Invite revoked.'); });
    content.querySelector('.competition-actions').insertAdjacentHTML('beforeend', button('inviteManage', 'Manage existing invites'));
    bind('#inviteManage', () => issuedInvitesScreen(kind, id));
  }
  async function issuedInvitesScreen(kind, id) {
    const { invites } = await request(route(kind, id, 'invites'), { scopeId: id });
    draw('Manage invites', `<p>${kind === 'pod' ? 'Members can revoke their own invites. Admins can manage every Pod invite.' : 'Event hosts can manage these invitations.'} Revoking a link stops future joins; existing memberships remain.</p>
      <div class="competition-list">${invites.map(row => `<section class="competition-member" data-invite-id="${escape(row.id)}"><strong>Invite by ${escape(row.issuer)}</strong><p>Created ${escape(new Date(row.createdAt).toLocaleString())} · ${escape(row.id.slice(-6))}</p><small>${escape(row.status)} · expires ${escape(dateLabel(row.expiresAt))}</small>${row.status !== 'revoked' ? `<button type="button" class="secondary-action" data-revoke-invite="${escape(row.id)}">Revoke invite</button>` : ''}</section>`).join('') || '<p>No invitations have been created.</p>'}</div>`, () => scopeScreen(kind, id));
    content.querySelectorAll('[data-revoke-invite]').forEach(node => node.addEventListener('click', () => void run(async () => {
      await request(route(kind, id, `invites/${node.dataset.revokeInvite}/revoke`), { scopeId: id, body: {} });
      await issuedInvitesScreen(kind, id); message('Invite revoked.');
    }, node)));
  }
  async function historyScreen(kind, id, rows = [], cursor = null) {
    await request(route(kind, id, 'reconcile'), { body: {}, scopeId: id });
    const page = await request(route(kind, id, `history${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`), { scopeId: id });
    const games = [...rows, ...page.games];
    const days = [...new Set(games.map(game => localDateKey(game.completedAt)))];
    draw('Game history', `<p>Choose a date, then a game.</p><div class="competition-list">${days.map(day => {
      const onDay = games.filter(game => localDateKey(game.completedAt) === day);
      return `<button type="button" class="competition-row" data-day="${day}"><strong>${escape(dateLabel(onDay[0].completedAt))}</strong><span>${onDay.length} game${onDay.length === 1 ? '' : 's'} ›</span></button>`;
    }).join('') || '<p class="competition-empty">No completed games yet. A real completed Table appears here before the host confirms its order.</p>'}</div>${page.nextCursor ? button('historyMore', 'Load older dates') : ''}`, () => scopeScreen(kind, id));
    content.querySelectorAll('[data-day]').forEach(node => node.addEventListener('click', () => void run(() => gamesOnDate(kind, id, node.dataset.day, games, () => historyScreen(kind, id)), node)));
    bind('#historyMore', () => historyScreen(kind, id, games, page.nextCursor));
  }
  function gamesOnDate(kind, id, day, games, previous) {
    const selected = games.filter(game => localDateKey(game.completedAt) === day);
    draw(dateLabel(selected[0].completedAt), `<div class="competition-list">${selected.map(game => `<button type="button" class="competition-row" data-game="${escape(game.gameId)}"><strong>${new Date(game.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${game.playerCount} players</strong><span>${game.status === 'pending' ? 'Needs host confirmation' : `Confirmed · revision ${game.revision}`} ›</span></button>`).join('')}</div>`, previous);
    content.querySelectorAll('[data-game]').forEach(node => node.addEventListener('click', () => void run(() => gameScreen(kind, id, node.dataset.game, () => gamesOnDate(kind, id, day, games, previous)), node)));
  }
  async function gameScreen(kind, id, gameId, previous = () => historyScreen(kind, id)) {
    const [game, scope] = await Promise.all([request(route(kind, id, `games/${gameId}`), { scopeId: id }), request(route(kind, id), { scopeId: id })]);
    const order = game.revisions.at(-1)?.order || game.original.inferredOrder || (game.original.winnerId ? [[game.original.winnerId]] : []);
    const choices = finishingChoices(order); const canEdit = scope.role === 'admin' || scope.me === game.hostId;
    const player = playerId => game.players.find(row => row.id === playerId);
    const orderHtml = groups => { let place = 1; return groups.map(group => {
      const label = `${group.length > 1 ? 'Tied ' : ''}${place}`; place += group.length;
      return `<li><b>${label}</b><span>${group.map(playerId => escape(player(playerId)?.name || 'Player')).join(' · ')}</span></li>`;
    }).join(''); };
    draw(game.status === 'pending' ? 'Review finishing order' : 'Game result', `<p>${escape(dateLabel(game.completedAt))} · ${game.players.length} players</p><p class="competition-help">${escape(game.provenance)}</p>
      <ol id="resultOrder" class="competition-order">${orderHtml(order)}</ol>
      ${!order.length || order.flat().length !== game.players.length ? '<p>The app knows only part of this finish. Choose every player’s position.</p>' : ''}
      ${canEdit ? `<form id="confirmOrderForm"><p>Check every position. Choose the same number to record a tie.</p>${game.original.kind === 'timed_draw' ? '<p>Timed draw: the recorded surviving players must remain tied at the top.</p>' : ''}
        ${game.players.map(row => `<label class="competition-place"><span><strong>${escape(row.name)}</strong><small>${row.kind === 'guest' ? (row.provenance === 'self_named_guest' ? 'Guest · self-entered name' : 'Organizer-attested guest') : (kind === 'tournament' ? 'Signed-in player' : 'Verified Pod member')}</small></span><select name="${escape(row.id)}" aria-label="Finishing position for ${escape(row.name)}" required><option value="">Choose</option>${Array.from({ length: game.players.length }, (_, i) => `<option value="${i + 1}" ${choices[row.id] === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>`).join('')}
        ${game.revisions.length ? '<label class="select-field">Correction reason<select name="reasonCode" required><option value="order_error">Finishing order was wrong</option><option value="tie_correction">Tie was recorded incorrectly</option><option value="recording_error">Recording mistake</option></select></label>' : ''}
        <p id="orderPreview" class="competition-help" aria-live="polite"></p><button class="primary-action" type="submit">${game.revisions.length ? 'Save corrected order' : 'Confirm finishing order'}</button></form>` : '<p>Only this game’s original host or an admin can change the confirmed order.</p>'}
      ${game.ratingChanges.length ? `<details><summary>Rating changes</summary>${game.ratingChanges.map(row => `<p>${escape(player(row.id)?.name)}: ${Math.round(row.before)} → ${Math.round(row.after)} (${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(1)})</p>`).join('')}</details>` : ''}
      <details><summary>Original app order and revisions</summary>
        <p>Original finish: ${game.original.kind === 'timed_draw' ? 'timed draw' : game.original.reason === 'declared_winner' ? 'winner declared at the Table' : 'last player standing'}${game.original.winnerId ? ` · ${escape(player(game.original.winnerId)?.name || 'Player')}` : ''}.</p>
        <ol class="competition-order">${orderHtml(game.original.inferredOrder || [])}</ol>
        ${game.revisions.map(row => `<h4>Revision ${row.revision} · ${escape(row.actor)}</h4><p>${escape(row.reasonCode.replaceAll('_', ' '))} · ${escape(dateLabel(row.at))}</p><ol class="competition-order">${orderHtml(row.order)}</ol>`).join('') || '<p>No confirmed order yet.</p>'}
      </details>`, previous);
    const form = content.querySelector('#confirmOrderForm'); const requestId = crypto.randomUUID();
    form?.addEventListener('change', () => {
      try {
        const groups = orderFromChoices(game.starterIds, Object.fromEntries(new FormData(form)));
        content.querySelector('#resultOrder').innerHTML = orderHtml(groups);
        content.querySelector('#orderPreview').textContent = 'This is the order that will be recorded above.';
      } catch { content.querySelector('#orderPreview').textContent = 'Choose a position for every player.'; }
    });
    submit('#confirmOrderForm', async formData => {
      const order = orderFromChoices(game.starterIds, Object.fromEntries(formData));
      await request(route(kind, id, `games/${gameId}/confirm`), { scopeId: id, body: { order, baseRevision: game.revisions.length,
        reasonCode: formData.get('reasonCode') || 'host_confirmation', requestId } });
      await gameScreen(kind, id, gameId, previous); message('Finishing order saved. Standings updated.');
    });
  }

  async function eventScreen(id) {
    const event = await request(route('tournament', id), { scopeId: id });
    const round = event.rounds.at(-1); const me = event.members.find(row => row.id === event.me);
    const assignment = round?.assignments.find(row => row.participantIds.includes(event.me));
    draw(event.name, `<p class="competition-eyebrow">${event.status === 'completed' ? 'Completed' : round ? `Round ${round.number} of ${event.settings.rounds} · ${round.status === 'draft' ? 'Reviewing seats' : round.status}` : 'Registration open'}</p>
      ${me.status === 'pending' ? '<p>Entry received. The host must approve you between rounds. You start with zero points.</p>' : ''}
      ${assignment ? assignmentHtml(event, assignment) : `<p>${me.participating ? (me.status === 'left' ? 'You have left play. Your earned points still count for final placings.' : 'Your next Table will appear when the host prepares a round.') : 'You are hosting this event. You can also enter as a player.'}</p>`}
      <div class="competition-actions">${button('eventStandings', 'Standings', true)}${button('eventTables', 'All tables')}${button('eventHistory', 'History')}${button('eventRefresh', 'Refresh')}</div>
      ${!me.participating && event.status !== 'completed' ? button('eventEnter', 'Play in this tournament') : ''}
      ${event.role === 'admin' ? `<div class="competition-host-bar">${!round || round.status === 'complete' ? (event.status !== 'completed' ? button('prepareRound', `Prepare round ${(round?.number || 0) + 1}`) : '') : round.status === 'draft' ? `${round.seatingStale ? '<p>Attendance or points changed. Review the seating again.</p>' : ''}${button('editSeating', 'Review seating')}${button('startRound', 'Start this round', true)}` : '<p>Confirm every Table result before the next round.</p>'}${button('eventManage', 'Host menu')}</div>` : ''}
      ${me.participating && me.status === 'active' ? button('eventLeave', 'Leave play early') : ''}
      <details><summary>Scoring and round rules</summary><p>${escape(event.rules)}</p><p>Rounds: ${event.settings.rounds}. Preferred Table size: ${event.settings.preferredSize}. ${event.settings.minutes ? `${event.settings.minutes} minutes per round.` : 'Untimed.'} Later seating: ${event.settings.priority === 'new_opponents' ? 'New opponents first' : 'Standings first'}.</p></details>`, () => home('tournament'));
    bind('#eventStandings', () => eventStandings(event)); bind('#eventTables', () => eventTables(event)); bind('#eventHistory', () => historyScreen('tournament', id)); bind('#eventRefresh', () => eventScreen(id));
    bind('#eventManage', () => eventMenu(event)); bind('#prepareRound', async () => { await request(route('tournament', id, 'rounds/prepare'), { scopeId: id, body: {} }); await eventScreen(id); });
    bind('#editSeating', () => seatingScreen(event)); bind('#startRound', () => confirmScreen('Start this round?', 'Players will use the reviewed assignments. A timed round’s clock starts now.', async () => {
      await request(route('tournament', id, 'rounds/start'), { scopeId: id, body: { roundId: round.id, baseVersion: event.version } }); await eventScreen(id);
    }, () => eventScreen(id)));
    bind('#eventLeave', () => confirmScreen('Leave play early?', 'Your earned points stay and you remain eligible for final placings. You will not be assigned future rounds.', async () => {
      await request(route('tournament', id, 'members'), { scopeId: id, body: { action: 'leave' } }); await eventScreen(id);
    }, () => eventScreen(id)));
    bind('#eventEnter', async () => {
      const invite = await request(route('tournament', id, 'invites'), { scopeId: id, body: {} });
      await request('join', { body: { token: invite.token, displayName: me.name } }); await eventScreen(id);
    });
    bindAssignments(event);
  }
  function assignmentHtml(event, assignment) {
    const round = event.rounds.find(row => row.assignments.some(item => item.id === assignment.id));
    const names = assignment.participantIds.map(id => event.members.find(row => row.id === id)?.name || 'Player');
    return `<article class="competition-table-card"><h3>${assignment.participantIds.includes(event.me) ? 'Your Table' : 'Table'} ${round.assignments.indexOf(assignment) + 1}</h3>
      <p>${names.map(escape).join(' · ')}</p><small>Table host: ${escape(event.members.find(row => row.id === assignment.hostId)?.name)}</small>
      ${assignment.cancelled ? '<p>Unplayed · cancelled · no points</p>' : assignment.gameId ? `<button type="button" class="secondary-action" data-result="${escape(assignment.gameId)}">Review result</button>`
        : assignment.roomCode ? `<p class="competition-code">${escape(assignment.roomCode)}</p><button type="button" class="secondary-action" data-join-table="${escape(assignment.roomCode)}">${session().code === assignment.roomCode ? 'Return to Table' : 'Join Table'}</button>`
        : assignment.hostId === event.me ? `<button type="button" class="primary-action" data-create-table="${escape(assignment.id)}">Create assigned Table</button>` : '<p>Waiting for the assigned Table host.</p>'}
      ${round.endsAt && !assignment.cancelled && !assignment.gameId ? `<button type="button" class="text-action" data-clock="${escape(assignment.id)}">Round clock & final turns</button>` : ''}</article>`;
  }
  function bindAssignments(event) {
    content.querySelectorAll('[data-create-table]').forEach(node => node.addEventListener('click', () => void run(() => {
      const assignment = event.rounds.flatMap(row => row.assignments).find(row => row.id === node.dataset.createTable);
      return launchTable({ kind: 'tournament', id: event.id, name: event.name, assignmentId: assignment.id, playerCount: assignment.participantIds.length });
    }, node)));
    content.querySelectorAll('[data-join-table]').forEach(node => node.addEventListener('click', () => { rememberRoom(node.dataset.joinTable, event.id); close(); adapter.joinTable(node.dataset.joinTable); }));
    content.querySelectorAll('[data-result]').forEach(node => node.addEventListener('click', () => void run(() => gameScreen('tournament', event.id, node.dataset.result, () => eventScreen(event.id)), node)));
    content.querySelectorAll('[data-clock]').forEach(node => node.addEventListener('click', () => void run(() => clockScreen(event.id, node.dataset.clock), node)));
  }
  function eventStandings(event) {
    draw('Tournament standings', `<ol class="competition-ranks">${event.standings.map(row => `<li><span class="competition-rank">${row.rank}</span><span><strong>${escape(row.name)}${row.id === event.me ? ' · You' : ''}</strong><small>${row.kind === 'guest' ? 'Guest · ' : ''}${row.gamesPlayed} ${row.gamesPlayed === 1 ? 'game' : 'games'}${row.status !== 'active' ? ' · ' + escape(statusLabel(row.status)) : ''}</small></span><b>${Number(row.points.toFixed(3))}<small>points</small></b></li>`).join('') || '<p>No entrants yet.</p>'}</ol><p class="competition-help">All played rounds count. Equal point totals share a placing. Late entrants start at zero; early leavers keep earned points.</p>`, () => eventScreen(event.id));
  }
  function eventTables(event) {
    draw('Tournament tables', event.rounds.map(round => `<h3>Round ${round.number} · ${escape(round.status)}</h3>${round.assignments.map(assignment => assignmentHtml(event, assignment)).join('')}`).join('') || '<p>No round prepared yet.</p>', () => eventScreen(event.id)); bindAssignments(event);
  }
  function eventMenu(event) {
    const round = event.rounds.at(-1);
    draw('Tournament host menu', `<div class="competition-actions">${button('eventInvite', 'Invite entrants')}${button('eventAddGuest', 'Add a guest')}${button('eventRules', 'View rules')}</div>
      <div class="competition-list">${event.members.filter(row => row.participating).map(row => `<section class="competition-member"><strong>${escape(row.name)}</strong><small>${row.kind === 'guest' ? 'Guest' : 'Signed in'} · ${escape(statusLabel(row.status) || 'Attending')}${row.role === 'admin' ? (row.id === event.creatorId ? ' · Host' : ' · Co-host') : ''}</small><div class="competition-actions">
      ${row.status === 'pending' ? `<button type="button" data-approve="${escape(row.id)}" class="secondary-action">Approve at zero points</button>` : ''}
      ${row.kind === 'guest' ? `<button type="button" data-access="${escape(row.id)}" class="secondary-action">Give guest access</button>` : event.creatorId === event.me && row.id !== event.creatorId && (row.status === 'active' || (row.status === 'left' && row.role === 'admin')) ? `<button type="button" data-cohost="${escape(row.id)}" data-enabled="${row.role !== 'admin'}" class="secondary-action">${row.role === 'admin' ? 'Remove co-host' : 'Make co-host'}</button>` : ''}
      ${row.status === 'active' ? `<button type="button" data-withdraw="${escape(row.id)}" class="text-action">Mark left early / no-show</button>` : ''}</div></section>`).join('')}</div>
      ${round?.status === 'playing' ? `<details><summary>Unplayed no-show Tables</summary><p>Cancel only a Table that never started. It receives no points.</p>${round.assignments.filter(row => !row.gameId && !row.cancelled).map((row, index) => `<button type="button" data-cancel-table="${escape(row.id)}" class="text-action">Cancel unplayed Table ${round.assignments.indexOf(row) + 1}</button>`).join('')}</details>` : ''}`, () => eventScreen(event.id));
    bind('#eventInvite', () => inviteScreen('tournament', event.id)); bind('#eventRules', () => { draw('Tournament rules', `<p>${escape(event.rules)}</p>`, () => eventMenu(event)); });
    content.querySelector('.competition-actions').insertAdjacentHTML('beforeend', button('eventInvites', 'Manage invites'));
    bind('#eventInvites', () => issuedInvitesScreen('tournament', event.id));
    bind('#eventAddGuest', () => {
      const requestId = crypto.randomUUID(); draw('Add a guest', `<form id="addEventGuest">${field('displayName', 'Guest name', 'required maxlength="80"')}<button type="submit" class="primary-action">Add guest</button></form>`, () => eventMenu(event));
      submit('#addEventGuest', async form => { await request(route('tournament', event.id, 'guests'), { scopeId: event.id, body: { displayName: form.get('displayName'), requestId } }); await eventScreen(event.id); });
    });
    const memberAction = (selector, action, extra = () => ({})) => content.querySelectorAll(selector).forEach(node => node.addEventListener('click', () => void run(async () => {
      await request(route('tournament', event.id, 'members'), { scopeId: event.id, body: { action, targetId: Object.values(node.dataset)[0], ...extra(node) } }); await eventScreen(event.id);
    }, node)));
    memberAction('[data-approve]', 'approve'); memberAction('[data-withdraw]', 'leave'); memberAction('[data-cohost]', 'cohost', node => ({ enabled: node.dataset.enabled === 'true' }));
    content.querySelectorAll('[data-access]').forEach(node => node.addEventListener('click', () => void run(async () => {
      const access = await request(route('tournament', event.id, 'guest-access'), { scopeId: event.id, body: { targetId: node.dataset.access } });
      const link = `${location.origin}/index.html#event=${encodeURIComponent(event.id)}&guest=${encodeURIComponent(access.guestToken)}`;
      draw('Guest access link', `<p>Give this only to this guest. It replaces their previous access link and lets them see this event and host their assigned Table. It grants no account awards or host controls.</p><label class="select-field">Private guest link<textarea id="guestAccessLink" readonly rows="4">${escape(link)}</textarea></label>${button('copyGuestAccess', 'Copy guest link')}`, () => eventMenu(event));
      bind('#copyGuestAccess', async () => { await navigator.clipboard.writeText(link); message('Guest link copied.'); });
    }, node)));
    content.querySelectorAll('[data-cancel-table]').forEach(node => node.addEventListener('click', () => void run(() => {
      const assignment = round.assignments.find(row => row.id === node.dataset.cancelTable);
      const number = round.assignments.indexOf(assignment) + 1;
      const names = assignment.participantIds.map(id => event.members.find(row => row.id === id)?.name || 'Player').join(', ');
      confirmScreen(`Cancel unplayed Table ${number}?`, `${names}. No game or points will be invented. A started Table must finish its real game.`, async () => {
        await request(route('tournament', event.id, 'cancel-table'), { scopeId: event.id, body: { assignmentId: assignment.id } }); await eventScreen(event.id);
      }, () => eventMenu(event));
    }, node)));
  }
  function seatingScreen(event) {
    const round = event.rounds.at(-1); const entrants = event.members.filter(row => row.participating && row.status === 'active');
    draw('Review seating', `<p>Each entrant plays once. Tables need 2–8 players. Choose exactly one host per Table. ${round.seatingStale ? 'Attendance or points changed; regenerate the suggestion first.' : ''}</p>
      ${button('regenerateSeats', 'Suggest seats again')}<form id="seatingForm">${entrants.map(row => {
        const current = round.assignments.findIndex(table => table.participantIds.includes(row.id));
        return `<fieldset class="competition-seat-choice"><legend>${escape(row.name)}</legend><label>Table<select name="${escape(row.id)}">${Array.from({ length: Math.min(64, Math.floor(entrants.length / 2)) }, (_, index) => `<option value="${index}" ${index === current ? 'selected' : ''}>${index + 1}</option>`).join('')}</select></label><label><input type="checkbox" name="host_${escape(row.id)}" ${round.assignments[current]?.hostId === row.id ? 'checked' : ''}> Hosts Table</label></fieldset>`;
      }).join('')}<button class="primary-action" type="submit">Save reviewed seating</button></form>`, () => eventScreen(event.id));
    bind('#regenerateSeats', async () => { await request(route('tournament', event.id, 'rounds/prepare'), { scopeId: event.id, body: { reseed: true, baseVersion: event.version } }); await eventScreen(event.id); });
    submit('#seatingForm', async form => {
      const groups = new Map();
      for (const entrant of entrants) { const key = form.get(entrant.id); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entrant.id); }
      const tables = [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([, group]) => {
        const hosts = group.filter(id => form.has(`host_${id}`)); if (hosts.length !== 1) throw new Error('Choose exactly one host for each Table.');
        return [hosts[0], ...group.filter(id => id !== hosts[0])];
      });
      await request(route('tournament', event.id, 'rounds/seating'), { scopeId: event.id, body: { roundId: round.id, baseVersion: event.version, tables } }); await eventScreen(event.id);
    });
  }
  async function clockScreen(id, assignmentId) {
    const event = await request(route('tournament', id), { scopeId: id });
    const round = event.rounds.find(row => row.assignments.some(table => table.id === assignmentId));
    const assignment = round.assignments.find(row => row.id === assignmentId); const clock = assignment.clock; const canManage = event.role === 'admin' || assignment.hostId === event.me;
    const remainingMs = Math.max(0, round.endsAt - event.serverNow); const requestId = crypto.randomUUID();
    draw('Round clock & final turns', `<p><output id="eventRoundCountdown">${remainingMs ? `${Math.ceil(remainingMs / 60_000)} minutes remaining.` : 'Round time has ended.'}</output></p>
      <p>${!clock ? 'Finish the active turn after time is called, then five additional turns total.' : clock.phase === 'current_turn' ? 'Finish the turn that was active when time was called.' : clock.phase === 'extra_turns' ? `${clock.remaining} additional turn${clock.remaining === 1 ? '' : 's'} remaining.` : 'All five additional turns have finished.'}</p>
      <p class="competition-help">Record every actual turn, including extra-turn effects. This counter is separate from normal turn tracking.</p>
      ${!canManage ? '<p>Your Table host records these turns and confirms the finish.</p>' : !clock ? button('callRoundTime', 'Call time for this Table', true) : clock.phase !== 'done' ? button('recordFinalTurn', clock.phase === 'current_turn' ? 'Current turn finished' : `Additional turn ${6 - clock.remaining} finished`, true) : button('recordTimedDraw', 'Confirm surviving players tied', true)}
      ${button('refreshRoundClock', 'Refresh clock')}`, () => eventScreen(id));
    const output = content.querySelector('#eventRoundCountdown'); const offset = event.serverNow - Date.now();
    const countdown = setInterval(() => {
      if (!dialog.open || !output.isConnected) { clearInterval(countdown); return; }
      const seconds = Math.max(0, Math.ceil((round.endsAt - Date.now() - offset) / 1000));
      output.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Round time has ended.';
    }, 1000);
    bind('#refreshRoundClock', () => clockScreen(id, assignmentId));
    const action = async action => { await request(route('tournament', id, `clock/${assignmentId}`), { scopeId: id, body: { action, requestId } }); await clockScreen(id, assignmentId); };
    bind('#callRoundTime', () => action('time_called')); bind('#recordFinalTurn', () => action('finish_turn'));
    bind('#recordTimedDraw', async () => {
      const current = session();
      if (current.code !== assignment.roomCode) throw new Error('Open the assigned Table on its host phone to confirm the surviving players.');
      await request('tables/timed-draw', { scopeId: id, connectionId: current.connectionId,
        body: { code: current.code, baseVersion: current.snapshot.version } });
      await request(route('tournament', id, 'reconcile'), { scopeId: id, body: {} });
      const ctx = await request(`tables/context?code=${encodeURIComponent(current.code)}`, { scopeId: id, connectionId: current.connectionId });
      await gameScreen('tournament', id, ctx.gameId, () => eventScreen(id));
    });
  }

  function setPending(value) { pending = value; writeLocal(pendingKey, value, sessionStorage); }
  async function launchTable(link) {
    const current = session();
    if (current.code && current.snapshot?.turn?.gameStarted) {
      draw('Your current Table is open', `<p>Finish or leave that Table before creating another one. Opening Pods and tournaments keeps your seat connected.</p>${button('returnCurrentTable', 'Return to current Table', true)}`, () => scopeScreen(link.kind, link.id));
      bind('#returnCurrentTable', () => { close(); adapter.returnToTable(); }); return;
    }
    if (current.code && current.snapshot && current.seatId === current.snapshot.hostSeatId) {
      const linked = await request(`tables/context?code=${encodeURIComponent(current.code)}`, {
        scopeId: roomScopes.get(current.code), connectionId: current.connectionId,
      });
      if (linked.linked) {
        const same = linked.canAccess && linked.kind === link.kind && linked.id === link.id
          && (!link.assignmentId || linked.assignmentId === link.assignmentId);
        if (same) { close(); adapter.returnToTable(); return; }
        draw('Your Table is already linked', `<p>Leave this Table before creating one for ${escape(link.name)}. Its existing group and results are kept.</p>${button('returnCurrentTable', 'Return to current Table', true)}`, () => scopeScreen(link.kind, link.id));
        bind('#returnCurrentTable', () => { close(); adapter.returnToTable(); }); return;
      }
      confirmScreen('Use your current Table?', `This Table will belong to ${link.name} for its successive games. Its completed results require host confirmation.`, async () => {
        setPending({ ...link, forRoomCode: current.code }); await syncSetup(true); close(); adapter.returnToTable();
      }, () => scopeScreen(link.kind, link.id)); return;
    }
    setPending({ ...link, forRoomCode: null }); close(); adapter.createTable(link);
  }
  async function syncSetup(force = false) {
    if (!enabled) return;
    if (syncing) { const previous = syncing; await previous; if (syncing === previous) syncing = null; return force ? syncSetup(true) : undefined; }
    const current = session(); if (!current.code || !current.connectionId) return;
    const key = setupObservationKey(current.snapshot, current.seatId, current.connectionId, authEpoch);
    const discovery = contextObservationKey(current.snapshot, current.seatId, current.connectionId, authEpoch);
    if (!discovery || (!key && !force)) return;
    if (!force && key === observation && contextAttempt === discovery) return syncing;
    observation = key; contextAttempt = discovery; const epoch = authEpoch;
    clearTimeout(retrySetup);
    const work = (async () => {
      const scopeId = pending?.forRoomCode === current.code ? pending.id : roomScopes.get(current.code);
      if (pending?.forRoomCode === current.code) {
        setupStatus.textContent = `Linking this Table to ${pending.name}…`; setupStatus.hidden = false;
        context = await request('tables/bind', { scopeId, connectionId: current.connectionId, body: { ...pending, code: current.code }, viewAware: false });
        rememberRoom(current.code, pending.id); setPending(null);
      } else context = await request(`tables/context?code=${encodeURIComponent(current.code)}`, { scopeId, connectionId: current.connectionId, viewAware: false });
      if (epoch !== authEpoch || session().code !== current.code) return;
      if (key && context.linked && context.canAccess && !context.seatLinked) context = await request('tables/claim', { scopeId: context.id, connectionId: current.connectionId, body: { code: current.code }, viewAware: false });
      if (context.canAccess) rememberRoom(current.code, context.id);
      contextButton.hidden = false; contextButton.textContent = context.linked ? context.canAccess ? `Return to ${context.kind === 'pod' ? 'Pod' : 'tournament'}` : 'About this private Table' : 'Pods & tournaments';
      intermissionButton.hidden = !context.linked || !context.canAccess;
      intermissionButton.textContent = context.kind === 'tournament' ? 'Review tournament result' : 'Review Pod result';
      lobbyButton.hidden = !context.linked || !context.canAccess;
      lobbyButton.textContent = context.kind === 'tournament' ? 'Open tournament' : 'Open Pod';
      setupStatus.textContent = context.linked ? context.canAccess ? `${context.name} · Your seat is linked. Results count after host confirmation.` : 'Private group Table. Guests can play normally.' : '';
      setupStatus.hidden = !key || !setupStatus.textContent;
      const parent = document.querySelector(current.snapshot.lifecycle.status === 'intermission' ? '#intermissionPanel' : '#lobbyControls');
      if (parent && setupStatus.parentElement !== parent) parent.prepend(setupStatus);
      // A host may finish linking just after a second phone joins. Retry only
      // while setup is open; never key a request to snapshot version or life.
      if (key && !context.linked) retrySetup = setTimeout(() => { if (setupObservationKey(session().snapshot, session().seatId, session().connectionId, authEpoch)) void syncSetup(true).catch(() => {}); }, 5000);
    })();
    syncing = work;
    try { await work; }
    catch (error) {
      if (error.code === 'TABLE_ALREADY_LINKED') setPending(null);
      setupStatus.hidden = !key; setupStatus.textContent = `Group link needs attention: ${error.message}`; throw error;
    }
    finally { if (syncing === work) syncing = null; }
  }
  async function tableScreen() {
    const current = session();
    if (!current.code) return home('pod');
    context = await request(`tables/context?code=${encodeURIComponent(current.code)}`, { scopeId: roomScopes.get(current.code), connectionId: current.connectionId });
    if (!context.linked) return home('pod');
    if (!context.canAccess) { draw('Private group Table', context.kind === 'tournament'
      ? '<p>You can play this Table normally. The event host can give you a guest access link to view your tournament.</p>'
      : '<p>You can play this Table normally as a guest. A private Pod invite is required to join its membership and ratings.</p>'); return; }
    const kind = context.kind, id = context.id;
    draw(context.name, `<p>Your Table is linked to this ${kind === 'pod' ? 'Pod' : 'tournament'}.</p><div class="competition-list">${(context.roster || []).map(row => `<p><strong>${escape(row.name)}</strong> · ${row.kind === 'guest' ? 'Guest' : 'Linked member'}</p>`).join('')}</div>
      <div class="competition-actions">${button('openTableScope', kind === 'pod' ? 'Open Pod' : 'Open tournament', true)}${current.snapshot.gameResult ? button('reviewTableFinish', 'Review finishing order') : ''}${button('refreshTableLink', 'Refresh linked seats')}</div>
      ${kind === 'tournament' && context.assignedGuests?.length && !current.snapshot.turn.gameStarted && current.seatId === current.snapshot.hostSeatId ? `<details><summary>Link an event guest’s seat</summary><p>Only guest entrants can be attested here. Signed-in entrants link their own seat.</p><form id="attestEventGuest"><label class="select-field">Guest<select name="participantId">${context.assignedGuests.map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join('')}</select></label><label class="select-field">Claimed Table seat<select name="seatId">${context.roster.filter(row => !row.participantId).map(row => `<option value="${row.seatId}">P${row.seatId + 1} · ${escape(row.name)}</option>`).join('')}</select></label><button class="secondary-action" type="submit">Attest guest seat</button></form></details>` : ''}`, () => home(kind));
    bind('#openTableScope', () => scopeScreen(kind, id)); bind('#refreshTableLink', async () => { await syncSetup(true); await tableScreen(); });
    bind('#reviewTableFinish', async () => {
      await request(route(kind, id, 'reconcile'), { scopeId: id, body: {} });
      const ctx = await request(`tables/context?code=${encodeURIComponent(current.code)}`, { scopeId: id, connectionId: current.connectionId });
      if (!ctx.gameId) throw new Error('Completion capture is still pending. Refresh and try again.');
      await gameScreen(kind, id, ctx.gameId, tableScreen);
    });
    submit('#attestEventGuest', async form => {
      if (form.get('seatId') === null) throw new Error('No unlinked claimed seat is available.');
      await request('tables/attest-guest', { scopeId: id, connectionId: current.connectionId,
        body: { code: current.code, participantId: form.get('participantId'), seatId: Number(form.get('seatId')) } });
      await tableScreen();
    });
  }

  backButton.addEventListener('click', () => { if (back) void run(back, backButton); }); closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', () => { navigationEpoch++; });
  dialog.addEventListener('close', () => adapter.onClose());
  document.querySelector('#myPodsButton').addEventListener('click', () => void run(() => home('pod')));
  document.querySelector('#tournamentsButton').addEventListener('click', () => void run(() => home('tournament')));
  contextButton.addEventListener('click', () => { adapter.closeTableMenu(); void run(tableScreen); });
  intermissionButton.addEventListener('click', () => void run(tableScreen));
  lobbyButton.addEventListener('click', () => void run(tableScreen));
  async function init() {
    const navigation = navigationEpoch;
    const fragment = parseCompetitionFragment(location.hash) || retryFragment;
    try {
      const config = await request('config', { noAccount: true, viewAware: false });
      enabled = config.enabled; podDeletionEnabled = config.podDeletionEnabled === true;
      document.querySelector('#myPodsButton').hidden = !enabled; document.querySelector('#tournamentsButton').hidden = !enabled;
      if (navigation !== navigationEpoch) return;
      if (!enabled) { if (fragment) draw('Invites unavailable', '<p>Pods and tournaments are not enabled on this server.</p>'); return; }
      retryFragment = fragment;
      if (fragment) history.replaceState(null, '', location.pathname + location.search);
      if (fragment?.invite) await invitePreview(fragment.invite);
      else if (fragment?.eventId) {
        const generation = beginEntry(fragment.eventId);
        const event = await request(route('tournament', fragment.eventId), { guestToken: fragment.guestToken, noAccount: true });
        if (generation !== entryGenerations.get(fragment.eventId)) return;
        rememberGuest({ ...event, guestToken: fragment.guestToken }); await eventScreen(event.id);
      }
      if (latestSnapshot) void syncSetup(true).catch(() => {});
      retryFragment = null;
    } catch (error) { if (fragment && navigation === navigationEpoch) { draw('Invite unavailable', `<p>${escape(error.message)}</p>${button('retryInvite', 'Try again')}`); bind('#retryInvite', init); } }
  }
  window.addEventListener('hashchange', () => {
    if (parseCompetitionFragment(location.hash)) void run(async () => {
      draw('Opening invite…', '<p>Checking this private link…</p>');
      await init();
    });
  });
  return {
    init, isOpen: () => dialog.open,
    observeTable(snapshot) {
      latestSnapshot = snapshot; if (!enabled) return;
      const current = session(), key = setupObservationKey(snapshot, current.seatId, current.connectionId, authEpoch);
      const discovery = contextObservationKey(snapshot, current.seatId, current.connectionId, authEpoch);
      if (discovery) contextButton.hidden = false;
      if (!syncing && key && key !== observation) void syncSetup().catch(() => {});
      else if (!syncing && discovery && discovery !== contextAttempt) void syncSetup(true).catch(() => {});
      if (!key) clearTimeout(retrySetup);
    },
    async tableCreated(code) { if (pending) { setPending({ ...pending, forRoomCode: code }); await syncSetup(true); } },
    async beforeStart() { if (pending && !pending.forRoomCode) setPending({ ...pending, forRoomCode: session().code }); await syncSetup(true); },
    clearPending() { setPending(null); },
    authChanged(signedIn, { restored = false } = {}) {
      if (!restored) authEpoch++;
      observation = null; contextAttempt = null; context = null; clearTimeout(retrySetup);
      const acceptingInvite = content.querySelector('#hubJoinForm button[type=submit]')?.disabled;
      if (restored && currentInvite && dialog.open && !acceptingInvite) {
        const invite = currentInvite, enteredName = content.querySelector('#hubJoinForm [name=displayName]')?.value || '';
        void run(() => invitePreview(invite, enteredName));
      } else if (!restored && signedIn && afterSignIn) { const resume = afterSignIn; afterSignIn = null; void run(resume); }
      else if (!restored && dialog.open) void run(() => home('pod'));
      if (latestSnapshot) void syncSetup(true).catch(() => {});
    },
  };
}
