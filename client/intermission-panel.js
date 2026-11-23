import { renderSeatOrder } from './seat-order.js?v=1';

export function renderIntermissionPanel(dom, state, { seatId, status, pendingSetup, eventFlow, seatOrderOptions }) {
  const rosterIds = state.lifecycle?.seatIds || [];
  const readyIds = state.lifecycle?.readySeatIds || [];
  const isHost = state.localSimulation || seatId === state.hostSeatId;
  const ownSeatId = state.localSimulation ? Number(String(state.ownerPlayerId).slice(1)) - 1 : seatId;
  const youAreReady = readyIds.includes(ownSeatId);
  const canShareJoin = !state.localSimulation && Boolean(state.podCode);
  dom.intermissionTitle.textContent = 'Set up the next game';
  const openSeats = state.players.filter(player => player.connectionStatus === 'waiting').length;
  const canAddPlayer = openSeats > 0 || state.players.length < 8;
  dom.intermissionDetail.textContent = `${readyIds.length}/${rosterIds.length} players ready.${canAddPlayer ? '' : ' All 8 seats are claimed. A player must leave to open a seat.'}`;
  dom.intermissionInvite.hidden = !isHost || !canAddPlayer || !canShareJoin;
  if (dom.intermissionInvite.hidden) dom.intermissionInvite.open = false;
  dom.intermissionInviteCode.textContent = state.podCode;
  renderSeatOrder(dom.intermissionRoster, rosterIds, { ...seatOrderOptions, intermission: true });
  dom.intermissionReadyButton.hidden = !rosterIds.includes(ownSeatId);
  dom.intermissionSetupButton.hidden = !rosterIds.includes(ownSeatId) || youAreReady;
  dom.intermissionSetupButton.disabled = pendingSetup || (!state.localSimulation && status !== 'connected');
  dom.intermissionReadyButton.textContent = youAreReady ? 'I need to make a change' : 'I’m ready';
  dom.intermissionReadyButton.disabled = pendingSetup || (!state.localSimulation && status !== 'connected');
  dom.intermissionStartButton.hidden = !isHost;
  const everyoneReady = rosterIds.length >= 2 && rosterIds.every(id => readyIds.includes(id));
  dom.intermissionStartButton.disabled = !everyoneReady || (!state.localSimulation && status !== 'connected');
  dom.intermissionStartButton.textContent = everyoneReady ? `Start next game · ${rosterIds.length} players` : `Waiting for every player · ${readyIds.length}/${rosterIds.length} ready`;
  dom.intermissionLeaveButton.disabled = !state.localSimulation && status !== 'connected';
  if (eventFlow) {
    dom.intermissionTitle.textContent = 'Tournament game complete';
    dom.intermissionDetail.textContent = eventFlow.canOpenEvent
      ? 'Review the finish, then return to your tournament for the next assignment or final standings.'
      : 'Your Table host confirms the finish. Ask the organizer for event access or your next assignment.';
    for (const node of [dom.intermissionReadyButton, dom.intermissionSetupButton, dom.intermissionStartButton, dom.intermissionRoster, dom.intermissionInvite]) node.hidden = true;
  } else dom.intermissionRoster.hidden = false;
}
