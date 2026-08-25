import { RealtimeAdapter, apiBaseFromPage } from './realtime.js?v=26';

const MODES = ['life', 'poison', 'commander', 'energy', 'storm', 'generic'];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  views: $$('.view'), landing: $('#landingView'), create: $('#createView'), join: $('#joinView'), game: $('#gameView'),
  connectionButton: $('#connectionButton'), connectionText: $('#connectionText'), connectionDialog: $('#connectionDialog'), connectionDetail: $('#connectionDetail'),
  playerCountChoices: $('#playerCountChoices'), ownerSeat: $('#ownerSeat'), createName: $('#createName'), joinName: $('#joinName'), activeSeat: $('#activeSeat'), localSimulation: $('#localSimulation'), roundLimitMinutes: $('#roundLimitMinutes'), createCommanderNames: $('#createCommanderNames'), joinCommanderNames: $('#joinCommanderNames'), gameCommanderNames: $('#gameCommanderNames'),
  podStrip: $('#podStrip'), podLabel: $('#podLabel'), ownerLabel: $('#ownerLabel'), modeTitle: $('#modeTitle'), mainValue: $('#mainValue'),
  counterContext: $('#counterContext'), statusMessage: $('#statusMessage'), lethalMark: $('#lethalMark'), lifeChangeIndicator: $('#lifeChangeIndicator'), sourcePanel: $('#sourcePanel'),
  quickClearWrap: $('#quickClearWrap'), activeSeatBar: $('#activeSeatBar'), gameMenu: $('#gameMenu'), moreButton: $('#moreButton'),
  disconnectBanner: $('#disconnectBanner'), coinTossNotice: $('#coinTossNotice'), victoryNotice: $('#victoryNotice'), coinTossButton: $('#coinTossButton'), deckAccentButton: $('#deckAccentButton'), coinTossDialog: $('#coinTossDialog'), coinTossResult: $('#coinTossResult'), tossAgainButton: $('#tossAgainButton'), resetDialog: $('#resetDialog'), commanderSetupButton: $('#commanderSetupButton'), backToSetupButton: $('#backToSetupButton'), declareWinnerButton: $('#declareWinnerButton'), declareWinnerDialog: $('#declareWinnerDialog'), declareWinnerForm: $('#declareWinnerForm'), winnerSeat: $('#winnerSeat'), victoryDialog: $('#victoryDialog'), victoryTitle: $('#victoryTitle'), victoryDetail: $('#victoryDetail'),
  lobbyControls: $('#lobbyControls'), lobbyStatus: $('#lobbyStatus'), startingSeatField: $('#startingSeatField'), startingSeat: $('#startingSeat'), chooseFirstButton: $('#chooseFirstButton'), randomFirstButton: $('#randomFirstButton'), startGameButton: $('#startGameButton'), startingRollDialog: $('#startingRollDialog'), startingRollStatus: $('#startingRollStatus'), startingRollDice: $('#startingRollDice'), turnBanner: $('#turnBanner'), turnLabel: $('#turnLabel'), turnPlayer: $('#turnPlayer'), turnElapsed: $('#turnElapsed'), gameTimer: $('#gameTimer'), turnActions: $('#turnActions'), endTurnButton: $('#endTurnButton'), undoTurnButton: $('#undoTurnButton'), turnActionDetail: $('#turnActionDetail'),
  commanderCountDialog: $('#commanderCountDialog'), commanderCountDetail: $('#commanderCountDetail'), commanderCountForm: $('#commanderCountForm'), saveCommanderCountButton: $('#saveCommanderCountButton'),
  commanderTaxQuickButton: $('#commanderTaxQuickButton'), commanderTaxDialog: $('#commanderTaxDialog'), commanderTaxDetail: $('#commanderTaxDetail'), commanderTaxList: $('#commanderTaxList'),
  customLifeButton: $('#customLifeButton'), customLifeDialog: $('#customLifeDialog'), customLifeForm: $('#customLifeForm'), customLifeAmount: $('#customLifeAmount')
};
const transport = new RealtimeAdapter({ apiBase: apiBaseFromPage() });
let state = null;
let lifeChange = null;
let lifeChangeTimer = null;
let coinTossNotice = null;
let coinTossTimer = null;
let coinFlipTimer = null;
let coinFlipSequence = 0;
let coinTossDialogRequested = false;
let startingRollTimer = null;
let startingRollSequence = 0;
let lastStartingRollKey = null;
let turnTicker = null;
let turnUndoTimer = null;
let lastTurnHandoffKey = null;
let shownVictoryKey = null;
let deckAccentsEnabled = localStorage.getItem('fivefold-arc-deck-accents') !== 'off';

function sourceForSeat(player, slot) {
  const multiple = player.commanderCount === 2;
  const index = slot === 'A' ? 0 : 1; const commanderCard = player.commanderCards?.[index] || null;
  const commanderName = commanderCard?.name || player.commanderNames?.[index] || '';
  return { id: multiple ? `${player.id}-${slot}` : player.id, label: commanderName || (multiple ? `${player.id} ${slot}` : player.id), ownerLabel: player.name || player.id, commanderName, colorIdentity: commanderCard?.colorIdentity || [], ownerPlayerId: player.id, slot };
}
function sourcesFromPlayers(players) { return players.flatMap(player => Array.from({ length: player.commanderCount }, (_, index) => sourceForSeat(player, String.fromCharCode(65 + index)))); }
function blankDamage(sources) { return Object.fromEntries(sources.map(source => [source.id, 0])); }
function playerTemplate(number, startingLife, commanderCount, sources, commanderNames = [], commanderCards = []) {
  return { id: `P${number}`, name: `P${number}`, commanderCount, commanderNames: Array.from({ length: commanderCount }, (_, slot) => commanderNames[slot] || ''), commanderCards: Array.from({ length: commanderCount }, (_, slot) => commanderCards[slot] || null), life: startingLife, poison: 0, energy: 0, storm: 0, generic: 0, connectionStatus: 'connected', eliminated: false, lethalCause: null, warning: null };
}
function createState({ playerCount = 4, startingLife = 40, ownerPlayerId = 'P1', ownerName = ownerPlayerId, ownerCommanderCount = 1, ownerCommanderNames = [], ownerCommanderCards = [], roundLimitMinutes = null, localSimulation = true, podCode = 'LOCAL' } = {}) {
  const counts = Array.from({ length: playerCount }, (_, index) => `P${index + 1}` === ownerPlayerId ? ownerCommanderCount : 1);
  const players = counts.map((count, index) => playerTemplate(index + 1, startingLife, count, [], `P${index + 1}` === ownerPlayerId ? ownerCommanderNames : [], `P${index + 1}` === ownerPlayerId ? ownerCommanderCards : []));
  players.find(player => player.id === ownerPlayerId).name = ownerName || ownerPlayerId;
  const commanderSources = sourcesFromPlayers(players);
  players.forEach(player => { player.commanderDamage = blankDamage(commanderSources); });
  const startedAt = Date.now();
  return { playerCount, startingLife, roundLimitMinutes, ownerPlayerId, activePlayerId: ownerPlayerId, turnSeatId: ownerPlayerId, turn: { activeSeatId: 0, gameStarted: false, gameStartedAt: null, turnStartedAt: null, roundEndsAt: null, startingPlayerSeatId: null, startingPlayerRoll: null, lastHandoff: null }, localSimulation, podCode, gameResult: null, mode: 'life', selectedSourceId: null, commanderSources, commanderCastCounts: blankDamage(commanderSources), players };
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
    return { id: String(source.id ?? source.commanderId ?? `source-${index}`), label, ownerLabel: source.ownerLabel || '', commanderName: source.commanderName || '', colorIdentity: source.colorIdentity || [], ownerPlayerId, slot: source.slot || (label.match(/\s([AB])$/)?.[1] || 'A') };
  });
  return sourcesFromPlayers(snapshot.seats.map(seat => ({ id: `P${seat.seatId + 1}`, name: seat.name, commanderCount: seat.commanderCount === 2 ? 2 : 1, commanderNames: seat.commanderNames || [], commanderCards: seat.commanderCards || [] })));
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
  const turn = snapshot.turn || { activeSeatId: 0, gameStarted: true, gameStartedAt: Date.now(), turnStartedAt: Date.now(), roundEndsAt: null, startingPlayerSeatId: 0, startingPlayerRoll: null, lastHandoff: null };
  return {
    playerCount: snapshot.config.playerCount, startingLife: snapshot.config.startingLife, roundLimitMinutes: snapshot.config.roundLimitMinutes || null, commanderSources, commanderCastCounts: castCountsFromSnapshot(snapshot, commanderSources), ownerPlayerId, activePlayerId, turnSeatId: `P${turn.activeSeatId + 1}`, turn,
    localSimulation: false, podCode: snapshot.code, version: snapshot.version, hostSeatId: snapshot.hostSeatId, lastCoinToss: snapshot.lastCoinToss || null, gameResult: snapshot.gameResult || null, mode: previous?.mode || 'life', selectedSourceId: previous?.selectedSourceId || null,
    players: snapshot.seats.map(seat => ({ id: `P${seat.seatId + 1}`, name: seat.name, commanderCount: seat.commanderCount === 2 ? 2 : 1, commanderNames: seat.commanderNames || [], commanderCards: seat.commanderCards || [], life: seat.counters.life, poison: seat.counters.poison, commanderDamage: damageFromSnapshot(seat, commanderSources), energy: seat.counters.energy, storm: seat.counters.storm, generic: seat.counters.generic, connectionStatus: seat.connected ? 'connected' : seat.claimed ? 'disconnected' : 'waiting', eliminated: false, lethalCause: null, warning: null }))
  };
}
function sourcesForDefender(playerId) { return state.commanderSources.filter(source => source.ownerPlayerId !== playerId); }
function ownCommanderSources(playerId) { return state.commanderSources.filter(source => source.ownerPlayerId === playerId); }
function displayName(player) { return String(player?.name || player?.id || 'Player').trim() || player.id; }
function displayPlayer(player) { const name = displayName(player); return name === player.id ? name : `${name} · ${player.id}`; }
function displaySource(source) { const owner = state?.players.find(player => player.id === source.ownerPlayerId); if (source.commanderName) return source.commanderName; if (!owner) return source.label; return owner.commanderCount === 2 ? `${displayName(owner)} ${source.slot || 'A'}` : displayName(owner); }
function sourceOwnerLabel(source) { const owner = state?.players.find(player => player.id === source.ownerPlayerId); return displayName(owner || { name: source.ownerLabel, id: source.ownerPlayerId || 'Player' }); }
const MANA_COLORS = { W: '#e7d7a5', U: '#4b9ed2', B: '#645878', R: '#d56057', G: '#58a76f' };
function deckColors(player) { return [...new Set((player?.commanderCards || []).flatMap(card => card?.colorIdentity || []))].map(color => MANA_COLORS[color]); }
function deckAccent(player) { const colors = deckColors(player); return colors.length ? `linear-gradient(135deg, ${colors.join(', ')})` : ''; }
function colorWash(hex, alpha) { const value = Number.parseInt(hex.slice(1), 16); return `rgb(${value >> 16} ${(value >> 8) & 255} ${value & 255} / ${alpha})`; }
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
function localLastPlayerStanding() {
  if (!state?.localSimulation || state.gameResult) return;
  const survivors = state.players.filter(player => !player.eliminated);
  if (state.players.length >= 2 && survivors.length === 1) state.gameResult = { winnerSeatId: Number(survivors[0].id.slice(1)) - 1, reason: 'last_player_standing', decidedAt: Date.now() };
}
function victoryKey(result) { return result ? `${result.winnerSeatId}:${result.reason}:${result.decidedAt}` : null; }
function winnerFromResult() { return state?.gameResult ? state.players.find(player => player.id === `P${state.gameResult.winnerSeatId + 1}`) : null; }
function renderVictory() {
  const result = state?.gameResult; const winner = winnerFromResult();
  dom.victoryNotice.hidden = !result || !winner;
  if (!result || !winner) return;
  const declared = result.reason === 'declared_winner';
  dom.victoryNotice.textContent = `${declared ? 'WINNER' : 'LAST PLAYER STANDING'} · ${displayName(winner)}`;
  const actingSeatId = state.localSimulation ? state.activePlayerId : state.ownerPlayerId;
  const key = victoryKey(result);
  if (winner.id === actingSeatId && key !== shownVictoryKey) {
    shownVictoryKey = key;
    dom.victoryTitle.textContent = declared ? 'Victory declared' : 'Victory';
    dom.victoryDetail.textContent = `${displayName(winner)}, ${declared ? 'the table declared you the winner.' : 'you are the last player standing.'}`;
    if (!dom.victoryDialog.open) dom.victoryDialog.showModal();
  }
}
function showView(view) { dom.views.forEach(item => { item.hidden = item !== view; }); window.scrollTo({ top: 0, behavior: 'instant' }); }
function fillSetupControls() { dom.playerCountChoices.innerHTML = Array.from({ length: 7 }, (_, index) => { const value = index + 2; return `<label><input type="radio" name="playerCount" value="${value}" ${value === 4 ? 'checked' : ''}><span>${value}</span></label>`; }).join(''); syncOwnerChoices(4); }
function commanderNamesFromForm(form, count) { return Array.from({ length: count }, (_, slot) => String(form.get(`commanderName${slot}`) || '').trim()); }
function commanderCardsFromFields(container, count) { return Array.from({ length: count }, (_, slot) => { const input = container.querySelector(`input[name="commanderName${slot}"]`); return input?.dataset.cardId ? { id: input.dataset.cardId, name: input.dataset.cardName, colorIdentity: (input.dataset.cardColors || '').split(',').filter(Boolean) } : null; }); }
function renderCommanderNameFields(container, count, names = [], cards = []) {
  if (!container) return;
  const current = [...container.querySelectorAll('input')].map(input => ({ value: input.value, id: input.dataset.cardId, name: input.dataset.cardName, colors: input.dataset.cardColors }));
  container.innerHTML = Array.from({ length: count }, (_, slot) => { const prior = current[slot]; const card = prior?.id ? { id: prior.id, name: prior.name, colorIdentity: (prior.colors || '').split(',').filter(Boolean) } : cards[slot]; const name = prior?.value ?? names[slot] ?? card?.name ?? ''; const identity = card?.colorIdentity?.join('') || ''; return `<label class="select-field">Commander ${count === 2 ? slot === 0 ? 'A' : 'B' : ''} name <small>(optional)</small><input name="commanderName${slot}" type="text" maxlength="100" autocomplete="off" placeholder="e.g. Atraxa, Praetors’ Voice" value="${escapeHtml(name)}" ${card ? `data-card-id="${escapeHtml(card.id)}" data-card-name="${escapeHtml(card.name)}" data-card-colors="${escapeHtml(card.colorIdentity.join(','))}"` : ''}><button class="commander-lookup" data-lookup-commander="${slot}" type="button">Find deck colors</button><small class="commander-lookup-status">${card ? `✓ ${identity || 'Colorless'} identity` : 'Optional: confirm a card to color the tile.'}</small></label>`; }).join('');
  container.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { delete input.dataset.cardId; delete input.dataset.cardName; delete input.dataset.cardColors; const status = input.parentElement.querySelector('.commander-lookup-status'); if (status) status.textContent = 'Optional: confirm a card to color the tile.'; }));
  container.querySelectorAll('[data-lookup-commander]').forEach(button => button.addEventListener('click', async () => {
    const input = button.parentElement.querySelector('input'); const status = button.parentElement.querySelector('.commander-lookup-status'); const name = input.value.trim(); if (!name) { input.focus(); return; }
    button.disabled = true; status.textContent = 'Looking up card…';
    try { const result = await transport.lookupCommander(name); const card = result.card; input.value = card.name; input.dataset.cardId = card.id; input.dataset.cardName = card.name; input.dataset.cardColors = card.colorIdentity.join(','); status.textContent = `✓ ${card.colorIdentity.join('') || 'Colorless'} identity`; }
    catch (error) { status.textContent = error.message || 'Card not found.'; } finally { button.disabled = false; }
  }));
}
function selectedCommanderCount(formName) { return Number($(`input[name="${formName}"]:checked`)?.value || 1); }
function refreshSetupCommanderNames() { renderCommanderNameFields(dom.createCommanderNames, selectedCommanderCount('commanderCount')); renderCommanderNameFields(dom.joinCommanderNames, selectedCommanderCount('joinCommanderCount')); }
function syncOwnerChoices(count) { const current = dom.ownerSeat.value || 'P1'; dom.ownerSeat.innerHTML = Array.from({ length: count }, (_, index) => `<option value="P${index + 1}">P${index + 1}</option>`).join(''); dom.ownerSeat.value = Number(current.slice(1)) <= count ? current : 'P1'; dom.createName.placeholder = dom.ownerSeat.value; }
function beginLocalGame(config) { transport.useLocal(); state = createState(config); showView(dom.game); render(); }
function showSharedGame(snapshot) { state = stateFromSnapshot(snapshot); showView(dom.game); render(); }
function showError(error) { dom.connectionDetail.textContent = error?.message || 'The pod server could not complete that request.'; dom.connectionDialog.showModal(); }
function activePlayer() { return state.players.find(player => player.id === state.activePlayerId); }
function currentValue(player) { return state.mode === 'commander' ? commanderValue(player) : player[state.mode]; }
function turnPlayer() { return state.players.find(player => player.id === state.turnSeatId); }
function formatDuration(milliseconds) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function renderTurnFlow() {
  if (!state?.turn) return;
  const turnPlayerValue = turnPlayer(); const now = Date.now(); const handoff = state.turn.lastHandoff;
  const claimedPlayers = state.players.filter(player => player.connectionStatus !== 'waiting');
  const isHost = state.localSimulation || transport.seatId === state.hostSeatId;
  const isStarted = Boolean(state.turn.gameStarted);
  dom.lobbyControls.hidden = isStarted;
  dom.turnBanner.hidden = !isStarted;
  dom.turnActions.hidden = !isStarted;
  if (!isStarted) {
    const selected = Number.isInteger(state.turn.startingPlayerSeatId) ? state.players.find(player => player.id === `P${state.turn.startingPlayerSeatId + 1}`) : null;
    dom.lobbyStatus.textContent = selected ? `${displayName(selected)} will go first. Start when the table is ready.` : `${claimedPlayers.length}/${state.playerCount} players joined. Choose who goes first when ready.`;
    dom.startingSeat.innerHTML = claimedPlayers.map(player => `<option value="${Number(player.id.slice(1)) - 1}">${escapeHtml(displayPlayer(player))}</option>`).join('');
    dom.startingSeat.value = String(state.turn.startingPlayerSeatId ?? state.turn.activeSeatId);
    dom.startingSeatField.hidden = !isHost;
    dom.chooseFirstButton.hidden = !isHost;
    dom.randomFirstButton.hidden = !isHost;
    dom.startGameButton.hidden = !isHost;
    dom.startingSeat.disabled = !isHost || claimedPlayers.length < 2;
    dom.chooseFirstButton.disabled = !isHost || claimedPlayers.length < 2;
    dom.randomFirstButton.disabled = !isHost || claimedPlayers.length < 2;
    dom.startGameButton.disabled = !isHost || claimedPlayers.length < 2;
    clearInterval(turnTicker); turnTicker = null;
    return;
  }
  dom.turnLabel.textContent = `${state.turnSeatId}'S TURN`;
  dom.turnPlayer.textContent = turnPlayerValue ? displayName(turnPlayerValue) : state.turnSeatId;
  dom.turnElapsed.textContent = `TURN ${formatDuration(now - state.turn.turnStartedAt)}`;
  dom.gameTimer.textContent = state.turn.roundEndsAt ? `ROUND ENDS IN ${formatDuration(state.turn.roundEndsAt - now)}` : `GAME TIME ${formatDuration(now - state.turn.gameStartedAt)}`;
  const actingSeatId = state.localSimulation ? state.activePlayerId : state.ownerPlayerId;
  const isOwnerActive = state.turnSeatId === actingSeatId;
  const canAct = (state.localSimulation || transport.status === 'connected') && isOwnerActive;
  dom.endTurnButton.disabled = !canAct;
  dom.endTurnButton.hidden = !isOwnerActive;
  dom.turnActionDetail.textContent = isOwnerActive ? 'You are active. Press once when you pass the turn.' : `${turnPlayerValue ? displayName(turnPlayerValue) : state.turnSeatId} controls this turn.`;
  const undoAvailable = handoff && Date.now() - handoff.handedOffAt <= 15_000 && actingSeatId === `P${handoff.fromSeatId + 1}`;
  dom.undoTurnButton.hidden = !undoAvailable;
  if (undoAvailable) dom.undoTurnButton.textContent = `Undo handoff · ${Math.max(0, Math.ceil((15_000 - (Date.now() - handoff.handedOffAt)) / 1000))}s`;
  clearInterval(turnTicker);
  turnTicker = setInterval(() => { if (state && !dom.game.hidden) renderTurnFlow(); }, 1000);
}
function render() {
  if (!state.commanderCastCounts) state.commanderCastCounts = blankDamage(state.commanderSources);
  state.players.forEach(evaluatePlayer); localLastPlayerStanding(); const player = activePlayer(); const source = state.mode === 'commander' ? selectedSourceFor(player) : null;
  dom.podLabel.textContent = state.podCode === 'LOCAL' ? 'LOCAL POD' : `POD ${state.podCode}`; dom.ownerLabel.textContent = `YOU · ${displayPlayer(state.players.find(item => item.id === state.ownerPlayerId))}`; dom.modeTitle.textContent = state.mode.toUpperCase(); dom.mainValue.value = currentValue(player);
  const ownPlayer = state.players.find(item => item.id === state.ownerPlayerId); const ownColors = deckColors(ownPlayer); const ownAccent = deckAccent(ownPlayer); dom.game.style.setProperty('--deck-accent', ownAccent || 'rgb(216 174 97 / .22)'); dom.game.style.setProperty('--deck-wash-a', ownColors[0] ? colorWash(ownColors[0], '.30') : 'transparent'); dom.game.style.setProperty('--deck-wash-b', ownColors[1] ? colorWash(ownColors[1], '.20') : ownColors[0] ? colorWash(ownColors[0], '.12') : 'transparent'); dom.game.classList.toggle('has-deck-accent', Boolean(ownAccent) && deckAccentsEnabled); dom.deckAccentButton.textContent = `Deck color theme: ${deckAccentsEnabled ? 'on' : 'off'}`;
  dom.counterContext.textContent = state.mode === 'commander' ? (source ? `${displayPlayer(player)} HAS RECEIVED DAMAGE FROM ${displaySource(source)}` : `NO OTHER COMMANDERS · ${displayPlayer(player)}`) : `${displayPlayer(player)}${player.id === state.ownerPlayerId ? ' · YOU' : state.localSimulation ? ' · SIMULATED' : ' · VIEW ONLY'}`;
  dom.lethalMark.hidden = !player.eliminated; const status = player.lethalCause || player.warning; dom.statusMessage.hidden = !status; dom.statusMessage.textContent = status || ''; dom.statusMessage.classList.toggle('lethal', Boolean(player.lethalCause));
  renderPodStrip(); renderSources(player); renderModeNav(); renderSeatPicker();
  renderTurnFlow();
  renderCoinTossNotice();
  renderVictory();
  renderCommanderTaxDialog();
  const playerCanMutate = state.localSimulation || player.id === state.ownerPlayerId;
  const mutationsEnabled = playerCanMutate && (transport.status === 'local' || transport.status === 'connected') && (state.mode !== 'commander' || Boolean(source)); $$('[data-delta]').forEach(button => { button.disabled = !mutationsEnabled; });
  dom.customLifeButton.hidden = state.mode !== 'life'; dom.customLifeButton.disabled = !playerCanMutate || !(transport.status === 'local' || transport.status === 'connected');
  renderLifeChange(player);
  dom.quickClearWrap.hidden = state.mode !== 'storm' || !playerCanMutate; dom.activeSeatBar.hidden = !state.localSimulation; $('#resetButton').hidden = !state.localSimulation && transport.seatId !== state.hostSeatId;
  const commanderOwner = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); const taxPlayer = activePlayer(); const inspectingSharedSeat = !state.localSimulation && taxPlayer.id !== state.ownerPlayerId;
  dom.commanderSetupButton.textContent = `${state.localSimulation ? `${displayName(commanderOwner)} commanders` : 'My commanders'}: ${commanderOwner.commanderCount}`;
  dom.coinTossButton.disabled = !(transport.status === 'local' || transport.status === 'connected');
  dom.declareWinnerButton.hidden = !state.localSimulation && transport.seatId !== state.hostSeatId;
  renderCommanderTaxQuick(taxPlayer, inspectingSharedSeat);
  if (dom.backToSetupButton) dom.backToSetupButton.hidden = !canReturnToSetup();
  saveLocal();
}
function renderLifeChange(player) {
  if (!dom.lifeChangeIndicator) return;
  const visible = lifeChange?.playerId === player?.id;
  dom.lifeChangeIndicator.hidden = !visible;
  if (!visible) return;
  const sign = lifeChange.delta > 0 ? '+' : '−';
  dom.lifeChangeIndicator.textContent = `LAST LIFE CHANGE ${sign}${Math.abs(lifeChange.delta)}`;
  dom.lifeChangeIndicator.classList.toggle('negative', lifeChange.delta < 0);
}
function showLifeChange(playerId, delta) {
  if (!delta) return;
  // Keep one rolling confirmation while a player is entering a burst of life
  // changes. The total resets only after four quiet seconds or a seat switch.
  const priorDelta = lifeChange?.playerId === playerId ? lifeChange.delta : 0;
  lifeChange = { playerId, delta: priorDelta + delta };
  clearTimeout(lifeChangeTimer);
  lifeChangeTimer = setTimeout(() => { lifeChange = null; if (state) render(); }, 4000);
  if (state) render();
}
function coinTossLabel(toss) {
  if (toss?.spinning) return 'FLIPPING…';
  const player = state?.players.find(item => item.id === `P${Number(toss?.tossedBySeatId) + 1}`);
  return `${String(toss?.result || '').toUpperCase()} · ${player ? displayName(player) : 'TABLE'} FLIPPED`;
}
function coinTossKey(toss) { return toss ? `${toss.tossedAt}:${toss.tossedBySeatId}:${toss.result}` : null; }
function startingPlayerRollKey(roll) {
  if (!roll) return null;
  return `${roll.selectedAt}:${roll.winnerSeatId}:${roll.rounds?.map(round => round.rolls.map(item => `${item.seatId}-${item.value}`).join(',')).join('/')}`;
}
function localD20() { return (crypto.getRandomValues(new Uint8Array(1))[0] % 20) + 1; }
function createLocalStartingPlayerRoll(players) {
  let contenders = [...players]; const rounds = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rolls = contenders.map(player => ({ seatId: Number(player.id.slice(1)) - 1, value: localD20() }));
    const high = Math.max(...rolls.map(roll => roll.value)); const tiedSeatIds = rolls.filter(roll => roll.value === high).map(roll => roll.seatId);
    rounds.push({ rolls, tiedSeatIds });
    if (tiedSeatIds.length === 1) return { rounds, winnerSeatId: tiedSeatIds[0], selectedAt: Date.now() };
    contenders = players.filter(player => tiedSeatIds.includes(Number(player.id.slice(1)) - 1));
  }
  throw new Error('Could not complete the d20 roll-off. Please roll again.');
}
function renderStartingRollDice(round, values = null) {
  if (!dom.startingRollDice) return;
  dom.startingRollDice.innerHTML = round.rolls.map(roll => {
    const player = state?.players.find(item => item.id === `P${roll.seatId + 1}`);
    const value = values?.[roll.seatId] ?? roll.value;
    return `<div class="starting-roll-die"><span>${escapeHtml(displayName(player || { id: `P${roll.seatId + 1}` }))}</span><strong>d20 · ${value}</strong></div>`;
  }).join('');
}
function showStartingPlayerRoll(roll, { dialog = true } = {}) {
  if (!roll?.rounds?.length) return;
  const sequence = ++startingRollSequence;
  clearTimeout(startingRollTimer);
  if (dialog && !dom.startingRollDialog.open) dom.startingRollDialog.showModal();
  let roundIndex = 0;
  const playRound = () => {
    if (sequence !== startingRollSequence) return;
    const round = roll.rounds[roundIndex]; let tick = 0;
    dom.startingRollStatus.textContent = roundIndex ? 'TIE — ROLLING AGAIN…' : 'ROLLING FOR FIRST…';
    const spin = () => {
      if (sequence !== startingRollSequence) return;
      if (tick >= 7) {
        renderStartingRollDice(round);
        if (round.tiedSeatIds.length > 1) { startingRollTimer = setTimeout(() => { roundIndex += 1; playRound(); }, 850); return; }
        const winner = state?.players.find(player => player.id === `P${roll.winnerSeatId + 1}`);
        const winningValue = round.rolls.find(item => item.seatId === roll.winnerSeatId)?.value;
        dom.startingRollStatus.textContent = `${displayName(winner || { id: `P${roll.winnerSeatId + 1}` })} ROLLS ${winningValue} — GOES FIRST`;
        render();
        return;
      }
      const values = Object.fromEntries(round.rolls.map(item => [item.seatId, ((tick * 7 + item.seatId * 5) % 20) + 1]));
      renderStartingRollDice(round, values); tick += 1;
      startingRollTimer = setTimeout(spin, [90, 110, 140, 180, 230, 290, 370][tick - 1]);
    };
    startingRollTimer = setTimeout(spin, 350);
  };
  playRound();
}
function renderCoinTossNotice() {
  if (!dom.coinTossNotice) return;
  dom.coinTossNotice.hidden = !coinTossNotice;
  if (coinTossNotice) dom.coinTossNotice.textContent = `COIN TOSS · ${coinTossLabel(coinTossNotice)}`;
}
function showCoinToss(toss, { dialog = false } = {}) {
  if (!toss?.result) return;
  const sequence = ++coinFlipSequence;
  clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer);
  coinTossNotice = { ...toss, spinning: true };
  if (dialog && !dom.coinTossDialog.open) dom.coinTossDialog.showModal();
  dom.tossAgainButton.disabled = true;
  if (dom.coinTossResult) { dom.coinTossResult.textContent = 'SPINNING…'; dom.coinTossResult.classList.add('spinning'); }
  if (state) render();
  const faces = ['HEADS', 'TAILS', 'HEADS', 'TAILS', 'HEADS', 'TAILS', 'HEADS'];
  const delays = [90, 110, 140, 180, 230, 290, 370];
  const advance = index => {
    if (sequence !== coinFlipSequence) return;
    if (index >= faces.length) {
      coinTossNotice = toss;
      if (dom.coinTossResult) { dom.coinTossResult.textContent = String(toss.result).toUpperCase(); dom.coinTossResult.classList.remove('spinning'); }
      dom.tossAgainButton.disabled = false;
      coinTossTimer = setTimeout(() => { coinTossNotice = null; if (state) render(); }, 6000);
      if (state) render();
      return;
    }
    if (dom.coinTossResult) dom.coinTossResult.textContent = faces[index];
    coinFlipTimer = setTimeout(() => advance(index + 1), delays[index]);
  };
  // Hold the explicit spinning state long enough to register before the faces
  // begin alternating, then let the pauses grow toward the final reveal.
  coinFlipTimer = setTimeout(() => advance(0), 400);
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
    const accent = deckAccentsEnabled ? deckAccent(player) : ''; return `<button class="pod-seat ${accent ? 'deck-colored' : ''} ${player.id === state.activePlayerId ? 'active' : ''} ${player.id === state.turnSeatId ? 'turn-active' : ''} ${player.eliminated ? 'eliminated' : ''} ${isOffline ? 'disconnected' : ''}" ${accent ? `style="--seat-accent:${accent}"` : ''} data-seat="${player.id}" type="button" aria-label="${escapeHtml(`${displayPlayer(player)}, ${marker}, ${value}`)}"><span class="seat-name" title="${escapeHtml(displayPlayer(player))}">${escapeHtml(tileName)}</span><span class="seat-life">${value}</span><span class="seat-state">${marker}</span></button>`;
  }).join('');
  $$('[data-seat]').forEach(button => button.addEventListener('click', () => { state.activePlayerId = button.dataset.seat; state.selectedSourceId = null; render(); }));
}
function renderSources(player) {
  dom.sourcePanel.hidden = state.mode !== 'commander'; if (dom.sourcePanel.hidden) return; const sources = sourcesForDefender(player.id); selectedSourceFor(player);
  dom.sourcePanel.innerHTML = sources.length ? sources.map(source => { const value = commanderValue(player, source.id); const severity = value >= 21 ? 'lethal' : value >= 18 ? 'near' : ''; const owner = source.commanderName ? `<strong>${escapeHtml(sourceOwnerLabel(source))}</strong><small>${escapeHtml(source.commanderName)}</small>` : `<strong>${escapeHtml(displaySource(source))}</strong>`; return `<button class="source-button ${source.id === state.selectedSourceId ? 'selected' : ''} ${severity}" data-source="${source.id}" type="button" aria-pressed="${source.id === state.selectedSourceId}">${owner}<span>${value}</span></button>`; }).join('') : '<p class="field-help">There are no opposing commanders to track for this seat.</p>';
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
    const label = displaySource(source); const heading = source.commanderName ? `<div><strong>${escapeHtml(sourceOwnerLabel(source))}</strong><p class="commander-tax-card-name">${escapeHtml(source.commanderName)}</p></div>` : `<strong>${escapeHtml(label)}</strong>`; return `<section class="commander-tax-row" aria-label="${escapeHtml(label)} commander tax"><div class="commander-tax-summary">${heading}<span>Cast count: ${count}</span></div><div class="commander-tax-next">Next tax +${nextTax}</div>${actions}</section>`;
  }).join('') || '<p class="field-help">No commanders are configured for this seat.</p>';
  $$('[data-commander-cast]').forEach(button => button.addEventListener('click', () => updateCommanderCastCount(button.dataset.commanderCast, 1)));
  $$('[data-commander-undo]').forEach(button => button.addEventListener('click', () => updateCommanderCastCount(button.dataset.commanderUndo, -1)));
}
async function adjust(delta) {
  if (!(transport.status === 'local' || transport.status === 'connected')) return; const player = activePlayer(); if (!state.localSimulation && player.id !== state.ownerPlayerId) return; const source = state.mode === 'commander' ? selectedSourceFor(player) : null; if (state.mode === 'commander' && !source) return;
  const target = state.mode === 'commander' ? 'commanderDamage' : state.mode;
  const previous = currentValue(player);
  const next = state.mode === 'life' ? player.life + delta : Math.max(0, previous + delta);
  // Commander damage is real combat damage: record it against the selected
  // source and apply the exact inverse change to the defender's life total.
  const commanderDelta = state.mode === 'commander' ? next - previous : 0;
  const lifeDelta = state.mode === 'commander' ? -commanderDelta : state.mode === 'life' ? delta : 0;
  if (state.mode === 'commander' && commanderDelta === 0) return;
  if (transport.status === 'local') {
    if (state.mode === 'commander') { player.commanderDamage[source.id] = next; player.life += lifeDelta; }
    else player[target] = next;
    if (lifeDelta) showLifeChange(player.id, lifeDelta);
    render(); return;
  }
  $$('[data-delta]').forEach(button => { button.disabled = true; });
  try {
    const result = await transport.adjust({ counter: target, delta, ...(state.mode === 'commander' ? { commanderSourceId: source.id } : {}) });
    if (lifeDelta && !result.blocked && !result.ignored) showLifeChange(player.id, lifeDelta);
  } catch (error) { renderConnection('disconnected'); showError(error); }
}
function remapLocalDamage(previousSources, nextSources) {
  const oldId = new Map(previousSources.map(source => [`${source.ownerPlayerId}:${source.slot || 'A'}`, source.id]));
  state.players.forEach(player => { const prior = player.commanderDamage; player.commanderDamage = Object.fromEntries(nextSources.map(source => [source.id, prior[oldId.get(`${source.ownerPlayerId}:${source.slot || 'A'}`)] || 0])); });
}
function remapLocalCastCounts(previousSources, nextSources) {
  const oldId = new Map(previousSources.map(source => [`${source.ownerPlayerId}:${source.slot || 'A'}`, source.id]));
  state.commanderCastCounts = Object.fromEntries(nextSources.map(source => [source.id, state.commanderCastCounts[oldId.get(`${source.ownerPlayerId}:${source.slot || 'A'}`)] || 0]));
}
async function updateCommanderSetup(count, names, cards) {
  const player = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId);
  if (transport.status === 'local') { const previousSources = state.commanderSources; player.commanderCount = count; player.commanderNames = names; player.commanderCards = cards; state.commanderSources = sourcesFromPlayers(state.players); remapLocalDamage(previousSources, state.commanderSources); remapLocalCastCounts(previousSources, state.commanderSources); state.selectedSourceId = null; render(); return; }
  try { dom.saveCommanderCountButton.disabled = true; const result = await transport.setCommanderSetup(count, names, cards); if (result.conflict) showError(new Error('The table changed first. The latest commander setup is shown.')); } catch (error) { showError(error); } finally { dom.saveCommanderCountButton.disabled = false; }
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
  if (transport.status === 'local') { const sources = state.commanderSources; state.players = state.players.map(player => ({ ...playerTemplate(Number(player.id.slice(1)), state.startingLife, player.commanderCount, sources, player.commanderNames, player.commanderCards), name: player.name, commanderCount: player.commanderCount, commanderNames: player.commanderNames, commanderCards: player.commanderCards })); state.commanderCastCounts = blankDamage(sources); state.lastCoinToss = null; state.gameResult = null; state.turn = { activeSeatId: 0, gameStarted: false, gameStartedAt: null, turnStartedAt: null, roundEndsAt: null, startingPlayerSeatId: null, startingPlayerRoll: null, lastHandoff: null }; state.turnSeatId = 'P1'; coinTossNotice = null; clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer); clearTimeout(startingRollTimer); state.selectedSourceId = null; render(); return; }
  try { const result = await transport.reset(); if (result.conflict) showError(new Error('The table changed first. The latest totals are shown; confirm reset again if it is still needed.')); else { coinTossNotice = null; clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer); render(); } } catch (error) { showError(error); }
}
async function handoffTurn() {
  const actingSeatId = state?.localSimulation ? state.activePlayerId : state?.ownerPlayerId;
  if (!state || !state.turn.gameStarted || state.turnSeatId !== actingSeatId || !(transport.status === 'local' || transport.status === 'connected')) return;
  if (transport.status === 'local') {
    const fromSeatId = Number(state.turnSeatId.slice(1)) - 1; const toSeatId = (fromSeatId + 1) % state.playerCount; const handedOffAt = Date.now();
    state.turn = { ...state.turn, activeSeatId: toSeatId, turnStartedAt: handedOffAt, lastHandoff: { fromSeatId, toSeatId, handedOffAt } }; state.turnSeatId = `P${toSeatId + 1}`; state.activePlayerId = state.turnSeatId; showTurnHandoff(); render(); return;
  }
  dom.endTurnButton.disabled = true;
  try { const result = await transport.handoffTurn(); if (result.conflict) showError(new Error('The table changed first. The latest turn is shown.')); }
  catch (error) { showError(error); } finally { if (state) render(); }
}
async function chooseStartingPlayer(startingSeatId = undefined) {
  if (!state || state.turn.gameStarted) return;
  if (state.localSimulation) {
    const roll = startingSeatId === undefined ? createLocalStartingPlayerRoll(state.players) : null;
    const seatId = roll ? roll.winnerSeatId : startingSeatId;
    state.turn = { ...state.turn, activeSeatId: seatId, startingPlayerSeatId: seatId, startingPlayerRoll: roll }; state.turnSeatId = `P${seatId + 1}`;
    if (roll) { lastStartingRollKey = startingPlayerRollKey(roll); showStartingPlayerRoll(roll); } else render(); return;
  }
  try { const result = await transport.chooseStartingPlayer(startingSeatId); if (result.conflict) showError(new Error('The table changed first. The latest lobby is shown.')); } catch (error) { showError(error); }
}
async function startGame() {
  if (!state || state.turn.gameStarted) return;
  if (state.localSimulation) {
    const startedAt = Date.now(); const startingPlayerSeatId = state.turn.startingPlayerSeatId ?? state.turn.activeSeatId;
    state.turn = { ...state.turn, gameStarted: true, activeSeatId: startingPlayerSeatId, startingPlayerSeatId, gameStartedAt: startedAt, turnStartedAt: startedAt, roundEndsAt: state.roundLimitMinutes ? startedAt + state.roundLimitMinutes * 60000 : null, lastHandoff: null }; state.turnSeatId = `P${startingPlayerSeatId + 1}`; state.activePlayerId = state.turnSeatId; render(); return;
  }
  try { const result = await transport.startGame(); if (result.conflict) showError(new Error('The table changed first. The latest lobby is shown.')); } catch (error) { showError(error); }
}
async function undoTurnHandoff() {
  const handoff = state?.turn?.lastHandoff; const actingSeatId = state?.localSimulation ? state.activePlayerId : state?.ownerPlayerId; if (!handoff || actingSeatId !== `P${handoff.fromSeatId + 1}`) return;
  if (transport.status === 'local') { state.turn = { ...state.turn, activeSeatId: handoff.fromSeatId, turnStartedAt: handoff.handedOffAt, lastHandoff: null }; state.turnSeatId = `P${handoff.fromSeatId + 1}`; state.activePlayerId = state.turnSeatId; render(); return; }
  try { const result = await transport.undoTurnHandoff(); if (result.conflict) showError(new Error('The handoff undo window has closed. The latest turn is shown.')); }
  catch (error) { showError(error); }
}
function openDeclareWinner() {
  if (!state || (!state.localSimulation && transport.seatId !== state.hostSeatId)) return;
  dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false');
  dom.winnerSeat.innerHTML = state.players.filter(player => player.connectionStatus !== 'waiting').map(player => `<option value="${Number(player.id.slice(1)) - 1}">${escapeHtml(displayPlayer(player))}</option>`).join('');
  dom.declareWinnerDialog.showModal();
}
async function declareWinner() {
  const winnerSeatId = Number(new FormData(dom.declareWinnerForm).get('winnerSeat'));
  if (!Number.isInteger(winnerSeatId) || !state.players[winnerSeatId]) return;
  if (state.localSimulation) { state.gameResult = { winnerSeatId, reason: 'declared_winner', decidedAt: Date.now() }; render(); return; }
  try { const result = await transport.declareWinner(winnerSeatId); if (result.conflict) showError(new Error('The table changed first. The latest game state is shown.')); }
  catch (error) { showError(error); }
}
function showTurnHandoff() {
  dom.turnBanner.classList.remove('handoff'); void dom.turnBanner.offsetWidth; dom.turnBanner.classList.add('handoff');
}
async function tossCoin({ dialog = true } = {}) {
  if (!(transport.status === 'local' || transport.status === 'connected')) return;
  let toss;
  if (transport.status === 'local') {
    const result = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'tails' : 'heads';
    toss = { result, tossedBySeatId: Number(activePlayer().id.slice(1)) - 1, tossedAt: Date.now() };
    state.lastCoinToss = toss;
    showCoinToss(toss, { dialog });
  } else {
    try {
      const previousKey = coinTossKey(state?.lastCoinToss);
      coinTossDialogRequested = dialog;
      const response = await transport.tossCoin();
      if (response.blocked || response.ignored) return;
      toss = response.snapshot.lastCoinToss;
      // The synchronous snapshot event normally starts the animation. This
      // fallback covers transports that return before the event arrives.
      if (coinTossKey(state?.lastCoinToss) === previousKey) showCoinToss(toss, { dialog });
    } catch (error) { renderConnection('disconnected'); showError(error); return; }
  }
}
function closeGameOverlays() { [dom.resetDialog, dom.connectionDialog, dom.coinTossDialog, dom.startingRollDialog, dom.customLifeDialog, dom.commanderCountDialog, dom.commanderTaxDialog, dom.victoryDialog, dom.declareWinnerDialog].forEach(dialog => { if (dialog?.open) dialog.close(); }); }
function returnToSetup() {
  if (!canReturnToSetup()) return;
  closeGameOverlays(); clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer); clearTimeout(startingRollTimer); clearInterval(turnTicker); dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false'); showView(dom.create); state = null; transport.clearSession();
}
function renderConnection(status = transport.status) {
  const labels = { local: 'Local simulation', connected: 'Pod connected', waiting: 'Connecting…', disconnected: 'Disconnected' }; dom.connectionButton.dataset.state = status; dom.connectionText.textContent = labels[status] || status; dom.disconnectBanner.hidden = status !== 'disconnected';
  dom.connectionDetail.textContent = status === 'local' ? 'This game is running entirely on this phone. Nothing is uploaded.' : status === 'connected' ? `Connected to shared pod ${state?.podCode || ''}. This phone controls ${state?.ownerPlayerId || 'its assigned seat'}. API: ${transport.apiBase}` : `The shared pod is not connected. Counter changes are paused to prevent conflicting table state. API: ${transport.apiBase}`; if (state && !dom.game.hidden) render();
}
function saveLocal() { if (!state || !state.localSimulation) return; try { localStorage.setItem('fivefold-arc-test-state', JSON.stringify(state)); } catch { /* storage is optional */ } }
function loadLocal() { try { const saved = JSON.parse(localStorage.getItem('fivefold-arc-test-state')); if (saved?.commanderSources && saved?.players?.length && saved.playerCount === saved.players.length) return saved; } catch { /* ignore malformed state */ } return null; }

fillSetupControls(); refreshSetupCommanderNames(); renderConnection();
$('#createPodButton').addEventListener('click', () => showView(dom.create)); $('#joinPodButton').addEventListener('click', () => showView(dom.join)); $$('[data-back]').forEach(button => button.addEventListener('click', () => showView(dom.landing))); dom.playerCountChoices.addEventListener('change', event => syncOwnerChoices(Number(event.target.value))); dom.ownerSeat.addEventListener('change', () => { dom.createName.placeholder = dom.ownerSeat.value; }); $('#joinSeat').addEventListener('change', () => { dom.joinName.placeholder = $('#joinSeat').value; }); $$('input[name="commanderCount"], input[name="joinCommanderCount"]').forEach(input => input.addEventListener('change', refreshSetupCommanderNames));
$('#quickTestButton').addEventListener('click', () => { const saved = loadLocal(); if (saved) { transport.useLocal(); state = saved; showView(dom.game); render(); } else beginLocalGame({}); });
$('#createForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const playerCount = Number(form.get('playerCount')); const ownerCommanderCount = Number(form.get('commanderCount')); const ownerCommanderNames = commanderNamesFromForm(form, ownerCommanderCount); const ownerCommanderCards = commanderCardsFromFields(dom.createCommanderNames, ownerCommanderCount); const ownerPlayerId = dom.ownerSeat.value; const ownerName = String(form.get('name') || '').trim() || ownerPlayerId; const enteredRoundLimit = String(form.get('roundLimitMinutes') || '').trim(); const roundLimitMinutes = enteredRoundLimit ? Number(enteredRoundLimit) : null; if (roundLimitMinutes !== null && (!Number.isInteger(roundLimitMinutes) || roundLimitMinutes < 1 || roundLimitMinutes > 999)) { dom.roundLimitMinutes.focus(); return; } const config = { playerCount, startingLife: Number(form.get('startingLife')), ownerPlayerId, ownerName, ownerCommanderCount, ownerCommanderNames, ownerCommanderCards, roundLimitMinutes }; if (dom.localSimulation.checked) return beginLocalGame({ ...config, localSimulation: true, podCode: 'LOCAL' }); try { const result = await transport.createRoom({ playerCount, startingLife: config.startingLife, commanderCount: ownerCommanderCount, commanderNames: ownerCommanderNames, commanderCards: ownerCommanderCards, name: ownerName, roundLimitMinutes }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#joinForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const code = $('#podCode').value.trim().toUpperCase(); const ownerPlayerId = $('#joinSeat').value; const seatId = Number(ownerPlayerId.slice(1)) - 1; const commanderCount = Number(form.get('joinCommanderCount')); const commanderNames = commanderNamesFromForm(form, commanderCount); const commanderCards = commanderCardsFromFields(dom.joinCommanderNames, commanderCount); const ownerName = String(form.get('name') || '').trim() || ownerPlayerId; try { const room = await transport.inspectRoom(code); if (!room.snapshot.seats[seatId]) throw new Error('That seat does not exist in this pod.'); const result = await transport.claimRoom({ code, seatId, name: ownerName, commanderCount, commanderNames, commanderCards }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#joinDemoButton').addEventListener('click', () => { const ownerPlayerId = $('#joinSeat').value; const ownerName = dom.joinName.value.trim() || ownerPlayerId; beginLocalGame({ ownerPlayerId, ownerName, ownerCommanderCount: Number(new FormData($('#joinForm')).get('joinCommanderCount')), localSimulation: true, podCode: 'DEMO' }); });
dom.activeSeat.addEventListener('change', () => { state.activePlayerId = dom.activeSeat.value; render(); }); $$('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; render(); })); $$('[data-delta]').forEach(button => button.addEventListener('click', () => adjust(Number(button.dataset.delta)))); $('#quickClearButton').addEventListener('click', () => adjust(-activePlayer().storm));
dom.customLifeButton.addEventListener('click', () => { dom.customLifeAmount.value = ''; dom.customLifeDialog.showModal(); dom.customLifeAmount.focus(); });
dom.customLifeForm.addEventListener('submit', event => { if (event.submitter?.value !== 'confirm') return; const form = new FormData(dom.customLifeForm); const amount = Number(form.get('amount')); if (!Number.isInteger(amount) || amount < 1 || amount > 999) { event.preventDefault(); dom.customLifeAmount.focus(); return; } const delta = form.get('direction') === 'subtract' ? -amount : amount; adjust(delta); });
dom.endTurnButton.addEventListener('click', handoffTurn); dom.undoTurnButton.addEventListener('click', undoTurnHandoff);
dom.chooseFirstButton.addEventListener('click', () => chooseStartingPlayer(Number(dom.startingSeat.value))); dom.randomFirstButton.addEventListener('click', () => chooseStartingPlayer()); dom.startGameButton.addEventListener('click', startGame);
dom.moreButton.addEventListener('click', () => { dom.gameMenu.hidden = !dom.gameMenu.hidden; dom.moreButton.setAttribute('aria-expanded', String(!dom.gameMenu.hidden)); }); dom.coinTossButton.addEventListener('click', () => { dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false'); tossCoin(); }); dom.deckAccentButton.addEventListener('click', () => { deckAccentsEnabled = !deckAccentsEnabled; localStorage.setItem('fivefold-arc-deck-accents', deckAccentsEnabled ? 'on' : 'off'); render(); }); dom.declareWinnerButton.addEventListener('click', openDeclareWinner); dom.tossAgainButton.addEventListener('click', () => tossCoin()); $('#resetButton').addEventListener('click', () => { dom.gameMenu.hidden = true; dom.resetDialog.showModal(); }); $('#confirmResetButton').addEventListener('click', resetGame);
dom.commanderSetupButton.addEventListener('click', () => { dom.gameMenu.hidden = true; const player = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); dom.commanderCountDetail.textContent = state.localSimulation ? `Local simulation: set ${player.id}'s commanders.` : `Only your claimed seat (${player.id}) will change.`; $(`input[name="gameCommanderCount"][value="${player.commanderCount}"]`).checked = true; renderCommanderNameFields(dom.gameCommanderNames, player.commanderCount, player.commanderNames, player.commanderCards); dom.commanderCountDialog.showModal(); });
dom.commanderTaxQuickButton?.addEventListener('click', () => { renderCommanderTaxDialog(); dom.commanderTaxDialog.showModal(); });
dom.backToSetupButton?.addEventListener('click', returnToSetup);
$$('input[name="gameCommanderCount"]').forEach(input => input.addEventListener('change', () => renderCommanderNameFields(dom.gameCommanderNames, selectedCommanderCount('gameCommanderCount'))));
dom.commanderCountForm.addEventListener('submit', event => { if (event.submitter?.value === 'confirm') { const form = new FormData(dom.commanderCountForm); const count = Number(form.get('gameCommanderCount')); updateCommanderSetup(count, commanderNamesFromForm(form, count), commanderCardsFromFields(dom.gameCommanderNames, count)); } }); dom.declareWinnerForm.addEventListener('submit', event => { if (event.submitter?.value === 'confirm') declareWinner(); }); dom.connectionButton.addEventListener('click', () => dom.connectionDialog.showModal());
transport.addEventListener('status', event => renderConnection(event.detail)); transport.addEventListener('state', event => { if (event.detail?.seats?.length) { const previousTossKey = coinTossKey(state?.lastCoinToss); const previousRollKey = startingPlayerRollKey(state?.turn?.startingPlayerRoll); const previousTurnKey = state?.turn?.lastHandoff ? `${state.turn.lastHandoff.handedOffAt}:${state.turn.lastHandoff.toSeatId}` : null; state = stateFromSnapshot(event.detail); const nextRollKey = startingPlayerRollKey(state.turn.startingPlayerRoll); const nextTurnKey = state.turn.lastHandoff ? `${state.turn.lastHandoff.handedOffAt}:${state.turn.lastHandoff.toSeatId}` : null; if (dom.game.hidden) showView(dom.game); if (nextTurnKey && nextTurnKey !== previousTurnKey && nextTurnKey !== lastTurnHandoffKey) { lastTurnHandoffKey = nextTurnKey; showTurnHandoff(); } if (nextRollKey && nextRollKey !== previousRollKey && nextRollKey !== lastStartingRollKey) { lastStartingRollKey = nextRollKey; showStartingPlayerRoll(state.turn.startingPlayerRoll); } else if (coinTossKey(state.lastCoinToss) && coinTossKey(state.lastCoinToss) !== previousTossKey) { const dialog = coinTossDialogRequested; coinTossDialogRequested = false; showCoinToss(state.lastCoinToss, { dialog }); } else render(); } });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
