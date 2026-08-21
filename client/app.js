import { RealtimeAdapter, apiBaseFromPage } from './realtime.js?v=11';

const MODES = ['life', 'poison', 'commander', 'energy', 'storm', 'generic'];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  views: $$('.view'), landing: $('#landingView'), create: $('#createView'), join: $('#joinView'), game: $('#gameView'),
  connectionButton: $('#connectionButton'), connectionText: $('#connectionText'), connectionDialog: $('#connectionDialog'), connectionDetail: $('#connectionDetail'),
  playerCountChoices: $('#playerCountChoices'), ownerSeat: $('#ownerSeat'), createName: $('#createName'), joinName: $('#joinName'), activeSeat: $('#activeSeat'), localSimulation: $('#localSimulation'),
  podStrip: $('#podStrip'), podLabel: $('#podLabel'), ownerLabel: $('#ownerLabel'), modeTitle: $('#modeTitle'), mainValue: $('#mainValue'),
  counterContext: $('#counterContext'), statusMessage: $('#statusMessage'), lethalMark: $('#lethalMark'), sourcePanel: $('#sourcePanel'),
  quickClearWrap: $('#quickClearWrap'), activeSeatBar: $('#activeSeatBar'), gameMenu: $('#gameMenu'), moreButton: $('#moreButton'),
  disconnectBanner: $('#disconnectBanner'), resetDialog: $('#resetDialog'), commanderSetupButton: $('#commanderSetupButton'), backToSetupButton: $('#backToSetupButton'),
  commanderCountDialog: $('#commanderCountDialog'), commanderCountDetail: $('#commanderCountDetail'), commanderCountForm: $('#commanderCountForm'), saveCommanderCountButton: $('#saveCommanderCountButton'),
  commanderTaxQuickButton: $('#commanderTaxQuickButton'), commanderTaxDialog: $('#commanderTaxDialog'), commanderTaxDetail: $('#commanderTaxDetail'), commanderTaxList: $('#commanderTaxList')
};
const transport = new RealtimeAdapter({ apiBase: apiBaseFromPage() });
let state = null;

function sourceForSeat(player, slot) {
  const multiple = player.commanderCount === 2;
  return { id: multiple ? `${player.id}-${slot}` : player.id, label: multiple ? `${player.id} ${slot}` : player.id, ownerPlayerId: player.id, slot };
}
function sourcesFromPlayers(players) { return players.flatMap(player => Array.from({ length: player.commanderCount }, (_, index) => sourceForSeat(player, String.fromCharCode(65 + index)))); }
function blankDamage(sources) { return Object.fromEntries(sources.map(source => [source.id, 0])); }
function playerTemplate(number, startingLife, commanderCount, sources) {
  return { id: `P${number}`, name: `P${number}`, commanderCount, life: startingLife, poison: 0, commanderDamage: blankDamage(sources), energy: 0, storm: 0, generic: 0, connectionStatus: 'connected', eliminated: false, lethalCause: null, warning: null };
}
function createState({ playerCount = 4, startingLife = 40, ownerPlayerId = 'P1', ownerName = ownerPlayerId, ownerCommanderCount = 1, localSimulation = true, podCode = 'LOCAL' } = {}) {
  const counts = Array.from({ length: playerCount }, (_, index) => `P${index + 1}` === ownerPlayerId ? ownerCommanderCount : 1);
  const commanderSources = sourcesFromPlayers(counts.map((commanderCount, index) => ({ id: `P${index + 1}`, commanderCount })));
  const players = counts.map((count, index) => playerTemplate(index + 1, startingLife, count, commanderSources));
  players.find(player => player.id === ownerPlayerId).name = ownerName || ownerPlayerId;
  return { playerCount, startingLife, ownerPlayerId, activePlayerId: ownerPlayerId, localSimulation, podCode, mode: 'life', selectedSourceId: null, commanderSources, commanderCastCounts: blankDamage(commanderSources), players };
}
function playerIdForSource(source, fallbackLabel = '') {
  if (source.ownerPlayerId) return source.ownerPlayerId;
  if (Number.isInteger(source.ownerSeatId)) return `P${source.ownerSeatId + 1}`;
  if (Number.isInteger(source.seatId)) return `P${source.seatId + 1}`;
  const match = String(source.label || fallbackLabel).match(/^(P\d+)/i);
  return match ? match[1].toUpperCase() : null;
}
function normaliseSnapshotSources(snapshot) {
  const raw = Array.isArray(snapshot.commanderSources) ? snapshot.commanderSources : null;
  if (raw?.length) return raw.map((source, index) => {
    const ownerPlayerId = playerIdForSource(source); const label = source.label || source.name || `${ownerPlayerId || 'Commander'} ${index + 1}`;
    return { id: String(source.id ?? source.commanderId ?? `source-${index}`), label, ownerPlayerId, slot: source.slot || (label.match(/\s([AB])$/)?.[1] || 'A') };
  });
  return sourcesFromPlayers(snapshot.seats.map(seat => ({ id: `P${seat.seatId + 1}`, commanderCount: seat.commanderCount === 2 ? 2 : 1 })));
}
function damageFromSnapshot(seat, sources) {
  const received = seat.commanderDamageReceived || {};
  return Object.fromEntries(sources.map((source, index) => [source.id, Number(Array.isArray(received) ? received[index] : (received[source.id] ?? received[index])) || 0]));
}
function castCountsFromSnapshot(snapshot, sources) {
  const received = Object.assign({}, snapshot.commanderCastCounts || {}, ...(snapshot.seats || []).map(seat => seat.commanderCastCounts || {}));
  return Object.fromEntries(sources.map(source => [source.id, Math.max(0, Number(received[source.id]) || 0)]));
}
function stateFromSnapshot(snapshot) {
  const commanderSources = normaliseSnapshotSources(snapshot); const previous = state;
  const ownerPlayerId = `P${transport.seatId + 1}`;
  const activePlayerId = previous?.localSimulation === false && previous.podCode === snapshot.code && snapshot.seats.some(seat => `P${seat.seatId + 1}` === previous.activePlayerId) ? previous.activePlayerId : ownerPlayerId;
  return {
    playerCount: snapshot.config.playerCount, startingLife: snapshot.config.startingLife, commanderSources, commanderCastCounts: castCountsFromSnapshot(snapshot, commanderSources), ownerPlayerId, activePlayerId,
    localSimulation: false, podCode: snapshot.code, version: snapshot.version, hostSeatId: snapshot.hostSeatId, mode: previous?.mode || 'life', selectedSourceId: previous?.selectedSourceId || null,
    players: snapshot.seats.map(seat => ({ id: `P${seat.seatId + 1}`, name: seat.name, commanderCount: seat.commanderCount === 2 ? 2 : 1, life: seat.counters.life, poison: seat.counters.poison, commanderDamage: damageFromSnapshot(seat, commanderSources), energy: seat.counters.energy, storm: seat.counters.storm, generic: seat.counters.generic, connectionStatus: seat.connected ? 'connected' : seat.claimed ? 'disconnected' : 'waiting', eliminated: false, lethalCause: null, warning: null }))
  };
}
function sourcesForDefender(playerId) { return state.commanderSources.filter(source => source.ownerPlayerId !== playerId); }
function ownCommanderSources(playerId) { return state.commanderSources.filter(source => source.ownerPlayerId === playerId); }
function displayName(player) { return String(player?.name || player?.id || 'Player').trim() || player.id; }
function displayPlayer(player) { const name = displayName(player); return name === player.id ? name : `${name} · ${player.id}`; }
function displaySource(source) { const owner = state?.players.find(player => player.id === source.ownerPlayerId); if (!owner) return source.label; return owner.commanderCount === 2 ? `${displayName(owner)} ${source.slot || 'A'}` : displayName(owner); }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]); }
function selectedSourceFor(player) { const sources = sourcesForDefender(player.id); if (!sources.some(source => source.id === state.selectedSourceId)) state.selectedSourceId = sources[0]?.id || null; return sources.find(source => source.id === state.selectedSourceId) || null; }
function commanderValue(player, sourceId = state.selectedSourceId) { return player.commanderDamage[sourceId] || 0; }
function evaluatePlayer(player) {
  const lethalSource = state.commanderSources.find(source => commanderValue(player, source.id) >= 21);
  const warningSource = state.commanderSources.find(source => { const value = commanderValue(player, source.id); return value >= 18 && value <= 20; });
  if (lethalSource) { player.eliminated = true; player.lethalCause = `${displaySource(lethalSource)} ${commanderValue(player, lethalSource.id)}`; }
  else if (player.poison >= 10) { player.eliminated = true; player.lethalCause = `POISON ${player.poison}`; }
  else if (player.life <= 0) { player.eliminated = true; player.lethalCause = `LIFE ${player.life}`; }
  else { player.eliminated = false; player.lethalCause = null; }
  player.warning = player.eliminated ? null : warningSource ? `${displaySource(warningSource)} NEAR LETHAL` : player.poison >= 8 ? 'HIGH POISON' : player.life <= 5 ? 'LOW LIFE' : null;
}
function showView(view) { dom.views.forEach(item => { item.hidden = item !== view; }); window.scrollTo({ top: 0, behavior: 'instant' }); }
function fillSetupControls() { dom.playerCountChoices.innerHTML = Array.from({ length: 7 }, (_, index) => { const value = index + 2; return `<label><input type="radio" name="playerCount" value="${value}" ${value === 4 ? 'checked' : ''}><span>${value}</span></label>`; }).join(''); syncOwnerChoices(4); }
function syncOwnerChoices(count) { const current = dom.ownerSeat.value || 'P1'; dom.ownerSeat.innerHTML = Array.from({ length: count }, (_, index) => `<option value="P${index + 1}">P${index + 1}</option>`).join(''); dom.ownerSeat.value = Number(current.slice(1)) <= count ? current : 'P1'; dom.createName.placeholder = dom.ownerSeat.value; }
function beginLocalGame(config) { transport.useLocal(); state = createState(config); showView(dom.game); render(); }
function showSharedGame(snapshot) { state = stateFromSnapshot(snapshot); showView(dom.game); render(); }
function showError(error) { dom.connectionDetail.textContent = error?.message || 'The pod server could not complete that request.'; dom.connectionDialog.showModal(); }
function activePlayer() { return state.players.find(player => player.id === state.activePlayerId); }
function currentValue(player) { return state.mode === 'commander' ? commanderValue(player) : player[state.mode]; }
function render() {
  if (!state.commanderCastCounts) state.commanderCastCounts = blankDamage(state.commanderSources);
  state.players.forEach(evaluatePlayer); const player = activePlayer(); const source = state.mode === 'commander' ? selectedSourceFor(player) : null;
  dom.podLabel.textContent = state.podCode === 'LOCAL' ? 'LOCAL POD' : `POD ${state.podCode}`; dom.ownerLabel.textContent = `YOU · ${displayPlayer(state.players.find(item => item.id === state.ownerPlayerId))}`; dom.modeTitle.textContent = state.mode.toUpperCase(); dom.mainValue.value = currentValue(player);
  dom.counterContext.textContent = state.mode === 'commander' ? (source ? `${displaySource(source)} · RECEIVED BY ${displayPlayer(player)}` : `NO OTHER COMMANDERS · ${displayPlayer(player)}`) : `${displayPlayer(player)}${player.id === state.ownerPlayerId ? ' · YOU' : state.localSimulation ? ' · SIMULATED' : ' · VIEW ONLY'}`;
  dom.lethalMark.hidden = !player.eliminated; const status = player.lethalCause || player.warning; dom.statusMessage.hidden = !status; dom.statusMessage.textContent = status || ''; dom.statusMessage.classList.toggle('lethal', Boolean(player.lethalCause));
  renderPodStrip(); renderSources(player); renderModeNav(); renderSeatPicker();
  renderCommanderTaxDialog();
  const playerCanMutate = state.localSimulation || player.id === state.ownerPlayerId;
  const mutationsEnabled = playerCanMutate && (transport.status === 'local' || transport.status === 'connected') && (state.mode !== 'commander' || Boolean(source)); $$('[data-delta]').forEach(button => { button.disabled = !mutationsEnabled; });
  dom.quickClearWrap.hidden = state.mode !== 'storm' || !playerCanMutate; dom.activeSeatBar.hidden = !state.localSimulation; $('#resetButton').hidden = !state.localSimulation && transport.seatId !== state.hostSeatId;
  const commanderOwner = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); const taxPlayer = activePlayer(); const inspectingSharedSeat = !state.localSimulation && taxPlayer.id !== state.ownerPlayerId;
  dom.commanderSetupButton.textContent = `${state.localSimulation ? `${displayName(commanderOwner)} commanders` : 'My commanders'}: ${commanderOwner.commanderCount}`;
  renderCommanderTaxQuick(taxPlayer, inspectingSharedSeat);
  if (dom.backToSetupButton) dom.backToSetupButton.hidden = !canReturnToSetup();
  saveLocal();
}
function renderPodStrip() {
  dom.podStrip.innerHTML = state.players.map(player => {
    const isWaiting = player.connectionStatus === 'waiting';
    const isOffline = player.connectionStatus === 'disconnected';
    // A claimed but offline seat retains server-authoritative counters. Show the
    // last synced life total, reserving ? only for a seat that has never joined.
    const value = isWaiting ? '?' : player.eliminated ? '☠' : player.life;
    const marker = isWaiting ? 'WAITING' : isOffline ? 'OFFLINE' : player.eliminated ? 'ELIMINATED' : player.warning ? 'WARNING' : 'CONNECTED';
    const name = displayName(player); const tileName = `${name}${player.id === state.ownerPlayerId ? ' · YOU' : ''}`;
    return `<button class="pod-seat ${player.id === state.activePlayerId ? 'active' : ''} ${player.eliminated ? 'eliminated' : ''} ${isOffline ? 'disconnected' : ''}" data-seat="${player.id}" type="button" aria-label="${escapeHtml(`${displayPlayer(player)}, ${marker}, ${value}`)}"><span class="seat-name" title="${escapeHtml(displayPlayer(player))}">${escapeHtml(tileName)}</span><span class="seat-life">${value}</span><span class="seat-state">${marker}</span></button>`;
  }).join('');
  $$('[data-seat]').forEach(button => button.addEventListener('click', () => { state.activePlayerId = button.dataset.seat; state.selectedSourceId = null; render(); }));
}
function renderSources(player) {
  dom.sourcePanel.hidden = state.mode !== 'commander'; if (dom.sourcePanel.hidden) return; const sources = sourcesForDefender(player.id); selectedSourceFor(player);
  dom.sourcePanel.innerHTML = sources.length ? sources.map(source => { const value = commanderValue(player, source.id); const severity = value >= 21 ? 'lethal' : value >= 18 ? 'near' : ''; return `<button class="source-button ${source.id === state.selectedSourceId ? 'selected' : ''} ${severity}" data-source="${source.id}" type="button" aria-pressed="${source.id === state.selectedSourceId}"><strong>${escapeHtml(displaySource(source))}</strong><span>${value}</span></button>`; }).join('') : '<p class="field-help">There are no opposing commanders to track for this seat.</p>';
  $$('[data-source]').forEach(button => button.addEventListener('click', () => { state.selectedSourceId = button.dataset.source; render(); }));
}
function renderModeNav() { $$('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); }); }
function renderSeatPicker() { dom.activeSeat.innerHTML = state.players.map(player => `<option value="${player.id}">${escapeHtml(displayPlayer(player))}${player.id === state.ownerPlayerId ? ' (you)' : ''}</option>`).join(''); dom.activeSeat.value = state.activePlayerId; }
function commanderTaxPlayer() { return activePlayer(); }
function commanderTaxEnabled() { return transport.status === 'local' || transport.status === 'connected'; }
function renderCommanderTaxQuick(player, inspectingSharedSeat) {
  if (!dom.commanderTaxQuickButton) return;
  const sources = ownCommanderSources(player.id); const isPartnerPair = sources.length === 2;
  const title = inspectingSharedSeat ? `View ${displayName(player)} tax` : `${displayName(player)} commander${isPartnerPair ? 's' : ''}`;
  const values = sources.map(source => {
    const tax = (state.commanderCastCounts[source.id] || 0) * 2;
    const label = isPartnerPair ? source.slot || 'A' : 'Tax';
    return `<span class="commander-tax-quick-value"><strong>${escapeHtml(label)}</strong><span>+${tax}</span></span>`;
  }).join('') || '<span class="commander-tax-quick-value"><strong>TAX</strong><span>+0</span></span>';
  const accessibleValues = sources.map(source => `${isPartnerPair ? `commander ${source.slot || 'A'}` : 'commander'} current tax +${(state.commanderCastCounts[source.id] || 0) * 2}`).join(', ') || 'current tax +0';
  dom.commanderTaxQuickButton.innerHTML = `<span class="commander-tax-quick-title">${escapeHtml(title)}</span><span class="commander-tax-quick-values">${values}</span>`;
  dom.commanderTaxQuickButton.setAttribute('aria-label', `${displayPlayer(player)} ${accessibleValues}${inspectingSharedSeat ? ', read only' : ''}. Open commander tax.`);
}
function canReturnToSetup() { return Boolean(state?.localSimulation || transport.seatId === state?.hostSeatId); }
function renderCommanderTaxDialog() {
  if (!state || !dom.commanderTaxDetail || !dom.commanderTaxList) return;
  const player = commanderTaxPlayer(); const canEdit = state.localSimulation || player.id === state.ownerPlayerId; const enabled = canEdit && commanderTaxEnabled(); const sources = ownCommanderSources(player.id);
  const playerLabel = displayPlayer(player);
  dom.commanderTaxDetail.textContent = state.localSimulation
    ? (player.id === state.ownerPlayerId ? `Your commanders (${playerLabel}) for the active simulated seat.` : `Inspecting ${playerLabel}'s commanders. Local simulation lets this phone update ${displayName(player)}'s counts.`)
    : canEdit ? `Your claimed seat (${playerLabel}) can change these counts. Changes sync live.` : `Viewing ${playerLabel}'s commanders. Cast counts and tax are read-only on your phone.`;
  dom.commanderTaxList.innerHTML = sources.map(source => {
    const count = state.commanderCastCounts[source.id] || 0; const nextTax = count * 2;
    const actions = canEdit ? `<button class="commander-tax-cast" data-commander-cast="${source.id}" type="button" ${enabled ? '' : 'disabled'}>Cast from command zone</button><button class="commander-tax-undo" data-commander-undo="${source.id}" type="button" ${enabled && count > 0 ? '' : 'disabled'}>Undo cast</button>` : '<p class="commander-tax-read-only">Read only</p>';
    const label = displaySource(source); return `<section class="commander-tax-row" aria-label="${escapeHtml(label)} commander tax"><div class="commander-tax-summary"><strong>${escapeHtml(label)}</strong><span>Cast count: ${count}</span></div><div class="commander-tax-next">Next tax +${nextTax}</div>${actions}</section>`;
  }).join('') || '<p class="field-help">No commanders are configured for this seat.</p>';
  $$('[data-commander-cast]').forEach(button => button.addEventListener('click', () => updateCommanderCastCount(button.dataset.commanderCast, 1)));
  $$('[data-commander-undo]').forEach(button => button.addEventListener('click', () => updateCommanderCastCount(button.dataset.commanderUndo, -1)));
}
async function adjust(delta) {
  if (!(transport.status === 'local' || transport.status === 'connected')) return; const player = activePlayer(); if (!state.localSimulation && player.id !== state.ownerPlayerId) return; const source = state.mode === 'commander' ? selectedSourceFor(player) : null; if (state.mode === 'commander' && !source) return;
  const target = state.mode === 'commander' ? 'commanderDamage' : state.mode; const next = state.mode === 'life' ? player.life + delta : Math.max(0, currentValue(player) + delta);
  if (transport.status === 'local') { if (state.mode === 'commander') player.commanderDamage[source.id] = next; else player[target] = next; render(); return; }
  $$('[data-delta]').forEach(button => { button.disabled = true; });
  try { const patch = state.mode === 'commander' ? { commanderDamageReceived: { [source.id]: next } } : { counters: { [target]: next } }; const result = await transport.mutate(patch); if (result.conflict) showError(new Error('The table changed first. The latest totals are shown; please make your change again.')); } catch (error) { renderConnection('disconnected'); showError(error); }
}
function remapLocalDamage(previousSources, nextSources) {
  const oldId = new Map(previousSources.map(source => [`${source.ownerPlayerId}:${source.slot || 'A'}`, source.id]));
  state.players.forEach(player => { const prior = player.commanderDamage; player.commanderDamage = Object.fromEntries(nextSources.map(source => [source.id, prior[oldId.get(`${source.ownerPlayerId}:${source.slot || 'A'}`)] || 0])); });
}
function remapLocalCastCounts(previousSources, nextSources) {
  const oldId = new Map(previousSources.map(source => [`${source.ownerPlayerId}:${source.slot || 'A'}`, source.id]));
  state.commanderCastCounts = Object.fromEntries(nextSources.map(source => [source.id, state.commanderCastCounts[oldId.get(`${source.ownerPlayerId}:${source.slot || 'A'}`)] || 0]));
}
async function updateCommanderCount(count) {
  const player = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); if (player.commanderCount === count) return;
  if (transport.status === 'local') { const previousSources = state.commanderSources; player.commanderCount = count; state.commanderSources = sourcesFromPlayers(state.players); remapLocalDamage(previousSources, state.commanderSources); remapLocalCastCounts(previousSources, state.commanderSources); state.selectedSourceId = null; render(); return; }
  try { dom.saveCommanderCountButton.disabled = true; const result = await transport.setCommanderCount(count); if (result.conflict) showError(new Error('The table changed first. The latest commander setup is shown.')); } catch (error) { showError(error); } finally { dom.saveCommanderCountButton.disabled = false; }
}
async function updateCommanderCastCount(sourceId, delta) {
  if (!commanderTaxEnabled()) return;
  const player = commanderTaxPlayer(); if (!state.localSimulation && player.id !== state.ownerPlayerId) return; if (!ownCommanderSources(player.id).some(source => source.id === sourceId)) return;
  const next = Math.max(0, (state.commanderCastCounts[sourceId] || 0) + delta);
  if (transport.status === 'local') { state.commanderCastCounts[sourceId] = next; render(); return; }
  $$('[data-commander-cast], [data-commander-undo]').forEach(button => { button.disabled = true; });
  try { const result = await transport.setCommanderCastCount(sourceId, next); if (result.conflict) showError(new Error('The table changed first. The latest cast counts are shown; please make your change again.')); }
  catch (error) { renderConnection('disconnected'); showError(error); }
}
async function resetGame() {
  if (transport.status === 'local') { const sources = state.commanderSources; state.players = state.players.map(player => ({ ...playerTemplate(Number(player.id.slice(1)), state.startingLife, player.commanderCount, sources), name: player.name, commanderCount: player.commanderCount })); state.commanderCastCounts = blankDamage(sources); state.selectedSourceId = null; render(); return; }
  try { const result = await transport.reset(); if (result.conflict) showError(new Error('The table changed first. The latest totals are shown; confirm reset again if it is still needed.')); } catch (error) { showError(error); }
}
function closeGameOverlays() { [dom.resetDialog, dom.connectionDialog, dom.commanderCountDialog, dom.commanderTaxDialog].forEach(dialog => { if (dialog?.open) dialog.close(); }); }
function returnToSetup() {
  if (!canReturnToSetup()) return;
  closeGameOverlays(); dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false'); showView(dom.create); state = null; transport.clearSession();
}
function renderConnection(status = transport.status) {
  const labels = { local: 'Local simulation', connected: 'Pod connected', waiting: 'Connecting…', disconnected: 'Disconnected' }; dom.connectionButton.dataset.state = status; dom.connectionText.textContent = labels[status] || status; dom.disconnectBanner.hidden = status !== 'disconnected';
  dom.connectionDetail.textContent = status === 'local' ? 'This game is running entirely on this phone. Nothing is uploaded.' : status === 'connected' ? `Connected to shared pod ${state?.podCode || ''}. This phone controls ${state?.ownerPlayerId || 'its assigned seat'}. API: ${transport.apiBase}` : `The shared pod is not connected. Counter changes are paused to prevent conflicting table state. API: ${transport.apiBase}`; if (state && !dom.game.hidden) render();
}
function saveLocal() { if (!state || !state.localSimulation) return; try { localStorage.setItem('fivefold-arc-test-state', JSON.stringify(state)); } catch { /* storage is optional */ } }
function loadLocal() { try { const saved = JSON.parse(localStorage.getItem('fivefold-arc-test-state')); if (saved?.commanderSources && saved?.players?.length && saved.playerCount === saved.players.length) return saved; } catch { /* ignore malformed state */ } return null; }

fillSetupControls(); renderConnection();
$('#createPodButton').addEventListener('click', () => showView(dom.create)); $('#joinPodButton').addEventListener('click', () => showView(dom.join)); $$('[data-back]').forEach(button => button.addEventListener('click', () => showView(dom.landing))); dom.playerCountChoices.addEventListener('change', event => syncOwnerChoices(Number(event.target.value))); dom.ownerSeat.addEventListener('change', () => { dom.createName.placeholder = dom.ownerSeat.value; }); $('#joinSeat').addEventListener('change', () => { dom.joinName.placeholder = $('#joinSeat').value; });
$('#quickTestButton').addEventListener('click', () => { const saved = loadLocal(); if (saved) { transport.useLocal(); state = saved; showView(dom.game); render(); } else beginLocalGame({}); });
$('#createForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const playerCount = Number(form.get('playerCount')); const ownerCommanderCount = Number(form.get('commanderCount')); const ownerPlayerId = dom.ownerSeat.value; const ownerName = String(form.get('name') || '').trim() || ownerPlayerId; const config = { playerCount, startingLife: Number(form.get('startingLife')), ownerPlayerId, ownerName, ownerCommanderCount }; if (dom.localSimulation.checked) return beginLocalGame({ ...config, localSimulation: true, podCode: 'LOCAL' }); try { const result = await transport.createRoom({ playerCount, startingLife: config.startingLife, commanderCount: ownerCommanderCount, name: ownerName }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#joinForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const code = $('#podCode').value.trim().toUpperCase(); const ownerPlayerId = $('#joinSeat').value; const seatId = Number(ownerPlayerId.slice(1)) - 1; const commanderCount = Number(form.get('joinCommanderCount')); const ownerName = String(form.get('name') || '').trim() || ownerPlayerId; try { const room = await transport.inspectRoom(code); if (!room.snapshot.seats[seatId]) throw new Error('That seat does not exist in this pod.'); const result = await transport.claimRoom({ code, seatId, name: ownerName, commanderCount }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#joinDemoButton').addEventListener('click', () => { const ownerPlayerId = $('#joinSeat').value; const ownerName = dom.joinName.value.trim() || ownerPlayerId; beginLocalGame({ ownerPlayerId, ownerName, ownerCommanderCount: Number(new FormData($('#joinForm')).get('joinCommanderCount')), localSimulation: true, podCode: 'DEMO' }); });
dom.activeSeat.addEventListener('change', () => { state.activePlayerId = dom.activeSeat.value; render(); }); $$('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; render(); })); $$('[data-delta]').forEach(button => button.addEventListener('click', () => adjust(Number(button.dataset.delta)))); $('#quickClearButton').addEventListener('click', () => adjust(-activePlayer().storm));
dom.moreButton.addEventListener('click', () => { dom.gameMenu.hidden = !dom.gameMenu.hidden; dom.moreButton.setAttribute('aria-expanded', String(!dom.gameMenu.hidden)); }); $('#resetButton').addEventListener('click', () => { dom.gameMenu.hidden = true; dom.resetDialog.showModal(); }); $('#confirmResetButton').addEventListener('click', resetGame);
dom.commanderSetupButton.addEventListener('click', () => { dom.gameMenu.hidden = true; const player = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); dom.commanderCountDetail.textContent = state.localSimulation ? `Local simulation: set ${player.id}'s commanders.` : `Only your claimed seat (${player.id}) will change.`; $(`input[name="gameCommanderCount"][value="${player.commanderCount}"]`).checked = true; dom.commanderCountDialog.showModal(); });
dom.commanderTaxQuickButton?.addEventListener('click', () => { renderCommanderTaxDialog(); dom.commanderTaxDialog.showModal(); });
dom.backToSetupButton?.addEventListener('click', returnToSetup);
dom.commanderCountForm.addEventListener('submit', event => { if (event.submitter?.value === 'confirm') updateCommanderCount(Number(new FormData(dom.commanderCountForm).get('gameCommanderCount'))); }); dom.connectionButton.addEventListener('click', () => dom.connectionDialog.showModal());
transport.addEventListener('status', event => renderConnection(event.detail)); transport.addEventListener('state', event => { if (event.detail?.seats?.length) { state = stateFromSnapshot(event.detail); if (dom.game.hidden) showView(dom.game); render(); } });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
