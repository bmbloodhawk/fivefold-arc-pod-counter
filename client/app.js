import { RealtimeAdapter, apiBaseFromPage } from './realtime.js?v=72';
import { LifeAdjustmentBatcher } from './life-adjustment-batcher.js?v=72';
import { rollPhysicalD20s, stopPhysicalD20s } from './dice-roll-3d.js?v=113';
import { connectionPresentation } from './connection-state.js?v=1';

const MODES = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
const IDENTITY_ORDER = ['W', 'U', 'B', 'R', 'G'];
const IDENTITY_COLORS = { W: '#d7c9a7', U: '#477ea7', B: '#78668b', R: '#a75a4b', G: '#527958' };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  views: $$('.view'), landing: $('#landingView'), create: $('#createView'), join: $('#joinView'), joinSeatView: $('#joinSeatView'), game: $('#gameView'), joinCodeForm: $('#joinCodeForm'), joinCodeStatus: $('#joinCodeStatus'),
  connectionButton: $('#connectionButton'), connectionText: $('#connectionText'), connectionDialog: $('#connectionDialog'), connectionDetail: $('#connectionDetail'),
  playerCountChoices: $('#playerCountChoices'), createName: $('#createName'), joinSeat: $('#joinSeat'), joinName: $('#joinName'), activeSeat: $('#activeSeat'), localSimulation: $('#localSimulation'), roundLimitMinutes: $('#roundLimitMinutes'), createCommanderNames: $('#createCommanderNames'), joinCommanderNames: $('#joinCommanderNames'), gameCommanderNames: $('#gameCommanderNames'),
  podStrip: $('#podStrip'), podLabel: $('#podLabel'), ownerLabel: $('#ownerLabel'), commanderIdentityName: $('#commanderIdentityName'), identityHeaderRail: $('#identityHeaderRail'), modeTitle: $('#modeTitle'), mainValue: $('#mainValue'),
  counterContext: $('#counterContext'), statusMessage: $('#statusMessage'), lethalMark: $('#lethalMark'), lifeChangeIndicator: $('#lifeChangeIndicator'), sourcePanel: $('#sourcePanel'), inspectionNotice: $('#inspectionNotice'), sideSeats: $('#sideSeats'),
  activeSeatBar: $('#activeSeatBar'), gameMenu: $('#gameMenu'), moreButton: $('#moreButton'),
  disconnectBanner: $('#disconnectBanner'), syncBanner: $('#syncBanner'), coinTossNotice: $('#coinTossNotice'), victoryNotice: $('#victoryNotice'), coinTossButton: $('#coinTossButton'), coinTossDialog: $('#coinTossDialog'), coinTossResult: $('#coinTossResult'), tossAgainButton: $('#tossAgainButton'), resetDialog: $('#resetDialog'), commanderSetupButton: $('#commanderSetupButton'), backToSetupButton: $('#backToSetupButton'), declareWinnerButton: $('#declareWinnerButton'), declareWinnerDialog: $('#declareWinnerDialog'), declareWinnerForm: $('#declareWinnerForm'), winnerSeat: $('#winnerSeat'), victoryDialog: $('#victoryDialog'), victoryTitle: $('#victoryTitle'), victoryDetail: $('#victoryDetail'),
  lobbyControls: $('#lobbyControls'), lobbyStatus: $('#lobbyStatus'), startingSeatField: $('#startingSeatField'), startingSeat: $('#startingSeat'), chooseFirstButton: $('#chooseFirstButton'), randomFirstButton: $('#randomFirstButton'), startGameButton: $('#startGameButton'), startingRollDialog: $('#startingRollDialog'), startingRollStatus: $('#startingRollStatus'), rollMyD20Button: $('#rollMyD20Button'), startingRollCanvas: $('#startingRollCanvas'), startingRollFinalDice: $('#startingRollFinalDice'), startingRollOverlays: $('#startingRollOverlays'), startingRollLive: $('#startingRollLive'), turnBanner: $('#turnBanner'), turnLabel: $('#turnLabel'), turnPlayer: $('#turnPlayer'), turnElapsed: $('#turnElapsed'), gameTimer: $('#gameTimer'), lastTurnSummary: $('#lastTurnSummary'), turnActions: $('#turnActions'), endTurnButton: $('#endTurnButton'), undoTurnButton: $('#undoTurnButton'), pauseTurnButton: $('#pauseTurnButton'), toggleTurnTrackingButton: $('#toggleTurnTrackingButton'), toggleTurnCuesButton: $('#toggleTurnCuesButton'), toggleDeviceCuesButton: $('#toggleDeviceCuesButton'), turnActionDetail: $('#turnActionDetail'),
  commanderCountDialog: $('#commanderCountDialog'), commanderCountDetail: $('#commanderCountDetail'), commanderCountForm: $('#commanderCountForm'), saveCommanderCountButton: $('#saveCommanderCountButton'),
  commanderTaxQuickButton: $('#commanderTaxQuickButton'), commanderTaxDialog: $('#commanderTaxDialog'), commanderTaxDetail: $('#commanderTaxDetail'), commanderTaxList: $('#commanderTaxList'),
  customLifeButton: $('#customLifeButton'), customLifeDialog: $('#customLifeDialog'), customLifeForm: $('#customLifeForm'), customLifeAmount: $('#customLifeAmount'), cancelCustomLifeButton: $('#cancelCustomLifeButton'), playtestNotesButton: $('#playtestNotesButton'), playtestRecapButton: $('#playtestRecapButton'), savedPlaytestsButton: $('#savedPlaytestsButton'), refreshTableButton: $('#refreshTableButton'), playtestNotesDialog: $('#playtestNotesDialog'), playtestNotesForm: $('#playtestNotesForm'), playtestNotesList: $('#playtestNotesList'), playtestNoteText: $('#playtestNoteText'), playtestNoteStatus: $('#playtestNoteStatus'), playtestRecapDialog: $('#playtestRecapDialog'), playtestRecapContent: $('#playtestRecapContent'), savedPlaytestsDialog: $('#savedPlaytestsDialog'), savedPlaytestsContent: $('#savedPlaytestsContent')
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
let startingRollTimers = [];
let startingRollSequence = 0;
let lastStartingRollKey = null;
let turnCueAudio = null;
function deviceTurnCuesEnabled() { try { return localStorage.getItem('fivefold-arc:turn-cues') !== 'off'; } catch { return true; } }
function setDeviceTurnCues(enabled) { try { localStorage.setItem('fivefold-arc:turn-cues', enabled ? 'on' : 'off'); } catch { /* preference is optional */ } }
function playTurnCue() {
  if (!state?.turn?.cuesEnabled || !deviceTurnCuesEnabled()) return;
  try { navigator.vibrate?.([45, 35, 70]); } catch { /* unsupported, including iPhone */ }
  try {
    turnCueAudio ||= new AudioContext(); const oscillator = turnCueAudio.createOscillator(); const gain = turnCueAudio.createGain();
    oscillator.frequency.value = 660; gain.gain.setValueAtTime(.0001, turnCueAudio.currentTime); gain.gain.exponentialRampToValueAtTime(.13, turnCueAudio.currentTime + .01); gain.gain.exponentialRampToValueAtTime(.0001, turnCueAudio.currentTime + .16);
    oscillator.connect(gain).connect(turnCueAudio.destination); oscillator.start(); oscillator.stop(turnCueAudio.currentTime + .17);
  } catch { /* audio is best-effort on mobile browsers */ }
}
let localStartingRollKey = null;
let pendingStartingRoll = null;
let turnTicker = null;
let turnUndoTimer = null;
let lastTurnHandoffKey = null;
let shownVictoryKey = null;
let optimisticLifeDelta = 0;
let awaitingConfirmedResync = false;
let syncBannerTimer = null;
const lifeBatcher = new LifeAdjustmentBatcher({ send: async ({ delta, operationId }) => {
  try { await transport.adjust({ counter: 'life', delta, operationId }); optimisticLifeDelta -= delta; }
  catch (error) { optimisticLifeDelta -= delta; renderConnection('disconnected'); showError(error); }
  finally { if (state) render(); }
} });

function sourceForSeat(player, slot) {
  const multiple = player.commanderCount === 2;
  const commanderName = player.commanderNames?.[slot === 'A' ? 0 : 1] || '';
  return { id: multiple ? `${player.id}-${slot}` : player.id, label: commanderName || (multiple ? `${player.id} ${slot}` : player.id), ownerLabel: player.name || player.id, commanderName, ownerPlayerId: player.id, slot };
}
function sourcesFromPlayers(players) { return players.flatMap(player => Array.from({ length: player.commanderCount }, (_, index) => sourceForSeat(player, String.fromCharCode(65 + index)))); }
function blankDamage(sources) { return Object.fromEntries(sources.map(source => [source.id, 0])); }
function playerTemplate(number, startingLife, commanderCount, sources, commanderNames = [], commanderColors = []) {
  return { id: `P${number}`, name: `P${number}`, commanderCount, commanderNames: Array.from({ length: commanderCount }, (_, slot) => commanderNames[slot] || ''), commanderColors: Array.from({ length: commanderCount }, (_, slot) => normaliseIdentity(commanderColors[slot])), life: startingLife, poison: 0, commanderDamage: blankDamage(sources), radiation: 0, energy: 0, generic: 0, connectionStatus: 'connected', eliminated: false, lethalCause: null, warning: null };
}
function createState({ playerCount = 4, startingLife = 40, ownerPlayerId = 'P1', ownerName = ownerPlayerId, ownerCommanderCount = 1, ownerCommanderNames = [], ownerCommanderColors = [], roundLimitMinutes = null, localSimulation = true, podCode = 'LOCAL' } = {}) {
  const counts = Array.from({ length: playerCount }, (_, index) => `P${index + 1}` === ownerPlayerId ? ownerCommanderCount : 1);
  const players = counts.map((count, index) => playerTemplate(index + 1, startingLife, count, [], `P${index + 1}` === ownerPlayerId ? ownerCommanderNames : [], `P${index + 1}` === ownerPlayerId ? ownerCommanderColors : []));
  players.find(player => player.id === ownerPlayerId).name = ownerName || ownerPlayerId;
  const commanderSources = sourcesFromPlayers(players);
  players.forEach(player => { player.commanderDamage = blankDamage(commanderSources); });
  const startedAt = Date.now();
  return { playerCount, startingLife, roundLimitMinutes, ownerPlayerId, activePlayerId: ownerPlayerId, turnSeatId: ownerPlayerId, turn: { activeSeatId: 0, gameStarted: false, gameStartedAt: null, startingPlayerSeatId: null, startingPlayerRoll: null, lastHandoff: null, trackingEnabled: true, cuesEnabled: false, pausedAt: null }, localSimulation, podCode, gameResult: null, mode: 'life', selectedSourceId: null, commanderSources, commanderCastCounts: blankDamage(commanderSources), players };
}
function playerIdForSource(source, fallbackLabel = '') {
  if (source.ownerPlayerId) return source.ownerPlayerId;
  if (Number.isInteger(source.ownerSeatId)) return `P${source.ownerSeatId + 1}`;
  if (Number.isInteger(source.seatId)) return `P${source.seatId + 1}`;
  const match = String(source.label || fallbackLabel).match(/^(P\d+)/i);
  return match ? match[1].toUpperCase() : null;
}
function normaliseIdentity(colors) { return [...new Set((Array.isArray(colors) ? colors : []).filter(color => IDENTITY_ORDER.includes(color)))].sort((a, b) => IDENTITY_ORDER.indexOf(a) - IDENTITY_ORDER.indexOf(b)); }
function playerIdentity(player) { return normaliseIdentity((player.commanderColors || []).flat()); }
function identityBackground(colors) {
  const values = normaliseIdentity(colors); if (!values.length) return '';
  if (values.length === 1) return IDENTITY_COLORS[values[0]];
  const stops = values.map((color, index) => `${IDENTITY_COLORS[color]} ${Math.round(index * 100 / values.length)}% ${Math.round((index + 1) * 100 / values.length)}%`).join(', ');
  return `conic-gradient(from -45deg at 50% 50%, ${stops})`;
}
function identityRail(colors) { const values = normaliseIdentity(colors); if (!values.length) return ''; const stops = values.map((color, index) => `${IDENTITY_COLORS[color]} ${Math.round(index * 100 / values.length)}% ${Math.round((index + 1) * 100 / values.length)}%`).join(', '); return `linear-gradient(90deg, ${stops})`; }
function identityStyle(player) { const rail = identityRail(playerIdentity(player)); return rail ? ` style="--identity-rail: ${rail}"` : ''; }
function identityLabel(player) { const colors = playerIdentity(player); return colors.length ? `Commander color identity: ${colors.join(', ')}.` : 'Commander color identity: colorless or not set.'; }
function normaliseSnapshotSources(snapshot) {
  const raw = Array.isArray(snapshot.commanderSources) ? snapshot.commanderSources : null;
  if (raw?.length) return raw.map((source, index) => {
    const ownerPlayerId = playerIdForSource(source); const label = source.label || source.name || `${ownerPlayerId || 'Commander'} ${index + 1}`;
    return { id: String(source.id ?? source.commanderId ?? `source-${index}`), label, ownerLabel: source.ownerLabel || '', commanderName: source.commanderName || '', commanderColors: normaliseIdentity(source.commanderColors), ownerPlayerId, slot: source.slot || (label.match(/\s([AB])$/)?.[1] || 'A') };
  });
  return sourcesFromPlayers(snapshot.seats.map(seat => ({ id: `P${seat.seatId + 1}`, name: seat.name, commanderCount: seat.commanderCount === 2 ? 2 : 1, commanderNames: seat.commanderNames || [], commanderColors: seat.commanderColors || [] })));
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
  const turn = snapshot.turn || { activeSeatId: 0, gameStarted: true, gameStartedAt: Date.now(), turnStartedAt: Date.now(), roundEndsAt: null, startingPlayerSeatId: 0, startingPlayerRoll: null, lastHandoff: null, trackingEnabled: true, cuesEnabled: false, pausedAt: null };
  return {
    playerCount: snapshot.config.playerCount, startingLife: snapshot.config.startingLife, roundLimitMinutes: snapshot.config.roundLimitMinutes || null, commanderSources, commanderCastCounts: castCountsFromSnapshot(snapshot, commanderSources), ownerPlayerId, activePlayerId, turnSeatId: `P${turn.activeSeatId + 1}`, turn,
    localSimulation: false, podCode: snapshot.code, version: snapshot.version, hostSeatId: snapshot.hostSeatId, lastCoinToss: snapshot.lastCoinToss || null, gameResult: snapshot.gameResult || null, mode: previous?.mode || 'life', selectedSourceId: previous?.selectedSourceId || null,
    players: snapshot.seats.map(seat => ({ id: `P${seat.seatId + 1}`, name: seat.name, commanderCount: seat.commanderCount === 2 ? 2 : 1, commanderNames: seat.commanderNames || [], commanderColors: (seat.commanderColors || []).map(normaliseIdentity), life: seat.counters.life, poison: seat.counters.poison, commanderDamage: damageFromSnapshot(seat, commanderSources), radiation: seat.counters.radiation ?? 0, energy: seat.counters.energy, generic: seat.counters.generic, connectionStatus: seat.connected ? 'connected' : seat.claimed ? 'disconnected' : 'waiting', eliminated: false, lethalCause: null, warning: null }))
  };
}
function sourcesForDefender(_playerId) { return state.commanderSources; }
function ownCommanderSources(playerId) { return state.commanderSources.filter(source => source.ownerPlayerId === playerId); }
function displayName(player) { return String(player?.name || player?.id || 'Player').trim() || player.id; }
function displayPlayer(player) { const name = displayName(player); return name === player.id ? name : `${name} · ${player.id}`; }
function displaySource(source) { const owner = state?.players.find(player => player.id === source.ownerPlayerId); if (source.commanderName) return source.commanderName; if (!owner) return source.label; return owner.commanderCount === 2 ? `${displayName(owner)} ${source.slot || 'A'}` : displayName(owner); }
function sourceOwnerLabel(source) { const owner = state?.players.find(player => player.id === source.ownerPlayerId); return displayName(owner || { name: source.ownerLabel, id: source.ownerPlayerId || 'Player' }); }
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
function fillSetupControls() { dom.playerCountChoices.innerHTML = Array.from({ length: 7 }, (_, index) => { const value = index + 2; return `<label><input type="radio" name="playerCount" value="${value}" ${value === 4 ? 'checked' : ''}><span>${value}</span></label>`; }).join(''); }
function commanderNamesFromForm(form, count) { return Array.from({ length: count }, (_, slot) => String(form.get(`commanderName${slot}`) || '').trim()); }
function commanderColorsFromFields(container, count) { return Array.from({ length: count }, (_, slot) => normaliseIdentity(String(container.querySelector(`input[name="commanderName${slot}"]`)?.dataset.commanderColors || '').split(',').filter(Boolean))); }
async function lookupCommanderIdentity(name) {
  const response = await fetch(`${apiBaseFromPage()}/api/commander-identity?name=${encodeURIComponent(name)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Commander lookup failed.');
  return { name: String(result.name || name), colors: normaliseIdentity(result.colors) };
}
function renderCommanderNameFields(container, count, names = [], identities = []) {
  if (!container) return;
  const current = [...container.querySelectorAll('input[name^="commanderName"]')].map(input => ({ name: input.value, colors: input.dataset.commanderColors || '' }));
  container.innerHTML = Array.from({ length: count }, (_, slot) => { const prior = current[slot]; const colors = normaliseIdentity((prior?.colors || identities[slot] || []).toString().split(',').filter(Boolean)); const name = prior?.name ?? names[slot] ?? ''; const identity = colors.length ? `✓ Confirmed: ${colors.join('')}` : 'Confirm the card to apply its color identity.'; return `<div class="commander-identity-field"><label class="select-field">Commander ${count === 2 ? slot === 0 ? 'A' : 'B' : ''} name <small>(optional)</small><input name="commanderName${slot}" type="text" maxlength="60" autocomplete="off" placeholder="e.g. Atraxa, Praetors’ Voice" value="${escapeHtml(name)}" data-commander-colors="${escapeHtml(colors.join(','))}"></label><button class="commander-lookup" data-lookup-commander="${slot}" type="button">Find commander details</button><small class="commander-lookup-status" aria-live="polite">${identity}</small></div>`; }).join('');
  container.querySelectorAll('input[name^="commanderName"]').forEach(input => input.addEventListener('input', () => { delete input.dataset.commanderColors; const status = input.closest('.commander-identity-field').querySelector('.commander-lookup-status'); status.textContent = 'Name changed. Confirm the card to apply its color identity.'; }));
  container.querySelectorAll('[data-lookup-commander]').forEach(button => button.addEventListener('click', async () => { const field = button.closest('.commander-identity-field'); const input = field.querySelector('input'); const status = field.querySelector('.commander-lookup-status'); const name = input.value.trim(); if (!name) { input.focus(); return; } button.disabled = true; status.textContent = 'Finding commander…'; try { const card = await lookupCommanderIdentity(name); input.value = card.name; input.dataset.commanderColors = card.colors.join(','); status.textContent = `✓ Confirmed: ${card.colors.join('') || 'Colorless'}`; } catch (error) { delete input.dataset.commanderColors; status.textContent = error.message; } finally { button.disabled = false; } }));
}
function selectedCommanderCount(formName) { return Number($(`input[name="${formName}"]:checked`)?.value || 1); }
function refreshSetupCommanderNames() { renderCommanderNameFields(dom.createCommanderNames, selectedCommanderCount('commanderCount')); renderCommanderNameFields(dom.joinCommanderNames, selectedCommanderCount('joinCommanderCount')); }
function beginLocalGame(config) { transport.useLocal(); state = createState(config); showView(dom.game); render(); }
function showSharedGame(snapshot) { state = stateFromSnapshot(snapshot); showView(dom.game); render(); }
function showError(error) { dom.connectionDetail.textContent = error?.message || 'The pod server could not complete that request.'; dom.connectionDialog.showModal(); }
function activePlayer() { return state.players.find(player => player.id === state.activePlayerId); }
function currentValue(player) { const value = state.mode === 'commander' ? commanderValue(player) : player[state.mode]; return state.mode === 'life' && !state.localSimulation && player.id === state.ownerPlayerId ? value + optimisticLifeDelta : value; }
function turnPlayer() { return state.players.find(player => player.id === state.turnSeatId); }
function formatDuration(milliseconds) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function renderTurnFlow() {
  if (!state?.turn) return;
  const turnPlayerValue = turnPlayer(); const now = Date.now(); const handoff = state.turn.lastHandoff;
  const claimedPlayers = state.players.filter(player => player.connectionStatus !== 'waiting');
  const isHost = state.localSimulation || transport.seatId === state.hostSeatId;
  const isStarted = Boolean(state.turn.gameStarted);
  dom.lobbyControls.hidden = isStarted;
  const trackingEnabled = state.turn.trackingEnabled !== false;
  const paused = Boolean(state.turn.pausedAt);
  dom.turnBanner.hidden = !isStarted || !trackingEnabled;
  dom.turnActions.hidden = !isStarted;
  dom.toggleTurnTrackingButton.hidden = !isHost;
  dom.toggleTurnTrackingButton.disabled = !isHost || !(state.localSimulation || transport.status === 'connected');
  dom.toggleTurnTrackingButton.textContent = `Turn tracking: ${trackingEnabled ? 'on' : 'off'}`;
  dom.toggleTurnCuesButton.hidden = !isHost;
  dom.toggleTurnCuesButton.disabled = !isHost || !(state.localSimulation || transport.status === 'connected');
  dom.toggleTurnCuesButton.textContent = `Table turn cue: ${state.turn.cuesEnabled ? 'single ding' : 'off'}`;
  dom.toggleDeviceCuesButton.textContent = `My turn cue: ${deviceTurnCuesEnabled() ? 'on' : 'off'}`;
  dom.pauseTurnButton.hidden = !isStarted || !isHost || !trackingEnabled;
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
  const timerNow = state.turn.pausedAt || now;
  const actingSeatId = state.localSimulation ? state.activePlayerId : state.ownerPlayerId;
  const isOwnerActive = state.turnSeatId === actingSeatId;
  dom.game.dataset.yourTurn = String(isOwnerActive && trackingEnabled && !paused);
  dom.turnLabel.textContent = paused ? 'TURN PAUSED' : isOwnerActive ? 'YOUR TURN' : `${state.turnSeatId}'S TURN`;
  dom.turnPlayer.textContent = turnPlayerValue ? displayName(turnPlayerValue) : state.turnSeatId;
  dom.turnElapsed.textContent = `TURN ${formatDuration(timerNow - state.turn.turnStartedAt)}`;
  dom.gameTimer.textContent = state.turn.roundEndsAt ? `ROUND ENDS IN ${formatDuration(state.turn.roundEndsAt - timerNow)}` : `GAME TIME ${formatDuration(timerNow - state.turn.gameStartedAt)}`;
  const completedTurn = handoff ? state.players.find(player => player.id === `P${handoff.fromSeatId + 1}`) : null;
  dom.lastTurnSummary.hidden = !handoff || !Number.isFinite(handoff.turnLengthMs) || now - handoff.handedOffAt > 15_000;
  if (!dom.lastTurnSummary.hidden) dom.lastTurnSummary.textContent = `LAST TURN · ${displayName(completedTurn || { id: `P${handoff.fromSeatId + 1}` })} · ${formatDuration(handoff.turnLengthMs)}`;
  const canAct = (state.localSimulation || transport.status === 'connected') && isOwnerActive && trackingEnabled && !paused;
  dom.endTurnButton.disabled = !canAct;
  dom.endTurnButton.hidden = !isOwnerActive || !trackingEnabled;
  dom.pauseTurnButton.disabled = !isHost || !(state.localSimulation || transport.status === 'connected');
  dom.pauseTurnButton.textContent = paused ? 'Resume timers' : 'Pause timers';
  dom.turnActionDetail.textContent = !trackingEnabled ? 'Turn tracking is off for this table.' : paused ? 'Timers are paused by the host.' : isOwnerActive ? 'You are active. Press once when you pass the turn.' : `${turnPlayerValue ? displayName(turnPlayerValue) : state.turnSeatId} controls this turn.`;
  const undoAvailable = trackingEnabled && handoff && Date.now() - handoff.handedOffAt <= 15_000 && actingSeatId === `P${handoff.fromSeatId + 1}`;
  dom.undoTurnButton.hidden = !undoAvailable;
  if (undoAvailable) dom.undoTurnButton.textContent = `Undo handoff · ${Math.max(0, Math.ceil((15_000 - (Date.now() - handoff.handedOffAt)) / 1000))}s`;
  clearInterval(turnTicker);
  turnTicker = setInterval(() => { if (state && !dom.game.hidden) renderTurnFlow(); }, 1000);
}
function render() {
  if (!state.commanderCastCounts) state.commanderCastCounts = blankDamage(state.commanderSources);
  state.players.forEach(evaluatePlayer); localLastPlayerStanding(); const player = activePlayer(); const source = state.mode === 'commander' ? selectedSourceFor(player) : null;
  dom.game.style.setProperty('--identity-seal', identityBackground(playerIdentity(player)) || 'none');
  dom.game.dataset.hasIdentity = String(playerIdentity(player).length > 0);
  const identityNames = player.commanderNames.filter(Boolean).join(' · ');
  dom.podLabel.textContent = state.podCode === 'LOCAL' ? 'LOCAL POD' : `POD ${state.podCode}`; dom.ownerLabel.textContent = `YOU · ${displayName(state.players.find(item => item.id === state.ownerPlayerId))}`; dom.commanderIdentityName.hidden = !identityNames; dom.commanderIdentityName.textContent = identityNames; dom.identityHeaderRail.style.setProperty('--identity-rail', identityRail(playerIdentity(player)) || 'transparent'); dom.identityHeaderRail.hidden = !playerIdentity(player).length; dom.modeTitle.textContent = state.mode.toUpperCase(); dom.mainValue.value = currentValue(player);
  const inspectingSharedSeat = !state.localSimulation && player.id !== state.ownerPlayerId;
  dom.counterContext.textContent = state.mode === 'commander' ? (source ? `${displayPlayer(player)} HAS RECEIVED DAMAGE FROM ${displaySource(source)}` : `NO OTHER COMMANDERS · ${displayPlayer(player)}`) : `${displayName(player)}${player.id === state.ownerPlayerId ? ' · YOU' : state.localSimulation ? ' · SIMULATED' : ' · READ ONLY'}`;
  dom.inspectionNotice.hidden = !inspectingSharedSeat;
  dom.inspectionNotice.textContent = inspectingSharedSeat ? `VIEWING ${displayPlayer(player)} · READ ONLY ON THIS PHONE` : '';
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
  dom.activeSeatBar.hidden = !state.localSimulation; $('#resetButton').hidden = !state.localSimulation && transport.seatId !== state.hostSeatId;
  const commanderOwner = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); const taxPlayer = activePlayer();
  dom.commanderSetupButton.textContent = state.localSimulation ? `${displayName(commanderOwner)} commander setup` : 'My commander setup';
  dom.coinTossButton.disabled = !(transport.status === 'local' || transport.status === 'connected');
  dom.declareWinnerButton.hidden = !state.localSimulation && transport.seatId !== state.hostSeatId;
  dom.playtestNotesButton.hidden = state.localSimulation; dom.playtestNotesButton.disabled = transport.status !== 'connected'; dom.refreshTableButton.hidden = state.localSimulation; dom.refreshTableButton.disabled = transport.status !== 'connected';
  dom.playtestRecapButton.hidden = state.localSimulation || transport.seatId !== state.hostSeatId; dom.playtestRecapButton.disabled = transport.status !== 'connected'; dom.savedPlaytestsButton.hidden = state.localSimulation || transport.seatId !== state.hostSeatId; dom.savedPlaytestsButton.disabled = transport.status !== 'connected';
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
  dom.lifeChangeIndicator.textContent = `${sign}${Math.abs(lifeChange.delta)} LIFE · ${lifeChange.from} → ${lifeChange.to}${lifeChange.confirmed ? ' · SYNCED JUST NOW' : ''}`;
  dom.lifeChangeIndicator.classList.toggle('negative', lifeChange.delta < 0);
}
function showLifeChange(playerId, delta, from, to, { confirmed = false } = {}) {
  if (!delta) return;
  // Keep one rolling confirmation while a player is entering a burst of life
  // changes. The total resets only after four quiet seconds or a seat switch.
  const prior = lifeChange?.playerId === playerId && Math.sign(lifeChange.delta) === Math.sign(delta) ? lifeChange : null;
  const start = prior?.from ?? from;
  lifeChange = { playerId, from: start, to, delta: to - start, confirmed };
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
  return `${roll.startedAt ?? roll.selectedAt}:${roll.status}:${roll.winnerSeatId}:${roll.rounds?.map(round => `${round.contenderSeatIds?.join('-')}:${round.rolls.map(item => `${item.seatId}-${item.value}`).join(',')}`).join('/')}`;
}
function localD20() {
  const buffer = new Uint8Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= 240);
  return (buffer[0] % 20) + 1;
}
function createLocalStartingPlayerRoll(players) {
  let contenders = [...players]; const rounds = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rolls = contenders.map(player => ({ seatId: Number(player.id.slice(1)) - 1, value: localD20() }));
    const high = Math.max(...rolls.map(roll => roll.value)); const tiedSeatIds = rolls.filter(roll => roll.value === high).map(roll => roll.seatId);
    rounds.push({ rolls, tiedSeatIds });
    if (tiedSeatIds.length === 1) return { rounds, winnerSeatId: tiedSeatIds[0], selectedAt: Date.now(), visualSeed: crypto.getRandomValues(new Uint32Array(1))[0] };
    contenders = players.filter(player => tiedSeatIds.includes(Number(player.id.slice(1)) - 1));
  }
  throw new Error('Could not complete the d20 roll-off. Please roll again.');
}
function clearStartingRollTimers() { clearTimeout(startingRollTimer); startingRollTimers.forEach(timer => clearTimeout(timer)); startingRollTimers = []; stopPhysicalD20s(); }
function diceColorForIdentity(colors) {
  const values = normaliseIdentity(colors); if (!values.length) return '#b88a45';
  const channels = values.map(color => IDENTITY_COLORS[color].slice(1).match(/.{2}/g).map(part => Number.parseInt(part, 16)));
  const mixed = [0, 1, 2].map(channel => Math.round(channels.reduce((total, value) => total + value[channel], 0) / channels.length * .82 + 255 * .18));
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}
function renderStartingRollDice(round) {
  if (!dom.startingRollOverlays || !dom.startingRollFinalDice) return;
  dom.startingRollCanvas.dataset.diceCount = String(Math.max(1, round.contenderSeatIds?.length || round.rolls.length));
  dom.startingRollCanvas.dataset.rollComplete = 'false';
  dom.startingRollFinalDice.innerHTML = '';
  dom.startingRollOverlays.innerHTML = (round.contenderSeatIds || round.rolls.map(item => item.seatId)).map(seatId => {
    const roll = round.rolls.find(item => item.seatId === seatId); const player = state?.players.find(item => item.id === `P${seatId + 1}`);
    const name = escapeHtml(displayName(player || { id: `P${seatId + 1}` }));
    const identity = playerIdentity(player || {}); const diceColor = diceColorForIdentity(identity);
    return `<div class="dice-result-chip${roll ? ' landed' : ''}" data-seat-id="${seatId}" style="--dice-color: ${diceColor}; --dice-identity: ${identityBackground(identity) || diceColor}"><span>${name}</span><strong>${roll?.value ?? '…'}</strong></div>`;
  }).join('');
  const newest = round.rolls.at(-1);
  if (newest) { const player = state?.players.find(item => item.id === `P${newest.seatId + 1}`); dom.startingRollLive.textContent = `${displayName(player || { id: `P${newest.seatId + 1}` })} rolled ${newest.value}.`; }
}
function showStartingPlayerRoll(roll, { dialog = true } = {}) {
  if (!roll?.rounds?.length) return;
  if (dialog && !dom.startingRollDialog.open) dom.startingRollDialog.showModal();
  const round = roll.rounds.at(-1); renderStartingRollDice(round);
  const contenderSeatIds = round.contenderSeatIds || round.rolls.map(item => item.seatId);
  const complete = roll.status === 'complete' || (!roll.status && Number.isInteger(roll.winnerSeatId));
  dom.rollMyD20Button.hidden = true; dom.rollMyD20Button.disabled = false; pendingStartingRoll = null;
  if (complete) { const winner = state?.players.find(player => player.id === `P${roll.winnerSeatId + 1}`); const winningValue = round.rolls.find(item => item.seatId === roll.winnerSeatId)?.value; dom.startingRollStatus.textContent = `${displayName(winner || { id: `P${roll.winnerSeatId + 1}` })} ROLLS ${winningValue} — GOES FIRST`; render(); return; }
  const ownSeatId = Number(state?.ownerPlayerId?.slice(1)) - 1; const ownReported = round.rolls.some(item => item.seatId === ownSeatId); const key = `${roll.startedAt ?? roll.selectedAt}:${contenderSeatIds.join('-')}:${ownSeatId}`;
  if (!contenderSeatIds.includes(ownSeatId) || ownReported) { const waiting = contenderSeatIds.length - round.rolls.length; dom.startingRollStatus.textContent = `WAITING FOR ${waiting} LOCAL ROLL${waiting === 1 ? '' : 'S'}…`; return; }
  dom.rollMyD20Button.hidden = false;
  if (localStartingRollKey === key) { dom.rollMyD20Button.disabled = true; dom.startingRollStatus.textContent = 'YOUR D20 IS ROLLING…'; return; }
  pendingStartingRoll = { key, player: state?.players.find(candidate => candidate.id === state.ownerPlayerId) || {} };
  dom.startingRollStatus.textContent = contenderSeatIds.length < (state?.players.length || 0) ? 'TIE — ROLL AGAIN' : 'ROLL WHEN YOU ARE READY';
}
async function rollMyStartingD20() {
  const pending = pendingStartingRoll; if (!pending || localStartingRollKey === pending.key) return;
  localStartingRollKey = pending.key; pendingStartingRoll = null; dom.rollMyD20Button.disabled = true; dom.startingRollStatus.textContent = 'YOUR D20 IS ROLLING…';
  const report = async (value) => { try { await transport.reportStartingPlayerRoll(value); } catch (error) { localStartingRollKey = null; showError(error); } };
  const result = await rollPhysicalD20s({ container: dom.startingRollCanvas, dice: [{ colors: playerIdentity(pending.player), seed: crypto.getRandomValues(new Uint32Array(1))[0], startedAt: Date.now() + 120 }], onRollSettled: ({ results }) => report(results[0]) });
  if (!result.animated) report(localD20());
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
  // The strip is a table snapshot, not a second dashboard.  Let CSS use the
  // player count to compact large pods without hiding their name or life.
  const largePod = state.players.length > 4;
  dom.podStrip.dataset.playerCount = String(state.players.length);
  dom.game.querySelector('.counter-stage').classList.toggle('has-side-seats', largePod);
  const seatMarkup = (player) => {
    const isWaiting = player.connectionStatus === 'waiting';
    const isOffline = player.connectionStatus === 'disconnected';
    // A claimed but offline seat retains server-authoritative counters. Show the
    // last synced life total, reserving ? only for a seat that has never joined.
    // Keep this phone's small seat tile in lockstep with the large value while
    // a batched life tap is awaiting the authoritative server response. Other
    // seats remain strictly server-confirmed.
    const value = isWaiting ? '?' : player.eliminated ? '☠' : currentValue(player);
    const marker = isWaiting ? 'WAITING' : isOffline ? 'OFFLINE' : player.eliminated ? 'ELIMINATED' : player.warning ? 'WARNING' : 'CONNECTED';
    const stateClass = isWaiting ? 'waiting' : isOffline ? 'offline' : player.eliminated ? 'eliminated-state' : player.warning ? 'warning' : 'connected';
    const name = displayName(player); const tileName = `${name}${player.id === state.ownerPlayerId ? ' · YOU' : ''}`;
    const stateSymbol = isWaiting ? '○' : isOffline ? '×' : player.eliminated ? '☠' : player.warning ? '!' : '●';
    return `<button class="pod-seat ${player.id === state.activePlayerId ? 'active' : ''} ${player.id === state.turnSeatId ? 'turn-active' : ''} ${player.eliminated ? 'eliminated' : ''} ${isOffline ? 'disconnected' : ''}" data-seat="${player.id}" type="button" aria-label="${escapeHtml(`${displayPlayer(player)}, ${marker}, ${value}. ${identityLabel(player)}`)}"${identityStyle(player)}><span class="seat-name" title="${escapeHtml(displayPlayer(player))}">${escapeHtml(tileName)}</span><span class="seat-life">${value}</span><span class="seat-state ${stateClass}" title="${marker}">${stateSymbol}<span class="sr-only">${marker}</span></span><span class="identity-rail" aria-hidden="true"></span></button>`;
  };
  dom.podStrip.innerHTML = state.players.slice(0, largePod ? 4 : state.players.length).map(seatMarkup).join('');
  dom.sideSeats.hidden = !largePod;
  dom.sideSeats.innerHTML = largePod ? state.players.slice(4).map(seatMarkup).join('') : '';
  $$('[data-seat]').forEach(button => button.addEventListener('click', () => { state.activePlayerId = button.dataset.seat; state.selectedSourceId = null; render(); }));
}
function renderSources(player) {
  dom.sourcePanel.hidden = state.mode !== 'commander'; if (dom.sourcePanel.hidden) return; const sources = sourcesForDefender(player.id); selectedSourceFor(player);
  dom.sourcePanel.classList.toggle('source-panel-dense', sources.length > 4);
  dom.sourcePanel.innerHTML = sources.length ? `<p class="source-panel-prompt">Damage received by ${escapeHtml(displayPlayer(player))} from:</p>${sources.map(source => { const value = commanderValue(player, source.id); const severity = value >= 21 ? 'lethal' : value >= 18 ? 'near' : ''; const owner = source.commanderName ? `<strong>${escapeHtml(sourceOwnerLabel(source))} · ${escapeHtml(source.ownerPlayerId)}</strong><small>${escapeHtml(source.commanderName)}</small>` : `<strong>${escapeHtml(displaySource(source))} · ${escapeHtml(source.ownerPlayerId)}</strong><small>Commander source</small>`; return `<button class="source-button ${source.id === state.selectedSourceId ? 'selected' : ''} ${severity}" data-source="${source.id}" type="button" aria-pressed="${source.id === state.selectedSourceId}">${owner}<span>${value}</span></button>`; }).join('')}` : '<p class="field-help">There are no opposing commanders to track for this seat.</p>';
  $$('[data-source]').forEach(button => button.addEventListener('click', () => { state.selectedSourceId = button.dataset.source; render(); }));
}
function renderModeNav() { $$('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); }); }
function renderSeatPicker() { dom.activeSeat.innerHTML = state.players.map(player => `<option value="${player.id}">${escapeHtml(displayPlayer(player))}${player.id === state.ownerPlayerId ? ' (you)' : ''}</option>`).join(''); dom.activeSeat.value = state.activePlayerId; }
function commanderTaxPlayer() { return activePlayer(); }
function commanderTaxEnabled() { return transport.status === 'local' || transport.status === 'connected'; }
function renderCommanderTaxQuick(player, inspectingSharedSeat) {
  if (!dom.commanderTaxQuickButton) return;
  const sources = ownCommanderSources(player.id);
  const title = inspectingSharedSeat ? `View ${displayName(player)} tax` : 'My commander tax';
  const names = sources.map(source => displaySource(source)).join(' · ') || displayName(player);
  const values = sources.map(source => {
    const tax = (state.commanderCastCounts[source.id] || 0) * 2;
    return `<span class="commander-tax-quick-value"><strong>${escapeHtml(source.slot || 'A')}</strong><span>+${tax}</span></span>`;
  }).join('') || '<span class="commander-tax-quick-value"><strong>A</strong><span>+0</span></span>';
  const accessibleValues = sources.map(source => `${displaySource(source)} current tax +${(state.commanderCastCounts[source.id] || 0) * 2}`).join(', ') || 'current tax +0';
  dom.commanderTaxQuickButton.innerHTML = `<span class="commander-tax-quick-title">${escapeHtml(title)}</span><span class="commander-tax-quick-name">${escapeHtml(names)}</span><span class="commander-tax-quick-values">${values}</span>`;
  dom.commanderTaxQuickButton.setAttribute('aria-label', `${displayPlayer(player)} ${accessibleValues}${inspectingSharedSeat ? ', read only' : ''}. Open commander tax.`);
}
function confirmLifeChange(playerId) { if (lifeChange?.playerId === playerId) { lifeChange.confirmed = true; render(); } }
async function openPlaytestNotes() { try { const { notes } = await transport.listPlaytestNotes(); dom.playtestNotesList.innerHTML = notes.length ? notes.map(note => `<li><strong>${note.authorSeatId === transport.seatId ? 'You' : escapeHtml(displayName(state.players[note.authorSeatId]))}</strong><p>${escapeHtml(note.text)}</p></li>`).join('') : '<li>No notes yet. Add something while it is fresh.</li>'; dom.gameMenu.hidden = true; dom.playtestNotesDialog.showModal(); } catch (error) { showError(error); } }
async function openPlaytestRecap() { try { const { recap } = await transport.getPlaytestRecap(); const winner = recap.winner ? displayName(state.players[recap.winner.seatId]) : 'Not recorded yet'; const players = recap.players.map(player => `${escapeHtml(player.name)}${player.commanders.length ? ` · ${player.commanders.map(escapeHtml).join(' / ')}` : ''}`).join('<br>'); dom.playtestRecapContent.innerHTML = `<p><strong>Duration:</strong> ${Math.round(recap.durationMs / 60000)} min</p><p><strong>Winner:</strong> ${escapeHtml(winner)}</p><p><strong>Players:</strong><br>${players || 'No claimed players'}</p><p><strong>Notes:</strong> ${recap.notes.length}</p>`; dom.gameMenu.hidden = true; dom.playtestRecapDialog.showModal(); } catch (error) { showError(error); } }
async function openSavedPlaytests() { try { const { playtests } = await transport.getSavedPlaytests(); dom.savedPlaytestsContent.innerHTML = playtests.length ? playtests.map(item => { const players = item.players.map(player => `${escapeHtml(player.name)}${player.commanders.length ? ` · ${player.commanders.map(escapeHtml).join(' / ')}` : ''}`).join('<br>'); const winner = item.winner ? escapeHtml(item.players.find(player => player.seatId === item.winner.seatId)?.name || 'Recorded winner') : 'Interrupted'; return `<section class="playtest-notes-list"><p><strong>${winner}</strong> · ${Math.round(item.durationMs / 60000)} min</p><p>${players}</p><p>${item.notes?.length || 0} note(s)</p></section>`; }).join('') : '<p>No completed or interrupted playtests are saved for this table yet.</p>'; dom.gameMenu.hidden = true; dom.savedPlaytestsDialog.showModal(); } catch (error) { showError(error); } }
function canReturnToSetup() { return Boolean(state?.localSimulation || transport.seatId === state?.hostSeatId); }
async function refreshJoinSeats() {
  const code = $('#podCode').value.trim().toUpperCase();
  if (code.length !== 6) {
    dom.joinCodeStatus.textContent = 'Enter the six-character pod code.';
    return false;
  }
  dom.joinCodeStatus.textContent = 'Checking pod…';
  try {
    const { snapshot } = await transport.inspectRoom(code);
    if ($('#podCode').value.trim().toUpperCase() !== code) return;
    const availableSeats = snapshot.seats.filter(seat => !seat.claimed || transport.hasStoredReclaimToken(code, seat.seatId));
    const openSeatCount = snapshot.seats.filter(seat => !seat.claimed).length;
    dom.joinSeat.innerHTML = availableSeats.length
      ? availableSeats.map(seat => `<option value="P${seat.seatId + 1}">${seat.claimed ? `Reclaim P${seat.seatId + 1}` : `P${seat.seatId + 1}`}</option>`).join('')
      : '<option value="">No open seats</option>';
    dom.joinSeat.disabled = availableSeats.length === 0;
    dom.joinName.placeholder = dom.joinSeat.value || 'No open seat';
    dom.joinCodeStatus.textContent = availableSeats.length ? `${openSeatCount ? `${openSeatCount} open seat${openSeatCount === 1 ? '' : 's'} available.` : 'This pod is full.'}${availableSeats.some(seat => seat.claimed) ? ' Your saved seat can be reclaimed on this device.' : ''}` : 'This pod has no open seats.';
    if (availableSeats.length) showView(dom.joinSeatView);
    return availableSeats.length > 0;
  } catch {
    if ($('#podCode').value.trim().toUpperCase() === code) {
      dom.joinSeat.innerHTML = '<option value="">Pod not available</option>';
      dom.joinSeat.disabled = true;
      dom.joinCodeStatus.textContent = 'Pod not found. Check the code and try again.';
    }
    return false;
  }
}
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
  const lifeBefore = player.life; const lifeAfter = lifeBefore + lifeDelta;
  if (state.mode === 'commander' && commanderDelta === 0) return;
  if (transport.status === 'local') {
    if (state.mode === 'commander') { player.commanderDamage[source.id] = next; player.life += lifeDelta; }
    else player[target] = next;
    if (lifeDelta) showLifeChange(player.id, lifeDelta, lifeBefore, lifeAfter);
    render(); return;
  }
  if (state.mode === 'life') {
    showLifeChange(player.id, delta, previous, previous + delta);
    // Shared life is an atomic server-side delta. Submit each tap immediately
    // so Safari timer/identifier support can never leave a visible local-only
    // total that was not written to the table.
    try { const result = await transport.adjust({ counter: 'life', delta }); if (!result.blocked && !result.ignored) confirmLifeChange(player.id); }
    catch (error) { renderConnection('disconnected'); showError(error); }
    return;
  }
  $$('[data-delta]').forEach(button => { button.disabled = true; });
  try {
    const result = await transport.adjust({ counter: target, delta, ...(state.mode === 'commander' ? { commanderSourceId: source.id } : {}) });
    if (lifeDelta && !result.blocked && !result.ignored) showLifeChange(player.id, lifeDelta, lifeBefore, lifeAfter);
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
async function updateCommanderSetup(count, names, colors) {
  const player = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId);
  if (transport.status === 'local') { const previousSources = state.commanderSources; player.commanderCount = count; player.commanderNames = names; player.commanderColors = colors; state.commanderSources = sourcesFromPlayers(state.players); remapLocalDamage(previousSources, state.commanderSources); remapLocalCastCounts(previousSources, state.commanderSources); state.selectedSourceId = null; render(); return; }
  try { dom.saveCommanderCountButton.disabled = true; const result = await transport.setCommanderSetup(count, names, colors); if (result.conflict) showError(new Error('The table changed first. The latest commander setup is shown.')); } catch (error) { showError(error); } finally { dom.saveCommanderCountButton.disabled = false; }
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
  if (transport.status === 'local') { const sources = state.commanderSources; state.players = state.players.map(player => ({ ...playerTemplate(Number(player.id.slice(1)), state.startingLife, player.commanderCount, sources, player.commanderNames, player.commanderColors), name: player.name, commanderCount: player.commanderCount, commanderNames: player.commanderNames, commanderColors: player.commanderColors })); state.commanderCastCounts = blankDamage(sources); state.lastCoinToss = null; state.gameResult = null; state.turn = { activeSeatId: 0, gameStarted: false, gameStartedAt: null, turnStartedAt: null, roundEndsAt: null, startingPlayerSeatId: null, startingPlayerRoll: null, lastHandoff: null, trackingEnabled: true, pausedAt: null }; state.turnSeatId = 'P1'; coinTossNotice = null; clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer); clearStartingRollTimers(); state.selectedSourceId = null; render(); return; }
  try { const result = await transport.reset(); if (result.conflict) showError(new Error('The table changed first. The latest totals are shown; confirm reset again if it is still needed.')); else { coinTossNotice = null; clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer); render(); } } catch (error) { showError(error); }
}
async function handoffTurn() {
  const actingSeatId = state?.localSimulation ? state.activePlayerId : state?.ownerPlayerId;
  if (!state || !state.turn.gameStarted || state.turn.trackingEnabled === false || state.turn.pausedAt || state.turnSeatId !== actingSeatId || !(transport.status === 'local' || transport.status === 'connected')) return;
  if (transport.status === 'local') {
    const fromSeatId = Number(state.turnSeatId.slice(1)) - 1; const living = state.players.filter(player => player.connectionStatus !== 'waiting' && player.life > 0); const sequence = living.length ? living : state.players.filter(player => player.connectionStatus !== 'waiting'); const currentIndex = sequence.findIndex(player => player.id === state.turnSeatId); const toSeatId = Number(sequence[(currentIndex + 1) % sequence.length].id.slice(1)) - 1; const handedOffAt = Date.now();
    const turnLengthMs = Math.max(0, handedOffAt - state.turn.turnStartedAt); state.turn = { ...state.turn, activeSeatId: toSeatId, turnStartedAt: handedOffAt, lastHandoff: { fromSeatId, toSeatId, handedOffAt, turnLengthMs } }; state.turnSeatId = `P${toSeatId + 1}`; state.activePlayerId = state.turnSeatId; showTurnHandoff(); render(); return;
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
async function toggleTurnTracking() {
  if (!state || (!state.localSimulation && transport.seatId !== state.hostSeatId)) return;
  dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false');
  const enabled = state.turn.trackingEnabled === false;
  if (transport.status === 'local') { state.turn = { ...state.turn, trackingEnabled: enabled, pausedAt: null, turnStartedAt: enabled && state.turn.gameStarted ? Date.now() : state.turn.turnStartedAt, lastHandoff: null }; render(); return; }
  try { const result = await transport.setTurnTracking(enabled); if (result.conflict) showError(new Error('The table changed first. The latest turn settings are shown.')); } catch (error) { showError(error); }
}
async function toggleTurnCues() {
  if (!state || (!state.localSimulation && transport.seatId !== state.hostSeatId)) return;
  const enabled = !state.turn.cuesEnabled;
  if (transport.status === 'local') { state.turn = { ...state.turn, cuesEnabled: enabled }; render(); return; }
  try { const result = await transport.setTurnCues(enabled); if (result.conflict) showError(new Error('The table changed first. The latest turn settings are shown.')); } catch (error) { showError(error); }
}
async function toggleTurnPause() {
  if (!state || state.turn.trackingEnabled === false || (!state.localSimulation && transport.seatId !== state.hostSeatId)) return;
  dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false');
  const paused = !state.turn.pausedAt;
  if (transport.status === 'local') { const now = Date.now(); const pausedFor = !paused && state.turn.pausedAt ? now - state.turn.pausedAt : 0; state.turn = { ...state.turn, pausedAt: paused ? now : null, turnStartedAt: pausedFor ? state.turn.turnStartedAt + pausedFor : state.turn.turnStartedAt, gameStartedAt: pausedFor ? state.turn.gameStartedAt + pausedFor : state.turn.gameStartedAt, roundEndsAt: pausedFor && state.turn.roundEndsAt ? state.turn.roundEndsAt + pausedFor : state.turn.roundEndsAt }; render(); return; }
  try { const result = await transport.setTurnPaused(paused); if (result.conflict) showError(new Error('The table changed first. The latest timer state is shown.')); } catch (error) { showError(error); }
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
  if (state.localSimulation || state.turnSeatId === state.ownerPlayerId) playTurnCue();
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
function closeGameOverlays() { [dom.resetDialog, dom.connectionDialog, dom.coinTossDialog, dom.startingRollDialog, dom.customLifeDialog, dom.commanderCountDialog, dom.commanderTaxDialog, dom.victoryDialog, dom.declareWinnerDialog, dom.playtestNotesDialog, dom.playtestRecapDialog, dom.savedPlaytestsDialog].forEach(dialog => { if (dialog?.open) dialog.close(); }); }
function returnToSetup() {
  if (!canReturnToSetup()) return;
  closeGameOverlays(); clearTimeout(coinTossTimer); clearTimeout(coinFlipTimer); clearStartingRollTimers(); clearInterval(turnTicker); dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false'); showView(dom.create); state = null; transport.clearSession();
}
function renderConnection(status = transport.status) {
  if (status !== 'connected' && optimisticLifeDelta) { lifeBatcher.clear(); optimisticLifeDelta = 0; }
  const presentation = connectionPresentation({ status });
  if (presentation.showOffline) awaitingConfirmedResync = true;
  dom.connectionButton.dataset.state = status; dom.connectionText.textContent = presentation.label; dom.disconnectBanner.hidden = !presentation.showOffline;
  dom.connectionDetail.textContent = `${presentation.detail}${status === 'connected' && state?.podCode ? ` Pod ${state.podCode}; this phone controls ${state.ownerPlayerId || 'its assigned seat'}.` : ''}`; if (state && !dom.game.hidden) render();
}
function saveLocal() { if (!state || !state.localSimulation) return; try { localStorage.setItem('fivefold-arc-test-state', JSON.stringify(state)); } catch { /* storage is optional */ } }
function loadLocal() { try { const saved = JSON.parse(localStorage.getItem('fivefold-arc-test-state')); if (saved?.commanderSources && saved?.players?.length && saved.playerCount === saved.players.length) return saved; } catch { /* ignore malformed state */ } return null; }

fillSetupControls(); refreshSetupCommanderNames(); renderConnection();
$('#createPodButton').addEventListener('click', () => showView(dom.create)); $('#joinPodButton').addEventListener('click', () => { showView(dom.join); dom.joinCodeStatus.textContent = ''; }); $('#changePodButton').addEventListener('click', () => showView(dom.join)); $$('[data-back]').forEach(button => button.addEventListener('click', () => showView(dom.landing))); $('#joinSeat').addEventListener('change', () => { dom.joinName.placeholder = dom.joinSeat.value; }); dom.joinCodeForm.addEventListener('submit', async event => { event.preventDefault(); await refreshJoinSeats(); }); $$('input[name="commanderCount"], input[name="joinCommanderCount"]').forEach(input => input.addEventListener('change', refreshSetupCommanderNames));
$('#quickTestButton').addEventListener('click', () => { const saved = loadLocal(); if (saved) { transport.useLocal(); state = saved; showView(dom.game); render(); } else beginLocalGame({}); });
$('#createForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const playerCount = Number(form.get('playerCount')); const ownerCommanderCount = Number(form.get('commanderCount')); const ownerCommanderNames = commanderNamesFromForm(form, ownerCommanderCount); const ownerCommanderColors = commanderColorsFromFields(dom.createCommanderNames, ownerCommanderCount); const ownerPlayerId = 'P1'; const ownerName = String(form.get('name') || '').trim() || ownerPlayerId; const enteredRoundLimit = String(form.get('roundLimitMinutes') || '').trim(); const roundLimitMinutes = enteredRoundLimit ? Number(enteredRoundLimit) : null; if (roundLimitMinutes !== null && (!Number.isInteger(roundLimitMinutes) || roundLimitMinutes < 1 || roundLimitMinutes > 999)) { dom.roundLimitMinutes.focus(); return; } const config = { playerCount, startingLife: Number(form.get('startingLife')), ownerPlayerId, ownerName, ownerCommanderCount, ownerCommanderNames, ownerCommanderColors, roundLimitMinutes }; if (dom.localSimulation.checked) return beginLocalGame({ ...config, localSimulation: true, podCode: 'LOCAL' }); try { const result = await transport.createRoom({ playerCount, startingLife: config.startingLife, commanderCount: ownerCommanderCount, commanderNames: ownerCommanderNames, commanderColors: ownerCommanderColors, name: ownerName, roundLimitMinutes }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#joinForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const code = $('#podCode').value.trim().toUpperCase(); const ownerPlayerId = $('#joinSeat').value; if (!/^P[1-8]$/.test(ownerPlayerId)) return showError(new Error('Wait for this pod’s open seats to load, then choose one.')); const seatId = Number(ownerPlayerId.slice(1)) - 1; const commanderCount = Number(form.get('joinCommanderCount')); const commanderNames = commanderNamesFromForm(form, commanderCount); const commanderColors = commanderColorsFromFields(dom.joinCommanderNames, commanderCount); const ownerName = String(form.get('name') || '').trim() || ownerPlayerId; try { const room = await transport.inspectRoom(code); if (!room.snapshot.seats[seatId] || (room.snapshot.seats[seatId].claimed && !transport.hasStoredReclaimToken(code, seatId))) throw new Error('That seat is no longer open. Choose one of the available seats.'); const result = await transport.claimRoom({ code, seatId, name: ownerName, commanderCount, commanderNames, commanderColors }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#recoverPodButton').addEventListener('click', async () => { const code = $('#podCode').value.trim().toUpperCase(); if (code.length !== 6) return showError(new Error('Enter the six-character pod code first.')); try { const { snapshot } = await transport.restoreRoom(code); const host = snapshot.seats[snapshot.hostSeatId]; const result = await transport.claimRoom({ code, seatId: snapshot.hostSeatId, name: host.name, commanderCount: host.commanderCount, commanderNames: host.commanderNames, commanderColors: host.commanderColors }); showSharedGame(result.snapshot); } catch (error) { showError(error); } });
$('#joinDemoButton').addEventListener('click', () => { const ownerPlayerId = $('#joinSeat').value; const ownerName = dom.joinName.value.trim() || ownerPlayerId; beginLocalGame({ ownerPlayerId, ownerName, ownerCommanderCount: Number(new FormData($('#joinForm')).get('joinCommanderCount')), localSimulation: true, podCode: 'DEMO' }); });
dom.activeSeat.addEventListener('change', () => { state.activePlayerId = dom.activeSeat.value; render(); }); $$('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; render(); })); $$('[data-delta]').forEach(button => button.addEventListener('click', () => adjust(Number(button.dataset.delta))));
dom.customLifeButton.addEventListener('click', () => { dom.customLifeAmount.value = ''; dom.customLifeDialog.showModal(); dom.customLifeAmount.focus(); }); dom.cancelCustomLifeButton.addEventListener('click', () => dom.customLifeDialog.close('cancel'));
dom.customLifeForm.addEventListener('submit', event => { if (event.submitter?.value !== 'confirm') return; const form = new FormData(dom.customLifeForm); const amount = Number(form.get('amount')); if (!Number.isInteger(amount) || amount < 1 || amount > 999) { event.preventDefault(); dom.customLifeAmount.focus(); return; } const delta = form.get('direction') === 'subtract' ? -amount : amount; adjust(delta); });
dom.endTurnButton.addEventListener('click', handoffTurn); dom.undoTurnButton.addEventListener('click', undoTurnHandoff); dom.pauseTurnButton.addEventListener('click', toggleTurnPause); dom.toggleTurnTrackingButton.addEventListener('click', toggleTurnTracking); dom.toggleTurnCuesButton.addEventListener('click', toggleTurnCues); dom.toggleDeviceCuesButton.addEventListener('click', () => { setDeviceTurnCues(!deviceTurnCuesEnabled()); render(); });
dom.chooseFirstButton.addEventListener('click', () => chooseStartingPlayer(Number(dom.startingSeat.value))); dom.randomFirstButton.addEventListener('click', () => chooseStartingPlayer()); dom.startGameButton.addEventListener('click', startGame);
dom.moreButton.addEventListener('click', () => { dom.gameMenu.hidden = !dom.gameMenu.hidden; dom.moreButton.setAttribute('aria-expanded', String(!dom.gameMenu.hidden)); }); dom.coinTossButton.addEventListener('click', () => { dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false'); tossCoin(); }); dom.declareWinnerButton.addEventListener('click', openDeclareWinner); dom.tossAgainButton.addEventListener('click', () => tossCoin()); $('#resetButton').addEventListener('click', () => { dom.gameMenu.hidden = true; dom.resetDialog.showModal(); }); $('#confirmResetButton').addEventListener('click', resetGame);
dom.playtestNotesButton.addEventListener('click', openPlaytestNotes); dom.playtestRecapButton.addEventListener('click', openPlaytestRecap); dom.savedPlaytestsButton.addEventListener('click', openSavedPlaytests); dom.refreshTableButton.addEventListener('click', async () => { try { const { snapshot } = await transport.refreshRoom(); if (snapshot) showSharedGame(snapshot); dom.gameMenu.hidden = true; } catch (error) { showError(error); } }); dom.playtestNotesForm.addEventListener('submit', async event => { if (event.submitter?.id !== 'savePlaytestNoteButton') return; event.preventDefault(); const text = dom.playtestNoteText.value; try { dom.playtestNoteStatus.textContent = 'Saving…'; await transport.addPlaytestNote(text); dom.playtestNoteText.value = ''; dom.playtestNoteStatus.textContent = 'Saved.'; await openPlaytestNotes(); } catch (error) { dom.playtestNoteStatus.textContent = `Not saved: ${error.message}`; } });
dom.startingRollDialog.addEventListener('close', () => { startingRollSequence += 1; clearStartingRollTimers(); });
dom.rollMyD20Button.addEventListener('click', rollMyStartingD20);
$('#closeGameMenuButton').addEventListener('click', () => { dom.gameMenu.hidden = true; dom.moreButton.setAttribute('aria-expanded', 'false'); });
dom.commanderSetupButton.addEventListener('click', () => { dom.gameMenu.hidden = true; const player = state.localSimulation ? activePlayer() : state.players.find(item => item.id === state.ownerPlayerId); dom.commanderCountDetail.textContent = state.localSimulation ? `Local simulation: change ${displayName(player)}'s commander details.` : `Change your commander names and color identity for this pod. Your current game and seat stay in place.`; $(`input[name="gameCommanderCount"][value="${player.commanderCount}"]`).checked = true; renderCommanderNameFields(dom.gameCommanderNames, player.commanderCount, player.commanderNames, player.commanderColors); dom.commanderCountDialog.showModal(); });
dom.commanderTaxQuickButton?.addEventListener('click', () => { renderCommanderTaxDialog(); dom.commanderTaxDialog.showModal(); });
dom.backToSetupButton?.addEventListener('click', returnToSetup);
$$('input[name="gameCommanderCount"]').forEach(input => input.addEventListener('change', () => renderCommanderNameFields(dom.gameCommanderNames, selectedCommanderCount('gameCommanderCount'))));
dom.commanderCountForm.addEventListener('submit', event => { if (event.submitter?.value === 'confirm') { const form = new FormData(dom.commanderCountForm); const count = Number(form.get('gameCommanderCount')); const names = commanderNamesFromForm(form, count); updateCommanderSetup(count, names, commanderColorsFromFields(dom.gameCommanderNames, count)); } }); dom.declareWinnerForm.addEventListener('submit', event => { if (event.submitter?.value === 'confirm') declareWinner(); }); dom.connectionButton.addEventListener('click', () => dom.connectionDialog.showModal());
transport.addEventListener('status', event => renderConnection(event.detail)); transport.addEventListener('state', event => { if (event.detail?.seats?.length) { const previousTossKey = coinTossKey(state?.lastCoinToss); const previousRollKey = startingPlayerRollKey(state?.turn?.startingPlayerRoll); const previousTurnKey = state?.turn?.lastHandoff ? `${state.turn.lastHandoff.handedOffAt}:${state.turn.lastHandoff.toSeatId}` : null; state = stateFromSnapshot(event.detail); if (awaitingConfirmedResync && transport.status === 'connected') { awaitingConfirmedResync = false; const presentation = connectionPresentation({ status: 'connected', resynced: true }); dom.syncBanner.textContent = presentation.syncMessage; dom.syncBanner.hidden = false; clearTimeout(syncBannerTimer); syncBannerTimer = setTimeout(() => { dom.syncBanner.hidden = true; }, 5000); } const nextRollKey = startingPlayerRollKey(state.turn.startingPlayerRoll); const nextTurnKey = state.turn.lastHandoff ? `${state.turn.lastHandoff.handedOffAt}:${state.turn.lastHandoff.toSeatId}` : null; if (dom.game.hidden) showView(dom.game); if (nextTurnKey && nextTurnKey !== previousTurnKey && nextTurnKey !== lastTurnHandoffKey) { lastTurnHandoffKey = nextTurnKey; showTurnHandoff(); } if (nextRollKey && nextRollKey !== previousRollKey && nextRollKey !== lastStartingRollKey) { lastStartingRollKey = nextRollKey; showStartingPlayerRoll(state.turn.startingPlayerRoll); } else if (coinTossKey(state.lastCoinToss) && coinTossKey(state.lastCoinToss) !== previousTossKey) { const dialog = coinTossDialogRequested; coinTossDialogRequested = false; showCoinToss(state.lastCoinToss, { dialog }); } else render(); } });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
